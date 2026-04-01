import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { FalError, falModelName, isFalMode, startFalJob } from "@/lib/fal";
import {
  createGenerationJob,
  createJobEvent,
  mapJobRowToResponse,
  saveUploadedInput,
} from "@/lib/jobs";
import { RunpodError, runpodModelNameForMode, startRunpodJob } from "@/lib/runpod";
import type { JobMode } from "@/types/app";

interface WorkflowStep {
  service: JobMode;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  resolution?: "720p" | "1080p";
}

const fail = (message: string, status = 400) =>
  NextResponse.json({ success: false, message }, { status });

/**
 * POST /api/v1/workflows
 *
 * Submit a batch of generation jobs in one request.
 * All jobs are submitted in parallel. Useful for creating
 * multi-step pipelines or batch processing.
 *
 * JSON body:
 * {
 *   "steps": [
 *     { "service": "video:t2v", "prompt": "...", "duration": 5 },
 *     { "service": "image:qwen", "prompt": "..." }
 *   ]
 * }
 *
 * For steps that require file uploads, first upload via /api/v1/upload,
 * then reference the signed URL with "inputImageUrl" in the step.
 *
 * Multipart form-data is also supported:
 * - steps: JSON string of the steps array
 * - sourceFile_0, sourceFile_1, etc: files for each step that needs one
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);

    let steps: Array<WorkflowStep & { inputImageUrl?: string }> = [];
    const fileMap = new Map<number, File>();

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const stepsJson = String(formData.get("steps") || "[]");
      try {
        steps = JSON.parse(stepsJson);
      } catch {
        return fail("steps must be valid JSON.");
      }

      // Collect indexed files: sourceFile_0, sourceFile_1, etc.
      for (const [key, value] of formData.entries()) {
        if (key.startsWith("sourceFile_") && value instanceof File) {
          const index = parseInt(key.replace("sourceFile_", ""), 10);
          if (!isNaN(index)) fileMap.set(index, value);
        }
      }
    } else {
      const body = (await request.json()) as { steps?: unknown[] };
      if (!Array.isArray(body.steps)) {
        return fail("steps must be an array.");
      }
      steps = body.steps as Array<WorkflowStep & { inputImageUrl?: string }>;
    }

    if (!steps.length) return fail("At least one step is required.");
    if (steps.length > 20) return fail("Maximum 20 steps per workflow.");

    const validModes: JobMode[] = [
      "video:t2v", "video:i2v", "video:fal-i2v",
      "image:flux", "image:flux-dev", "image:flux-schnell",
      "image:qwen-t2i", "image:qwen", "image:qwen-2511",
      "image:p-edit", "image:seedream-edit", "image:nano-banana", "image:z-turbo",
    ];

    const results = await Promise.allSettled(
      steps.map(async (step, index) => {
        if (!step.prompt?.trim()) {
          throw new Error(`Step ${index}: prompt is required.`);
        }
        if (!validModes.includes(step.service)) {
          throw new Error(`Step ${index}: service must be one of: ${validModes.join(", ")}`);
        }

        const mode = step.service;
        const textOnlyModes: JobMode[] = ["video:t2v", "image:flux-dev", "image:flux-schnell", "image:qwen-t2i"];
        const fileRequired = !textOnlyModes.includes(mode);

        let inputSignedUrl = step.inputImageUrl;
        let inputPath: string | null = null;

        if (fileRequired && !inputSignedUrl) {
          const file = fileMap.get(index);
          if (!file) {
            throw new Error(
              `Step ${index}: ${mode} requires an image. Either provide inputImageUrl or upload sourceFile_${index}.`,
            );
          }
          const upload = await saveUploadedInput({ userId: user.id, file });
          inputPath = upload.path;
          inputSignedUrl = upload.signedUrl;
        }

        const duration = [5, 10, 15].includes(step.duration || 0) ? step.duration! : 5;
        const resolution = step.resolution === "1080p" ? "1080p" : "720p";

        let providerJobId: string;
        let providerStatus: import("@/types/app").JobStatus;
        let providerRaw: Record<string, unknown>;
        let model: string;

        if (isFalMode(mode)) {
          const falResult = await startFalJob({
            prompt: step.prompt.trim(),
            imageUrl: inputSignedUrl!,
            resolution,
            duration: String(duration) as "5" | "10" | "15",
            negativePrompt: step.negativePrompt?.trim(),
          });
          providerJobId = falResult.requestId;
          providerStatus = falResult.status;
          providerRaw = falResult.raw;
          model = falModelName;
        } else {
          const runpodResult = await startRunpodJob({
            mode,
            prompt: step.prompt.trim(),
            negativePrompt: step.negativePrompt?.trim(),
            durationSeconds: mode.startsWith("video") ? duration : undefined,
            resolution: mode.startsWith("video") ? resolution : undefined,
            inputImageUrl: inputSignedUrl,
          });
          providerJobId = runpodResult.id;
          providerStatus = runpodResult.status;
          providerRaw = runpodResult.raw;
          model = runpodModelNameForMode(mode);
        }

        const jobRow = await createGenerationJob({
          userId: user.id,
          mode,
          model,
          prompt: step.prompt.trim(),
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
          `Workflow step ${index} submitted to ${providerName} via programmatic API.`,
          providerRaw,
        );

        return mapJobRowToResponse(jobRow);
      }),
    );

    const jobs = results.map((result, index) => {
      if (result.status === "fulfilled") {
        return { step: index, success: true, job: result.value };
      }

      const error = result.reason;
      let message = "Unknown error";
      if (error instanceof FalError) {
        message = error.isBillingError
          ? "fal.ai billing error: insufficient credits. Add credits and try again."
          : `fal.ai failed (HTTP ${error.httpStatus}): ${error.message}`;
      } else if (error instanceof RunpodError) {
        message = error.isBillingError
          ? "RunPod billing error: insufficient credits."
          : `RunPod failed (HTTP ${error.httpStatus}): ${error.message}`;
      } else if (error instanceof Error) {
        message = error.message;
      }

      return { step: index, success: false, error: message };
    });

    const allSucceeded = jobs.every((j) => j.success);

    return NextResponse.json({
      success: allSucceeded,
      totalSteps: steps.length,
      succeeded: jobs.filter((j) => j.success).length,
      failed: jobs.filter((j) => !j.success).length,
      results: jobs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow submission failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return fail(message, status);
  }
}
