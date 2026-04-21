import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { AtlasError, atlasModelName, isAtlasMode, startAtlasJob } from "@/lib/atlas";
import { FalError, falModelName, isFalMode, startFalJob } from "@/lib/fal";
import {
  createGenerationJob,
  createJobEvent,
  mapJobRowToResponse,
  saveUploadedInput,
} from "@/lib/jobs";
import { RunpodError, runpodModelNameForMode, startRunpodJob } from "@/lib/runpod";
import type { JobMode } from "@/types/app";

const fail = (message: string, status = 400) =>
  NextResponse.json({ success: false, message }, { status });

const normalizeProviderError = (error: unknown): { message: string; status: number } => {
  if (error instanceof AtlasError) {
    if (error.isBillingError) {
      return {
        message:
          `Atlas Cloud billing error: ${error.message}. ` +
          "Add credits at https://www.atlascloud.ai/console and try again.",
        status: 402,
      };
    }
    return {
      message: `Atlas Cloud request failed (HTTP ${error.httpStatus}): ${error.message}`,
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
        message: "RunPod billing error: insufficient credits or billing limit reached.",
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

/**
 * POST /api/v1/generate
 *
 * Programmatic generation endpoint. Accepts either multipart/form-data
 * (with file uploads) or application/json (for text-only modes like t2v).
 *
 * JSON body example:
 * {
 *   "service": "video:t2v",
 *   "prompt": "A cinematic shot of...",
 *   "negativePrompt": "blur, watermark",
 *   "duration": 5,
 *   "resolution": "720p"
 * }
 *
 * Form-data fields:
 * - service: JobMode (required)
 * - prompt: string (required)
 * - negativePrompt: string (optional)
 * - duration: number (optional, video only)
 * - resolution: string (optional, video only)
 * - sourceFile: File (required for i2v, flux, qwen)
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);

    let service: string;
    let prompt: string;
    let negativePrompt: string | undefined;
    let duration = 5;
    let resolution: "720p" | "1080p" = "720p";
    let sourceFile: File | null = null;

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      service = String(formData.get("service") || "").trim();
      prompt = String(formData.get("prompt") || "").trim();
      negativePrompt = String(formData.get("negativePrompt") || "").trim() || undefined;
      duration = Number(formData.get("duration") || 5);
      resolution = String(formData.get("resolution") || "720p").trim() as "720p" | "1080p";
      const file = formData.get("sourceFile");
      if (file instanceof File) sourceFile = file;
    } else {
      const body = (await request.json()) as Record<string, unknown>;
      service = String(body.service || "").trim();
      prompt = String(body.prompt || "").trim();
      negativePrompt = body.negativePrompt ? String(body.negativePrompt).trim() : undefined;
      duration = Number(body.duration || 5);
      resolution = String(body.resolution || "720p").trim() as "720p" | "1080p";
    }

    if (!prompt) return fail("prompt is required.");

    const validModes: JobMode[] = [
      "video:t2v", "video:i2v", "video:fal-i2v",
      "video:fal-i2v-2.7", "video:fal-r2v-2.7",
      "video:atlas-seedance-i2v", "video:atlas-seedance-fast-i2v",
      "video:atlas-seedance-r2v", "video:atlas-seedance-fast-r2v",
      "video:atlas-seedance-t2v", "video:atlas-seedance-fast-t2v",
      "image:flux", "image:flux-dev", "image:flux-schnell",
      "image:qwen-t2i", "image:qwen", "image:qwen-2511",
      "image:p-edit", "image:seedream-edit", "image:nano-banana", "image:z-turbo",
      "image:fal-edit-2.7", "image:fal-pro-edit-2.7",
      "image:fal-t2i-2.7", "image:fal-pro-t2i-2.7",
    ];
    if (!validModes.includes(service as JobMode)) {
      return fail(`service must be one of: ${validModes.join(", ")}`);
    }

    const mode = service as JobMode;
    duration = duration >= 2 && duration <= 15 ? duration : 5;
    if (!["720p", "1080p"].includes(resolution)) resolution = "720p";

    const noSourceFileModes: JobMode[] = [
      "video:t2v", "video:fal-r2v-2.7", "video:fal-i2v-2.7",
      "video:atlas-seedance-r2v", "video:atlas-seedance-fast-r2v",
      "video:atlas-seedance-t2v", "video:atlas-seedance-fast-t2v",
      "image:flux-dev", "image:flux-schnell", "image:qwen-t2i",
      "image:fal-t2i-2.7", "image:fal-pro-t2i-2.7",
      "image:fal-edit-2.7", "image:fal-pro-edit-2.7",
    ];
    const fileRequired = !noSourceFileModes.includes(mode);
    let inputPath: string | null = null;
    let inputSignedUrl: string | undefined;

    if (fileRequired) {
      if (!sourceFile) {
        return fail("sourceFile is required for this service. Use multipart/form-data to upload.");
      }
      const upload = await saveUploadedInput({ userId: user.id, file: sourceFile });
      inputPath = upload.path;
      inputSignedUrl = upload.signedUrl;
    } else if (sourceFile) {
      const upload = await saveUploadedInput({ userId: user.id, file: sourceFile });
      inputPath = upload.path;
      inputSignedUrl = upload.signedUrl;
    }

    let providerJobId: string;
    let providerStatus: import("@/types/app").JobStatus;
    let providerRaw: Record<string, unknown>;
    let model: string;

    if (isAtlasMode(mode)) {
      try {
        const atlasResult = await startAtlasJob({
          mode,
          prompt,
          imageUrl:
            mode === "video:atlas-seedance-i2v" || mode === "video:atlas-seedance-fast-i2v"
              ? inputSignedUrl
              : undefined,
          duration,
        });
        providerJobId = atlasResult.predictionId;
        providerStatus = atlasResult.status;
        providerRaw = atlasResult.raw;
        model = atlasModelName(mode);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        return fail(normalized.message, normalized.status);
      }
    } else if (isFalMode(mode)) {
      try {
        const falResult = await startFalJob({
          mode,
          prompt,
          imageUrl: inputSignedUrl,
          resolution,
          duration: String(duration),
          negativePrompt,
        });
        providerJobId = falResult.requestId;
        providerStatus = falResult.status;
        providerRaw = falResult.raw;
        model = falModelName(mode);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        return fail(normalized.message, normalized.status);
      }
    } else {
      try {
        const runpodResult = await startRunpodJob({
          mode,
          prompt,
          negativePrompt,
          durationSeconds: mode.startsWith("video") ? duration : undefined,
          resolution: mode.startsWith("video") ? resolution : undefined,
          inputImageUrl: inputSignedUrl,
        });
        providerJobId = runpodResult.id;
        providerStatus = runpodResult.status;
        providerRaw = runpodResult.raw;
        model = runpodModelNameForMode(mode);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        return fail(normalized.message, normalized.status);
      }
    }

    const jobRow = await createGenerationJob({
      userId: user.id,
      mode,
      model,
      prompt,
      durationSeconds: mode.startsWith("video") ? duration : null,
      inputMediaPath: inputPath,
      runpodJobId: providerJobId,
      initialStatus: providerStatus,
      runpodRaw: providerRaw,
    });

    const providerName = isAtlasMode(mode)
      ? "Atlas Cloud"
      : isFalMode(mode)
        ? "fal.ai"
        : "RunPod";
    await createJobEvent(
      user.id,
      jobRow.id,
      providerStatus,
      `Job submitted to ${providerName} via programmatic API with status ${providerStatus}.`,
      providerRaw,
    );

    return NextResponse.json({
      success: true,
      job: mapJobRowToResponse(jobRow),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = message === "Unauthorized" ? 401 : 500;
    return fail(message, status);
  }
}
