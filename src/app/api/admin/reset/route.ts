import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { envServer } from "@/lib/env/server";
import { isActiveJob } from "@/lib/job-progress";
import { supabaseService } from "@/lib/supabase/service";

/**
 * ONE-TIME, user-scoped "start fresh" reset.
 *
 * Requires an authenticated session AND an explicit { "confirm": "RESET" } body
 * so it can never fire by accident. It only touches the calling user's own rows
 * and storage objects — never the schema, buckets, RLS, or auth user.
 *
 * Steps:
 *  1. Best-effort cancel still-active fal.ai requests (so no new video is made).
 *  2. Remove every output file (media-library) and input file (inputs-private).
 *  3. Clear job→media references, then delete media_assets, job_events, and
 *     generation_jobs rows.
 */
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser(request);
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (body?.confirm !== "RESET") {
    return NextResponse.json(
      { success: false, message: 'Confirmation required: POST { "confirm": "RESET" }.' },
      { status: 400 },
    );
  }

  const result = {
    cancelledFalRequests: 0,
    removedOutputFiles: 0,
    removedInputFiles: 0,
    deletedMediaAssets: 0,
    deletedJobEvents: 0,
    deletedJobs: 0,
    errors: [] as string[],
  };

  // ── Load this user's jobs (for provider cancel + input paths) ──
  const { data: jobs, error: jobsErr } = await supabaseService
    .from("generation_jobs")
    .select("id, mode, status, input_media_path, runpod_raw")
    .eq("user_id", user.id)
    .returns<
      Array<{
        id: string;
        mode: string;
        status: string;
        input_media_path: string | null;
        runpod_raw: Record<string, unknown> | null;
      }>
    >();
  if (jobsErr) {
    return NextResponse.json({ success: false, message: jobsErr.message }, { status: 500 });
  }

  // ── 1. Best-effort cancel active fal.ai requests ──
  if (envServer.falKey) {
    const active = (jobs || []).filter(
      (j) => isActiveJob(j.status) && j.mode.startsWith("video:fal") ,
    );
    for (const j of active) {
      const cancelUrl =
        j.runpod_raw && typeof j.runpod_raw.cancel_url === "string" ? j.runpod_raw.cancel_url : null;
      if (!cancelUrl) continue;
      try {
        await fetch(cancelUrl, {
          method: "PUT",
          headers: { Authorization: `Key ${envServer.falKey}` },
          cache: "no-store",
        });
        result.cancelledFalRequests += 1;
      } catch {
        // already gone / expired — nothing to cancel
      }
    }
  }

  const removeInBatches = async (bucket: string, paths: string[]) => {
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error } = await supabaseService.storage.from(bucket).remove(batch);
      if (error) {
        result.errors.push(`${bucket}: ${error.message}`);
      } else {
        removed += batch.length;
      }
    }
    return removed;
  };

  // ── 2a. Remove output files (media-library) via media_assets.storage_path ──
  const { data: media, error: mediaErr } = await supabaseService
    .from("media_assets")
    .select("storage_path")
    .eq("user_id", user.id)
    .returns<Array<{ storage_path: string }>>();
  if (mediaErr) {
    return NextResponse.json({ success: false, message: mediaErr.message }, { status: 500 });
  }
  const outputPaths = (media || []).map((m) => m.storage_path).filter(Boolean);
  if (outputPaths.length) {
    result.removedOutputFiles = await removeInBatches("media-library", outputPaths);
  }

  // ── 2b. Remove input uploads (inputs-private) via job.input_media_path ──
  const inputPaths = (jobs || [])
    .map((j) => j.input_media_path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (inputPaths.length) {
    result.removedInputFiles = await removeInBatches("inputs-private", inputPaths);
  }

  // ── 3. Clear references, then delete rows (order avoids FK violations) ──
  await supabaseService
    .from("generation_jobs")
    .update({ output_media_id: null })
    .eq("user_id", user.id);

  const delMedia = await supabaseService
    .from("media_assets")
    .delete({ count: "exact" })
    .eq("user_id", user.id);
  if (delMedia.error) result.errors.push(`media_assets: ${delMedia.error.message}`);
  result.deletedMediaAssets = delMedia.count || 0;

  const delEvents = await supabaseService
    .from("job_events")
    .delete({ count: "exact" })
    .eq("user_id", user.id);
  if (delEvents.error) result.errors.push(`job_events: ${delEvents.error.message}`);
  result.deletedJobEvents = delEvents.count || 0;

  const delJobs = await supabaseService
    .from("generation_jobs")
    .delete({ count: "exact" })
    .eq("user_id", user.id);
  if (delJobs.error) result.errors.push(`generation_jobs: ${delJobs.error.message}`);
  result.deletedJobs = delJobs.count || 0;

  return NextResponse.json({ success: result.errors.length === 0, ...result });
}
