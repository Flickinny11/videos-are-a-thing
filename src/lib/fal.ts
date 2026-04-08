import { envServer } from "@/lib/env/server";
import type { JobMode, JobStatus } from "@/types/app";

/**
 * fal.ai Queue API client for Wan video models.
 *
 * Supported models:
 *   - Wan v2.6 Image-to-Video   (video:fal-i2v)
 *   - Wan v2.7 Image-to-Video   (video:fal-i2v-2.7)
 *   - Wan v2.7 Reference-to-Video (video:fal-r2v-2.7)
 *
 * Queue endpoints (per https://fal.ai/docs/model-apis/model-endpoints/queue):
 *   POST   https://queue.fal.run/{model-id}                          -> submit
 *   GET    https://queue.fal.run/{model-id}/requests/{id}/status     -> poll
 *   GET    https://queue.fal.run/{model-id}/requests/{id}            -> result
 *   PUT    https://queue.fal.run/{model-id}/requests/{id}/cancel     -> cancel
 */

const FAL_QUEUE_BASE = "https://queue.fal.run";

/** Map each fal.ai JobMode to its fal model ID. */
const FAL_MODEL_IDS: Record<string, string> = {
  "video:fal-i2v": "wan/v2.6/image-to-video",
  "video:fal-i2v-2.7": "wan/v2.7/image-to-video",
  "video:fal-r2v-2.7": "wan/v2.7/reference-to-video",
};

const falModelIdForMode = (mode: string): string => {
  const id = FAL_MODEL_IDS[mode];
  if (!id) throw new Error(`No fal.ai model ID mapped for mode "${mode}".`);
  return id;
};

// ── Shared types ────────────────────────────────────────────────────

export interface FalStartRequest {
  mode: JobMode;
  prompt: string;
  negativePrompt?: string;
  resolution?: "720p" | "1080p";
  duration?: string;
  /** Wan 2.6 & 2.7 I2V: primary start-frame image */
  imageUrl?: string;
  /** Wan 2.7 I2V: end-frame image for first-and-last-frame-to-video */
  endImageUrl?: string;
  /** Wan 2.6 & 2.7 I2V: driving audio (WAV/MP3) */
  audioUrl?: string;
  /** Wan 2.7 I2V: video clip to continue from (alternative to imageUrl) */
  videoUrl?: string;
  /** Wan 2.7 I2V: enable prompt expansion */
  enablePromptExpansion?: boolean;
  /** Wan 2.7 R2V: reference image URLs (multiple for multi-subject) */
  referenceImageUrls?: string[];
  /** Wan 2.7 R2V: reference video URLs (multiple for multi-subject) */
  referenceVideoUrls?: string[];
  /** Wan 2.7 R2V: aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  /** Wan 2.7 R2V: multi-shot segmentation */
  multiShots?: boolean;
}

export interface FalRunResponse {
  requestId: string;
  status: JobStatus;
  raw: Record<string, unknown>;
}

export interface FalStatusResponse {
  requestId: string;
  status: JobStatus;
  progress: number | null;
  videoUrl: string | null;
  seed: number | null;
  error: string | null;
  raw: Record<string, unknown>;
}

// ── Error class ─────────────────────────────────────────────────────

export class FalError extends Error {
  httpStatus: number;
  isBillingError: boolean;
  falBody: Record<string, unknown>;

