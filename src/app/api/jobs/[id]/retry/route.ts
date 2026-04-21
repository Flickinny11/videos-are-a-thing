import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { AtlasError, atlasModelName, isAtlasMode, startAtlasJob } from "@/lib/atlas";
import { FalError, falModelName, isFalMode, startFalJob } from "@/lib/fal";
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

const normalizeProviderError = (error: unknown): { message: string; status: number } => {
  if (error instanceof AtlasError) {
    return {
      message: `Atlas Cloud (HTTP ${error.httpStatus}): ${error.message}`,
      status: error.httpStatus >= 400 && error.httpStatus < 500 ? error.httpStatus : 502,
    };
  }
  if (error instanceof FalError) {
    if (error.isBillingError) {
      return {
        message:
          "fal.ai billing error: insufficient credits or limit reached. " +
          "Please add credits to your fal.ai account and try again — no app restart needed.",
        status: 402,
      };
    }
    return {
      message: `fal.ai request failed (HTTP ${error.httpStatus}): ${error.message}`,
      status: 502,
    };
  }
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
  return { message: `Provider request failed: ${text}`, status: 502 };
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
    } else if (
      source.mode === "video:i2v" ||
      source.mode === "video:fal-i2v" ||
      source.mode === "video:fal-i2v-2.7" ||
      source.mode === "video:atlas-seedance-i2v" ||
      source.mode === "video:atlas-seedance-fast-i2v" ||
      source.mode === "image:flux" ||
      source.mode === "image:qwen"
    ) {
      return fail("Source input image for this job is missing, cannot retry.", 400);
    }

    let providerJobId: string;
    let providerStatus: import("@/types/app").JobStatus;
    let providerRaw: Record<string, unknown>;
    let model: string;

    if (isAtlasMode(source.mode)) {
      try {
        const atlasResult = await startAtlasJob({
          mode: source.mode,
          prompt: source.prompt,
          imageUrl:
            source.mode === "video:atlas-seedance-i2v" ||
            source.mode === "video:atlas-seedance-fast-i2v"
              ? inputImageUrl
              : undefined,
          duration: source.duration_seconds || 5,
        });
        providerJobId = atlasResult.predictionId;
        providerStatus = atlasResult.status;
        providerRaw = atlasResult.raw;
        model = atlasModelName(source.mode);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        return fail(normalized.message, normalized.status);
      }
    } else if (isFalMode(source.mode)) {
      try {
        const falResult = await startFalJob({
          mode: source.mode,
          prompt: source.prompt,
          imageUrl: inputImageUrl,
          duration: String(source.duration_seconds || 5),
        });
        providerJobId = falResult.requestId;
        providerStatus = falResult.status;
        providerRaw = falResult.raw;
        model = falModelName(source.mode);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        return fail(normalized.message, normalized.status);
      }
    } else {
      try {
        const runpodResult = await startRunpodJob({
          mode: source.mode,
          prompt: source.prompt,
          durationSeconds: source.duration_seconds || undefined,
          inputImageUrl,
        });
        providerJobId = runpodResult.id;
        providerStatus = runpodResult.status;
        providerRaw = runpodResult.raw;
        model = runpodModelNameForMode(source.mode);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        return fail(normalized.message, normalized.status);
      }
    }

    const newJob = await createGenerationJob({
      userId: user.id,
      mode: source.mode,
      model,
      prompt: source.prompt,
      durationSeconds: source.duration_seconds,
      inputMediaPath: source.input_media_path,
      runpodJobId: providerJobId,
      initialStatus: providerStatus,
      runpodRaw: providerRaw,
    });

    const providerName = isAtlasMode(source.mode)
      ? "Atlas Cloud"
      : isFalMode(source.mode)
        ? "fal.ai"
        : "RunPod";
    await createJobEvent(
      user.id,
      newJob.id,
      providerStatus,
      `Job retried from ${source.id} and submitted to ${providerName} with status ${providerStatus}.`,
      providerRaw,
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
