import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  createGenerationJob,
  createJobEvent,
  listUserJobs,
  mapJobRowToResponse,
  saveUploadedInput,
} from "@/lib/jobs";
import { RunpodError, runpodModelNameForMode, startRunpodJob } from "@/lib/runpod";
import type { JobMode } from "@/types/app";

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

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rows = await listUserJobs(user.id);

    return NextResponse.json({
      success: true,
      jobs: rows.map(mapJobRowToResponse),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const formData = await request.formData();

    const prompt = String(formData.get("prompt") || "").trim();
    const negativePrompt = String(formData.get("negativePrompt") || "").trim() || undefined;
    const mediaType = String(formData.get("mediaType") || "").trim();
    const videoMode = String(formData.get("videoMode") || "").trim();
    const imageModel = String(formData.get("imageModel") || "").trim();
    const durationRaw = Number(formData.get("duration") || 5);
    const resolutionRaw = String(formData.get("resolution") || "720p").trim();
    const sourceFile = formData.get("sourceFile");

    if (!prompt) return fail("Prompt is required.");
    if (!["image", "video"].includes(mediaType)) return fail("mediaType must be image or video.");

    const duration = [5, 10, 15].includes(durationRaw) ? durationRaw : 5;
    const resolution = (["720p", "1080p"] as const).includes(resolutionRaw as "720p" | "1080p")
      ? (resolutionRaw as "720p" | "1080p")
      : "720p";

    let mode: JobMode;
    if (mediaType === "video") {
      mode = videoMode === "i2v" ? "video:i2v" : "video:t2v";
    } else {
      const imageModelMap: Record<string, JobMode> = {
        qwen: "image:qwen",
        "qwen-t2i": "image:qwen-t2i",
        "qwen-2511": "image:qwen-2511",
        flux: "image:flux",
        "flux-dev": "image:flux-dev",
        "flux-schnell": "image:flux-schnell",
        "p-edit": "image:p-edit",
        "seedream-edit": "image:seedream-edit",
        "nano-banana": "image:nano-banana",
        "z-turbo": "image:z-turbo",
      };
      mode = imageModelMap[imageModel] || "image:flux-schnell";
    }

    const textOnlyModes: JobMode[] = ["video:t2v", "image:flux-dev", "image:flux-schnell", "image:qwen-t2i"];
    const fileRequired = !textOnlyModes.includes(mode);
    let inputPath: string | null = null;
    let inputSignedUrl: string | undefined;

    if (fileRequired) {
      if (!(sourceFile instanceof File)) {
        return fail("An image upload is required for this mode.");
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
      `Job submitted to RunPod with status ${runpodResult.status}.`,
      runpodResult.raw,
    );

    return NextResponse.json({
      success: true,
      message: "success",
      job: mapJobRowToResponse(jobRow),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unexpected server error.", 500);
  }
}