  constructor(body: Record<string, unknown>, httpStatus: number) {
    const errorField = typeof body.error === "string" ? body.error : "";
    const messageField = typeof body.message === "string" ? body.message : "";
    const detailField = typeof body.detail === "string" ? body.detail : "";
    const detail = errorField || messageField || detailField || JSON.stringify(body);

    super(detail);
    this.name = "FalError";
    this.httpStatus = httpStatus;
    this.falBody = body;

    const lowerDetail = detail.toLowerCase();
    this.isBillingError =
      httpStatus === 402 ||
      httpStatus === 429 ||
      (httpStatus === 401 && lowerDetail.includes("credit")) ||
      (httpStatus === 403 && lowerDetail.includes("credit")) ||
      lowerDetail.includes("insufficient") ||
      lowerDetail.includes("no credits") ||
      lowerDetail.includes("billing") ||
      lowerDetail.includes("out of credit") ||
      lowerDetail.includes("exceeded") ||
      lowerDetail.includes("limit reached") ||
      lowerDetail.includes("balance");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

const falAuthHeader = () => `Key ${envServer.falKey}`;

const mapFalStatus = (status: string): JobStatus => {
  switch (status?.toUpperCase()) {
    case "COMPLETED":
      return "COMPLETED";
    case "IN_QUEUE":
      return "IN_QUEUE";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "FAILED":
      return "FAILED";
    default:
      return "IN_PROGRESS";
  }
};

// ── Payload builders ────────────────────────────────────────────────

const buildPayloadV26I2V = (input: FalStartRequest): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    image_url: input.imageUrl,
    resolution: input.resolution || "1080p",
    duration: input.duration || "5",
    enable_prompt_expansion: false,
    enable_safety_checker: false,
  };
  if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
  if (input.audioUrl) payload.audio_url = input.audioUrl;
  return payload;
};

const buildPayloadV27I2V = (input: FalStartRequest): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    resolution: input.resolution || "1080p",
    duration: Number(input.duration) || 5,
    enable_prompt_expansion: input.enablePromptExpansion ?? true,
    enable_safety_checker: false,
  };
  if (input.prompt) payload.prompt = input.prompt;
  if (input.imageUrl) payload.image_url = input.imageUrl;
  if (input.endImageUrl) payload.end_image_url = input.endImageUrl;
  if (input.videoUrl) payload.video_url = input.videoUrl;
  if (input.audioUrl) payload.audio_url = input.audioUrl;
  if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
  return payload;
};

const buildPayloadV27R2V = (input: FalStartRequest): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio || "16:9",
    resolution: input.resolution || "1080p",
    duration: Number(input.duration) || 5,
    multi_shots: input.multiShots ?? false,
    enable_safety_checker: false,
  };
  if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
  if (input.referenceImageUrls && input.referenceImageUrls.length > 0) {
    payload.reference_image_urls = input.referenceImageUrls;
  }
  if (input.referenceVideoUrls && input.referenceVideoUrls.length > 0) {
    payload.reference_video_urls = input.referenceVideoUrls;
  }
  return payload;
};

const buildPayload = (input: FalStartRequest): Record<string, unknown> => {
  switch (input.mode) {
    case "video:fal-i2v":
      return buildPayloadV26I2V(input);
    case "video:fal-i2v-2.7":
      return buildPayloadV27I2V(input);
    case "video:fal-r2v-2.7":
      return buildPayloadV27R2V(input);
    default:
      throw new Error(`Unsupported fal mode: ${input.mode}`);
  }
};

// ── Submit ──────────────────────────────────────────────────────────

/**
 * Submit a video generation job to the fal.ai queue.
 *
 * POST https://queue.fal.run/{model-id}
 * Authorization: Key $FAL_KEY
 *
 * Response: { request_id, response_url, status_url, cancel_url }
 */
