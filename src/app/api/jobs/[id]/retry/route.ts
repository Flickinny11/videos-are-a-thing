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
  NextResponse.json(
    {
      success: false,
      message,
    },
    { status },
  );

const normalizeRunpodError = (error: unknown): { message: string; status: number } => {
  if (error instanceof RunpodError) {
    if (error.isBillingError) {
      return {
        message:
          "RunPod billing error: insufficient credits or billing limit reached. " +
          "If you just added credits, please wait a moment and try submitting again.",
        status: 402,
      };
    }

    return {
      message: `RunPod request failed (HTTP ${error.httpStatus}): ${error.message}`,
      status: 502,
    };
  }

  const text = error instanceof Error ? error.message : "Unknown error";
  return { message: `RunPod request failed: ${text}`, status: 502 };
};

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
    } else if (source.mode === "video:i2v" || source.mode === "image:flux" || source.mode === "image:qwen") {
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
      const normalized = normalizeRunpodError(error);
      return fail(normalized.message, normalized.status);
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
      `Job retried from ${source.id} and submitted to RunPod with status ${runpodResult.status}.`,
      runpodResult.raw,
    );

    return NextResponse.json({
      success: true,
      message: "Retry submitted.",
      sourceJobId: source.id,
      job: mapJobRowToResponse(newJob),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retry failed.";
    const status = message === "Job not found." ? 404 : message === "Unauthorized" ? 401 : 500;
    return fail(message, status);
  }
}
