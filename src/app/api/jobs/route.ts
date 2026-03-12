import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  createGenerationJob,
  createJobEvent,
  listUserJobs,
  mapJobRowToResponse,
  saveUploadedInput,
} from "@/lib/jobs";
import { runpodModelNameForMode, startRunpodJob } from "@/lib/runpod";
import type { JobMode } from "@/types/app";

const fail = (message: string, status = 400) =>
  NextResponse.json(
    {
      success: false,
      message,
    },
    { status },
  );

const normalizeRunpodError = (error: unknown) => {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "Unknown error";
  const lowered = text.toLowerCase();

  if (lowered.includes("insufficient") || lowered.includes("credit")) {
    return "RunPod request failed: no credits left or billing limit reached.";
  }

  return `RunPod request failed: ${text}`;
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
    const mediaType = String(formData.get("mediaType") || "").trim();
    const videoMode = String(formData.get("videoMode") || "").trim();
    const imageModel = String(formData.get("imageModel") || "").trim();
    const durationRaw = Number(formData.get("duration") || 5);
    const sourceFile = formData.get("sourceFile");

    if (!prompt) return fail("Prompt is required.");
    if (!["image", "video"].includes(mediaType)) return fail("mediaType must be image or video.");

    const duration = [5, 10, 15].includes(durationRaw) ? durationRaw : 5;

    let mode: JobMode;
    if (mediaType === "video") {
      mode = videoMode === "i2v" ? "video:i2v" : "video:t2v";
    } else {
      mode = imageModel === "qwen" ? "image:qwen" : "image:flux";
    }

    const fileRequired = mode === "video:i2v" || mode === "image:flux" || mode === "image:qwen";
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
        durationSeconds: mode.startsWith("video") ? duration : undefined,
        inputImageUrl: inputSignedUrl,
      });
    } catch (error) {
      return fail(normalizeRunpodError(error), 502);
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
