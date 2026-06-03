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
 * Order is chosen for timeout-resilience: the wipe (storage + rows) runs FIRST
 * and is what matters, then best-effort fal cancels run afterward (parallel,
 * time-boxed) so a slow provider can't prevent the data from being cleared.
 */
export const maxDuration = 60;

const CANCEL_CONCURRENCY = 20;
const CANCEL_TIMEOUT_MS = 3000;
const MAX_CANCELS = 60; // recent active fal jobs only; older ones are already dead at fal

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

  // ── Load this user's jobs (for input paths + provider cancel urls) ──
  const { data: jobs, error: jobsErr } = await supabaseService
    .from("generation_jobs")
    .select("id, mode, status, input_media_path, runpod_raw, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .returns<
      Array<{
        id: string;
        mode: string;
        status: string;
        input_media_path: string | null;
        runpod_raw: Record<string, unknown> | null;
        created_at: string;
      }>
    >();
  if (jobsErr) {
    return NextResponse.json({ success: false, message: jobsErr.message }, { status: 500 });
  }

  // Capture cancel targets BEFORE deleting (recent active fal jobs only).
  const cancelUrls = (jobs || [])
    .filter((j) => isActiveJob(j.status) && j.mode.startsWith("video:fal"))
    .slice(0, MAX_CANCELS)
    .map((j) =>
      j.runpod_raw && typeof j.runpod_raw.cancel_url === "string" ? j.runpod_raw.cancel_url : null,
    )
    .filter((u): u is string => typeof u === "string");

  const removeInBatches = async (bucket: string, paths: string[]) => {
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error } = await supabaseService.storage.from(bucket).remove(batch);
      if (error) result.errors.push(`${bucket}: ${error.message}`);
      else removed += batch.length;
    }
    return removed;
  };

  // ── 1. Remove output files (media-library) via media_assets.storage_path ──
  const { data: media, error: mediaErr } = await supabaseService
    .from("media_assets")
    .select("storage_path")
    .eq("user_id", user.id)
    .returns<Array<{ storage_path: string }>>();
  if (mediaErr) {
    return NextResponse.json({ success: false, message: mediaErr.message }, { status: 500 });
  }
  const outputPaths = (media || []).map((m) => m.storage_path).filter(Boolean);
  if (outputPaths.length) result.removedOutputFiles = await removeInBatches("media-library", outputPaths);

  // ── 2. Remove input uploads (inputs-private) via job.input_media_path ──
  const inputPaths = (jobs || [])
    .map((j) => j.input_media_path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (inputPaths.length) result.removedInputFiles = await removeInBatches("inputs-private", inputPaths);

  // ── 3. Clear references, then delete rows (order avoids FK violations) ──
  await supabaseService.from("generation_jobs").update({ output_media_id: null }).eq("user_id", user.id);

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

  // ── 4. Best-effort cancel recent active fal requests (parallel, time-boxed) ──
  if (envServer.falKey && cancelUrls.length) {
    const cancelOne = async (url: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CANCEL_TIMEOUT_MS);
      try {
        await fetch(url, {
          method: "PUT",
          headers: { Authorization: `Key ${envServer.falKey}` },
          cache: "no-store",
          signal: controller.signal,
        });
        result.cancelledFalRequests += 1;
      } catch {
        // already gone / expired / timed out — nothing to cancel
      } finally {
        clearTimeout(timer);
      }
    };
    for (let i = 0; i < cancelUrls.length; i += CANCEL_CONCURRENCY) {
      await Promise.allSettled(cancelUrls.slice(i, i + CANCEL_CONCURRENCY).map(cancelOne));
    }
  }

  return NextResponse.json({ success: result.errors.length === 0, ...result });
}
