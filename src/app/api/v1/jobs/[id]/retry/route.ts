import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  createGenerationJob,
  createJobEvent,
  createSignedInputUrlFromPath,
  getUserJob,
  mapJobRowToResponse,
} from "@/lib/jobs";
import { RunpodError, runpodModelNameForMode, startRunpodJob } from "@/lib/runpod";

const fail = (message: string, status = 400) =>
  NextResponse.json({ success: false, message }, { status });

/**
 * POST /api/v1/jobs/:id/retry
 *
 * Retry a failed/completed job by creating a new job with the same parameters.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const source = await getUserJob(user.id, id);

    if (source.status === "IN_QUEUE" || source.status === "IN_PROGRESS" || source.status === "RETRY") {
      return fail("Cannot retry an active job.", 409);
    }

    let inputImageUrl: string | undefined;
    if (source.input_media_path) {
      if (!source.input_media_path.startsWith(`${user.id}/`)) {
        return fail("Input media path does not belong to this user.", 403);
      }
      inputImageUrl = await createSignedInputUrlFromPath(source.input_media_path);
    } else if (
      source.mode === "video:i2v" ||
      source.mode === "image:flux" ||
      source.mode === "image:qwen"
    ) {
      return fail("Source input image for this job is missing, cannot retry.", 400);
    }

    let runpodResult;
    try {
      runpodResult = await startRunpodJob({
        mode: source.mode,
        prompt: source.prompt,
        durationSeconds: source.duration_seconds || undefined,
        inputImageUrl,
      });
    } catch (error) {
      if (error instanceof RunpodError) {
        return fail(
          error.isBillingError
            ? "RunPod billing error: insufficient credits."
            : `RunPod request failed (HTTP ${error.httpStatus}): ${error.message}`,
          error.isBillingError ? 402 : 502,
        );
      }
      return fail(error instanceof Error ? error.message : "RunPod request failed.", 502);
    }

    const model = runpodModelNameForMode(source.mode);
    const newJob = await createGenerationJob({
      userId: user.id,
      mode: source.mode,
      model,
      prompt: source.prompt,
      durationSeconds: source.duration_seconds,
      inputMediaPath: source.input_media_path,
      runpodJobId: runpodResult.id,
      initialStatus: runpodResult.status,
      runpodRaw: runpodResult.raw,
    });

    await createJobEvent(
      user.id,
      newJob.id,
      runpodResult.status,
      `Job retried from ${source.id} via programmatic API.`,
      runpodResult.raw,
    );

    return NextResponse.json({
      success: true,
      sourceJobId: source.id,
      job: mapJobRowToResponse(newJob),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retry failed.";
    const status = message === "Job not found." ? 404 : message === "Unauthorized" ? 401 : 500;
    return fail(message, status);
  }
}
