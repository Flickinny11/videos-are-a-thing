import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { FalError, falModelName, isFalMode, startFalJob } from "@/lib/fal";
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

const normalizeProviderError = (error: unknown): { message: string; status: number } => {
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

    const duration = durationRaw >= 2 && durationRaw <= 15 ? durationRaw : 5;
    const resolution = (["720p", "1080p"] as const).includes(resolutionRaw as "720p" | "1080p")
      ? (resolutionRaw as "720p" | "1080p")
      : "720p";

    const videoProvider = String(formData.get("videoProvider") || "runpod").trim();
    const audioFile = formData.get("audioFile");

    let mode: JobMode;
    if (mediaType === "video") {
      if (videoProvider === "fal") {
        mode = "video:fal-i2v";
      } else if (videoProvider === "fal-i2v-2.7") {
        mode = "video:fal-i2v-2.7";
      } else if (videoProvider === "fal-r2v-2.7") {
        mode = "video:fal-r2v-2.7";
      } else {
        mode = videoMode === "i2v" ? "video:i2v" : "video:t2v";
      }
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
        "fal-edit-2.7": "image:fal-edit-2.7",
        "fal-pro-edit-2.7": "image:fal-pro-edit-2.7",
        "fal-t2i-2.7": "image:fal-t2i-2.7",
        "fal-pro-t2i-2.7": "image:fal-pro-t2i-2.7",
      };
      mode = imageModelMap[imageModel] || "image:flux-schnell";
    }

    // Modes that don't require the main sourceFile upload:
    // - T2V, R2V (ref images), I2V 2.7 (optional), fal T2I, fal edit (uses editImage fields)
    const noSourceFileModes: JobMode[] = [
      "video:t2v", "video:fal-r2v-2.7", "video:fal-i2v-2.7",
      "image:flux-dev", "image:flux-schnell", "image:qwen-t2i",
      "image:fal-t2i-2.7", "image:fal-pro-t2i-2.7",
      "image:fal-edit-2.7", "image:fal-pro-edit-2.7",
    ];
    const fileRequired = !noSourceFileModes.includes(mode);
    let inputPath: string | null = null;
    let inputSignedUrl: string | undefined;

    if (fileRequired) {
      if (!(sourceFile instanceof File)) {
        return fail("An image upload is required for this mode.");
      }

      const upload = await saveUploadedInput({ userId: user.id, file: sourceFile });
      inputPath = upload.path;
      inputSignedUrl = upload.signedUrl;
    } else if (sourceFile instanceof File && sourceFile.size > 0) {
      // Optional file upload (e.g. I2V 2.7 start frame)
      const upload = await saveUploadedInput({ userId: user.id, file: sourceFile });
      inputPath = upload.path;
      inputSignedUrl = upload.signedUrl;
    }

    // Handle optional audio upload for fal.ai I2V modes
    let audioSignedUrl: string | undefined;
    if ((mode === "video:fal-i2v" || mode === "video:fal-i2v-2.7") && audioFile instanceof File && audioFile.size > 0) {
      const audioUpload = await saveUploadedInput({ userId: user.id, file: audioFile });
      audioSignedUrl = audioUpload.signedUrl;
    }

    let providerJobId: string;
    let providerStatus: import("@/types/app").JobStatus;
    let providerRaw: Record<string, unknown>;
    let model: string;

    // Handle additional uploads for Wan 2.7 models
    const referenceImageUrls: string[] = [];
    const referenceVideoUrls: string[] = [];
    let endImageSignedUrl: string | undefined;

    if (mode === "video:fal-r2v-2.7") {
      // Collect multiple reference images
      for (const [key, value] of formData.entries()) {
        if (key.startsWith("referenceImage") && value instanceof File && value.size > 0) {
          const upload = await saveUploadedInput({ userId: user.id, file: value });
          referenceImageUrls.push(upload.signedUrl);
        }
        if (key.startsWith("referenceVideo") && value instanceof File && value.size > 0) {
          const upload = await saveUploadedInput({ userId: user.id, file: value });
          referenceVideoUrls.push(upload.signedUrl);
        }
      }
    }

    if (mode === "video:fal-i2v-2.7") {
      const endImageFile = formData.get("endImageFile");
      if (endImageFile instanceof File && endImageFile.size > 0) {
        const upload = await saveUploadedInput({ userId: user.id, file: endImageFile });
        endImageSignedUrl = upload.signedUrl;
      }
    }

    // Handle fal.ai edit model image uploads (1-4 images via editImage_* fields)
    const editImageUrls: string[] = [];
    if (mode === "image:fal-edit-2.7" || mode === "image:fal-pro-edit-2.7") {
      for (const [key, value] of formData.entries()) {
        if (key.startsWith("editImage_") && value instanceof File && value.size > 0) {
          const upload = await saveUploadedInput({ userId: user.id, file: value });
          editImageUrls.push(upload.signedUrl);
        }
      }
      if (editImageUrls.length === 0) {
        return fail("At least one image is required for edit models.");
      }
    }

    // Image size and num_images for fal.ai image models
    const imageSizeRaw = String(formData.get("imageSize") || "square_hd").trim();
    const numImagesRaw = Number(formData.get("numImages") || 1);
    const numImages = numImagesRaw >= 1 && numImagesRaw <= 5 ? numImagesRaw : 1;

    const aspectRatioRaw = String(formData.get("aspectRatio") || "16:9").trim();
    const aspectRatio = (["16:9", "9:16", "1:1", "4:3", "3:4"] as const).includes(
      aspectRatioRaw as "16:9"
    )
      ? (aspectRatioRaw as "16:9" | "9:16" | "1:1" | "4:3" | "3:4")
      : "16:9";
    const multiShots = formData.get("multiShots") === "true";
    const enablePromptExpansion = formData.get("enablePromptExpansion") !== "false";

    if (isFalMode(mode)) {
      try {
        const falResult = await startFalJob({
          mode,
          prompt,
          imageUrl: inputSignedUrl,
          audioUrl: audioSignedUrl,
          endImageUrl: endImageSignedUrl,
          resolution,
          duration: String(duration),
          negativePrompt,
          referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
          referenceVideoUrls: referenceVideoUrls.length > 0 ? referenceVideoUrls : undefined,
          aspectRatio,
          multiShots,
          enablePromptExpansion,
          imageUrls: editImageUrls.length > 0 ? editImageUrls : undefined,
          imageSize: imageSizeRaw as import("@/lib/fal").FalImageSize,
          numImages,
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

    const providerName = isFalMode(mode) ? "fal.ai" : "RunPod";
    await createJobEvent(
      user.id,
      jobRow.id,
      providerStatus,
      `Job submitted to ${providerName} with status ${providerStatus}.`,
      providerRaw,
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