export const startFalJob = async (input: FalStartRequest): Promise<FalRunResponse> => {
  if (!envServer.falKey) {
    throw new FalError({ error: "FAL_KEY is not configured. Add your fal.ai API key to continue." }, 401);
  }

  const modelId = falModelIdForMode(input.mode);
  const payload = buildPayload(input);

  const response = await fetch(`${FAL_QUEUE_BASE}/${modelId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: falAuthHeader(),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new FalError(body, response.status);
  }

  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  if (!requestId) {
    throw new FalError({ error: "fal.ai did not return a request_id.", ...body }, response.status);
  }

  return {
    requestId,
    status: "IN_QUEUE",
    raw: body,
  };
};

// ── Poll ────────────────────────────────────────────────────────────

/**
 * Poll the fal.ai queue for job status, and fetch the result when completed.
 *
 * Step 1: GET .../requests/{id}/status?logs=1
 *   -> { status, queue_position, logs, metrics }
 *
 * Step 2 (only when COMPLETED): GET .../requests/{id}
 *   -> { video: { url, content_type }, seed, actual_prompt }
 */
export const getFalJobStatus = async (
  mode: string,
  requestId: string,
): Promise<FalStatusResponse> => {
  if (!envServer.falKey) {
    throw new FalError({ error: "FAL_KEY is not configured." }, 401);
  }

  const modelId = falModelIdForMode(mode);
  const authHeader = falAuthHeader();

  // Step 1: GET queue status with logs
  const statusResponse = await fetch(
    `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/status?logs=1`,
    {
      method: "GET",
      headers: { Authorization: authHeader },
      cache: "no-store",
    },
  );

  let statusBody: Record<string, unknown> = {};
  try {
    statusBody = (await statusResponse.json()) as Record<string, unknown>;
  } catch {
    statusBody = {};
  }

  if (!statusResponse.ok) {
    throw new FalError(statusBody, statusResponse.status);
  }

  const queueStatus = String(statusBody.status || "IN_PROGRESS");
  const mappedStatus = mapFalStatus(queueStatus);

  // Extract progress from queue position or logs
  let progress: number | null = null;
  if (mappedStatus === "IN_QUEUE") {
    const queuePos = typeof statusBody.queue_position === "number" ? statusBody.queue_position : null;
    progress = queuePos !== null ? Math.max(1, 10 - queuePos) : 5;
  }
  if (mappedStatus === "IN_PROGRESS") {
    const logs = statusBody.logs as Array<{ message?: string }> | undefined;
    if (Array.isArray(logs) && logs.length > 0) {
      for (let i = logs.length - 1; i >= 0; i--) {
        const logMsg = logs[i]?.message;
        const msg = typeof logMsg === "string" ? logMsg : "";
        const match = msg.match(/(\d+)%/);
        if (match) {
          progress = parseInt(match[1], 10);
          break;
        }
      }
      if (progress === null) {
        progress = Math.min(80, Math.round((logs.length / 30) * 100));
      }
    } else {
      progress = 15;
    }
  }

  // Step 2: If COMPLETED, fetch the actual result
  if (mappedStatus === "COMPLETED") {
    const resultResponse = await fetch(
      `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}`,
      {
        method: "GET",
        headers: { Authorization: authHeader },
        cache: "no-store",
      },
    );

    let resultBody: Record<string, unknown> = {};
    try {
      resultBody = (await resultResponse.json()) as Record<string, unknown>;
    } catch {
      resultBody = {};
    }

    if (!resultResponse.ok) {
      throw new FalError(resultBody, resultResponse.status);
    }

    const video = resultBody.video as Record<string, unknown> | undefined;
    const videoUrl = typeof video?.url === "string" ? video.url : null;
    const seed = typeof resultBody.seed === "number" ? resultBody.seed : null;

    return {
      requestId,
      status: "COMPLETED",
      progress: 100,
      videoUrl,
      seed,
      error: null,
      raw: resultBody,
    };
  }

  if (mappedStatus === "FAILED") {
    const errorMsg =
      typeof statusBody.error === "string"
        ? statusBody.error
        : typeof statusBody.detail === "string"
          ? statusBody.detail
          : "fal.ai job failed.";

    return {
      requestId,
      status: "FAILED",
      progress: null,
      videoUrl: null,
      seed: null,
      error: errorMsg,
      raw: statusBody,
    };
  }

  return {
    requestId,
    status: mappedStatus,
    progress,
    videoUrl: null,
    seed: null,
    error: null,
    raw: statusBody,
  };
};

// ── Mode helpers ────────────────────────────────────────────────────

export const isFalMode = (mode: string): boolean =>
  mode in FAL_MODEL_IDS;

const FAL_MODEL_NAMES: Record<string, string> = {
  "video:fal-i2v": "wan-v2.6-fal-i2v",
  "video:fal-i2v-2.7": "wan-v2.7-fal-i2v",
  "video:fal-r2v-2.7": "wan-v2.7-fal-r2v",
};

export const falModelName = (mode: string): string =>
  FAL_MODEL_NAMES[mode] || "wan-fal-unknown";
