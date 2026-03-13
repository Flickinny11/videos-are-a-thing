import { envServer } from "@/lib/env/server";
import type { JobMode, JobStatus } from "@/types/app";

const RUNPOD_BASE = "https://api.runpod.ai/v2";

const MODEL_ENDPOINT_BY_MODE: Record<JobMode, string> = {
  "video:t2v": "wan-2-6-t2v",
  "video:i2v": "wan-2-6-i2v",
  "image:flux": "black-forest-labs-flux-1-kontext-dev",
  "image:qwen": "qwen-image-edit",
};

export interface RunpodStartRequest {
  mode: JobMode;
  prompt: string;
  durationSeconds?: number;
  inputImageUrl?: string;
}

export interface RunpodRunResponse {
  id: string;
  status: JobStatus;
  raw: Record<string, unknown>;
}

export interface RunpodStatusResponse {
  id: string;
  status: JobStatus;
  delayTime: number | null;
  executionTime: number | null;
  error: string | null;
  output: Record<string, unknown> | null;
  progressPercent: number | null;
  raw: Record<string, unknown>;
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${envServer.runpodApiKey}`,
};

const parseJobStatus = (value: unknown): JobStatus => {
  const status = String(value || "FAILED").toUpperCase();
  if (
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS" ||
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "TIMED_OUT" ||
    status === "RETRY" ||
    status === "THROTTLED"
  ) {
    return status;
  }

  return "FAILED";
};

const firstNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const extractProgressPercent = (raw: Record<string, unknown>): number | null => {
  const candidates = [
    raw.progress,
    raw.progressPercent,
    raw.progress_percentage,
    (raw.output as Record<string, unknown> | undefined)?.progress,
    (raw.output as Record<string, unknown> | undefined)?.progressPercent,
  ];

  for (const candidate of candidates) {
    const value = firstNumber(candidate);
    if (value !== null) {
      if (value >= 0 && value <= 1) return Math.round(value * 100);
      if (value >= 0 && value <= 100) return Math.round(value);
    }
  }

  return null;
};

const runCandidatePayloads = (input: RunpodStartRequest): Array<Record<string, unknown>> => {
  const safety = { enable_safety_checker: false };

  switch (input.mode) {
    case "video:t2v":
      return [
        { prompt: input.prompt, duration: input.durationSeconds, ...safety },
        { prompt: input.prompt, video_length: input.durationSeconds, ...safety },
        { prompt: input.prompt, seconds: input.durationSeconds, ...safety },
      ];
    case "video:i2v":
      return [
        {
          prompt: input.prompt,
          image_url: input.inputImageUrl,
          duration: input.durationSeconds,
          ...safety,
        },
        {
          prompt: input.prompt,
          image: input.inputImageUrl,
          duration: input.durationSeconds,
          ...safety,
        },
        {
          prompt: input.prompt,
          input_image: input.inputImageUrl,
          duration: input.durationSeconds,
          ...safety,
        },
      ];
    case "image:flux":
      return [
        { prompt: input.prompt, image_url: input.inputImageUrl, ...safety },
        { prompt: input.prompt, image: input.inputImageUrl, ...safety },
        { prompt: input.prompt, input_image: input.inputImageUrl, ...safety },
      ];
    case "image:qwen":
      return [
        { prompt: input.prompt, image_url: input.inputImageUrl, ...safety },
        { instruction: input.prompt, image_url: input.inputImageUrl, ...safety },
        { prompt: input.prompt, image: input.inputImageUrl, ...safety },
      ];
    default:
      return [{ prompt: input.prompt, ...safety }];
  }
};

const runRequest = async (
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; body: Record<string, unknown>; status: number }> => {
  const response = await fetch(`${RUNPOD_BASE}/${endpoint}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  return { ok: response.ok, body, status: response.status };
};

export const startRunpodJob = async (input: RunpodStartRequest): Promise<RunpodRunResponse> => {
  const endpoint = MODEL_ENDPOINT_BY_MODE[input.mode];
  const candidates = runCandidatePayloads(input);

  let lastError: Record<string, unknown> | null = null;

  for (const payload of candidates) {
    const result = await runRequest(endpoint, payload);

    if (result.ok && typeof result.body.id === "string") {
      return {
        id: result.body.id,
        status: parseJobStatus(result.body.status),
        raw: result.body,
      };
    }

    lastError = {
      ...result.body,
      httpStatus: result.status,
      attemptedPayload: payload,
    };
  }

  throw new Error(
    JSON.stringify(lastError || { error: "RunPod request failed before receiving a response body." }),
  );
};

export const getRunpodJobStatus = async (
  mode: JobMode,
  runpodJobId: string,
): Promise<RunpodStatusResponse> => {
  const endpoint = MODEL_ENDPOINT_BY_MODE[mode];

  const response = await fetch(`${RUNPOD_BASE}/${endpoint}/status/${runpodJobId}`, {
    headers: {
      Authorization: headers.Authorization,
    },
    cache: "no-store",
  });

  const raw = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(JSON.stringify(raw));
  }

  return {
    id: String(raw.id || runpodJobId),
    status: parseJobStatus(raw.status),
    delayTime: firstNumber(raw.delayTime),
    executionTime: firstNumber(raw.executionTime),
    error: raw.error ? String(raw.error) : null,
    output: (raw.output as Record<string, unknown> | null) || null,
    progressPercent: extractProgressPercent(raw),
    raw,
  };
};

const isLikelyMediaUrl = (value: string, kind: "video" | "image") => {
  const lower = value.toLowerCase();
  if (!lower.startsWith("http")) return false;
  if (kind === "video") {
    return /\.(mp4|mov|webm|m4v)(\?|$)/.test(lower) || lower.includes("video");
  }

  return /\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(lower) || lower.includes("image");
};

const flattenUrls = (obj: unknown, out: string[] = []): string[] => {
  if (typeof obj === "string" && obj.startsWith("http")) {
    out.push(obj);
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item) => flattenUrls(item, out));
    return out;
  }

  if (obj && typeof obj === "object") {
    Object.values(obj as Record<string, unknown>).forEach((value) => flattenUrls(value, out));
  }

  return out;
};

export const extractMediaUrlFromOutput = (
  output: Record<string, unknown> | null,
  kind: "video" | "image",
): string | null => {
  if (!output) return null;

  const priorityKeys = kind === "video" ? ["video_url", "video", "url"] : ["image_url", "image", "url"];

  for (const key of priorityKeys) {
    const candidate = output[key];
    if (typeof candidate === "string" && isLikelyMediaUrl(candidate, kind)) {
      return candidate;
    }
  }

  const urls = flattenUrls(output);
  const matched = urls.find((candidate) => isLikelyMediaUrl(candidate, kind));
  return matched || urls[0] || null;
};

export const runpodModelNameForMode = (mode: JobMode): string => MODEL_ENDPOINT_BY_MODE[mode];
