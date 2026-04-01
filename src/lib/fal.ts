import { envServer } from "@/lib/env/server";
import type { JobStatus } from "@/types/app";

/**
 * fal.ai Queue API client for Wan v2.6 Image-to-Video.
 *
 * Queue endpoints (per https://fal.ai/docs/model-apis/model-endpoints/queue):
 *   POST   https://queue.fal.run/{model-id}                          → submit
 *   GET    https://queue.fal.run/{model-id}/requests/{id}/status     → poll
 *   GET    https://queue.fal.run/{model-id}/requests/{id}            → result
 *   PUT    https://queue.fal.run/{model-id}/requests/{id}/cancel     → cancel
 */

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_MODEL_ID = "wan/v2.6/image-to-video";

export interface FalStartRequest {
  prompt: string;
  imageUrl: string;
  audioUrl?: string;
  resolution?: "720p" | "1080p";
  duration?: "5" | "10" | "15";
  negativePrompt?: string;
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

/**
 * Structured error thrown by fal.ai operations so callers can inspect
 * the HTTP status and whether this is a billing/credit issue.
 */
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

const falAuthHeader = () => `Key ${envServer.falKey}`;

/**
 * Submit a Wan 2.6 image-to-video job to the fal.ai queue.
 *
 * POST https://queue.fal.run/wan/v2.6/image-to-video
 * Authorization: Key $FAL_KEY
 *
 * Response: { request_id, response_url, status_url, cancel_url }
 */
export const startFalJob = async (input: FalStartRequest): Promise<FalRunResponse> => {
  if (!envServer.falKey) {
    throw new FalError({ error: "FAL_KEY is not configured. Add your fal.ai API key to continue." }, 401);
  }

  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    image_url: input.imageUrl,
    resolution: input.resolution || "1080p",
    duration: input.duration || "5",
    enable_prompt_expansion: false,
    enable_safety_checker: false,
  };

  if (input.negativePrompt) {
    payload.negative_prompt = input.negativePrompt;
  }

  if (input.audioUrl) {
    payload.audio_url = input.audioUrl;
  }

  const response = await fetch(`${FAL_QUEUE_BASE}/${FAL_MODEL_ID}`, {
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

/**
 * Poll the fal.ai queue for job status, and fetch the result when completed.
 *
 * Step 1: GET .../requests/{id}/status?logs=1
 *   → { status: "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED", queue_position, logs, metrics }
 *
 * Step 2 (only when COMPLETED): GET .../requests/{id}
 *   → { video: { url, content_type }, seed, actual_prompt }
 */
export const getFalJobStatus = async (requestId: string): Promise<FalStatusResponse> => {
  if (!envServer.falKey) {
    throw new FalError({ error: "FAL_KEY is not configured." }, 401);
  }

  const authHeader = falAuthHeader();

  // Step 1: GET queue status with logs
  const statusResponse = await fetch(
    `${FAL_QUEUE_BASE}/${FAL_MODEL_ID}/requests/${requestId}/status?logs=1`,
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
    // Parse progress from log messages if available
    const logs = statusBody.logs as Array<{ message?: string }> | undefined;
    if (Array.isArray(logs) && logs.length > 0) {
      // Walk logs in reverse to find latest percentage
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
        // In progress but no percentage in logs; estimate from log count
        progress = Math.min(80, Math.round((logs.length / 30) * 100));
      }
    } else {
      progress = 15; // In progress, no logs yet
    }
  }

  // Step 2: If COMPLETED, fetch the actual result
  if (mappedStatus === "COMPLETED") {
    const resultResponse = await fetch(
      `${FAL_QUEUE_BASE}/${FAL_MODEL_ID}/requests/${requestId}`,
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

    // Per API output schema: { video: { url, content_type }, seed, actual_prompt }
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

export const isFalMode = (mode: string): boolean => mode === "video:fal-i2v";

export const falModelName = "wan-v2.6-fal-i2v";
