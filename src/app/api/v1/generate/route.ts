import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
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

const normalizeRunpodError = (error: unknown): { message: string; status: number } => {
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
  return { message: `RunPod request failed: ${text}`, status: 502 };
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
      "video:t2v", "video:i2v",
      "image:flux", "image:flux-dev", "image:flux-schnell",
      "image:qwen-t2i", "image:qwen", "image:qwen-2511",
      "image:p-edit", "image:seedream-edit", "image:nano-banana", "image:z-turbo",
    ];
    if (!validModes.includes(service as JobMode)) {
      return fail(`service must be one of: ${validModes.join(", ")}`);
    }

    const mode = service as JobMode;
    duration = [5, 10, 15].includes(duration) ? duration : 5;
    if (!["720p", "1080p"].includes(resolution)) resolution = "720p";

    const textOnlyModes: JobMode[] = ["video:t2v", "image:flux-dev", "image:flux-schnell", "image:qwen-t2i"];
    const fileRequired = !textOnlyModes.includes(mode);
    let inputPath: string | null = null;
    let inputSignedUrl: string | undefined;

    if (fileRequired) {
      if (!sourceFile) {
        return fail("sourceFile is required for this service. Use multipart/form-data to upload.");
      }
      const upload = await saveUploadedInput({ userId: user.id, file: sourceFile });
      inputPath = upload.path;
      inputSignedUrl = upload.signedUrl;
    }

    let runpodResult;
    try {
      runpodResult = await startRunpodJob({
        mode,
        prompt,
        negativePrompt,
        durationSeconds: mode.startsWith("video") ? duration : undefined,
        resolution: mode.startsWith("video") ? resolution : undefined,
        inputImageUrl: inputSignedUrl,
      });
    } catch (error) {
      const normalized = normalizeRunpodError(error);
      return fail(normalized.message, normalized.status);
    }

    const model = runpodModelNameForMode(mode);
    const jobRow = await createGenerationJob({
      userId: user.id,
      mode,
      model,
      prompt,
      durationSeconds: mode.startsWith("video") ? duration : null,
      inputMediaPath: inputPath,
      runpodJobId: runpodResult.id,
      initialStatus: runpodResult.status,
      runpodRaw: runpodResult.raw,
    });

    await createJobEvent(
      user.id,
      jobRow.id,
      runpodResult.status,
      `Job submitted via programmatic API with status ${runpodResult.status}.`,
      runpodResult.raw,
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
