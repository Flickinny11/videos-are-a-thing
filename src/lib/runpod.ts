import { envServer } from "@/lib/env/server";
import type { JobMode, JobStatus } from "@/types/app";

const RUNPOD_BASE = "https://api.runpod.ai/v2";

const MODEL_ENDPOINT_BY_MODE: Record<JobMode, string> = {
  "video:t2v": "wan-2-6-t2v",
  "video:i2v": "wan-2-6-i2v",
  "video:fal-i2v": "wan-v2.6-fal-i2v", // routed through fal.ai, not RunPod
  "video:fal-i2v-2.7": "wan-v2.7-fal-i2v", // routed through fal.ai, not RunPod
  "video:fal-r2v-2.7": "wan-v2.7-fal-r2v", // routed through fal.ai, not RunPod
  "image:flux": "black-forest-labs-flux-1-kontext-dev",
  "image:flux-dev": "black-forest-labs-flux-1-dev",
  "image:flux-schnell": "black-forest-labs-flux-1-schnell",
  "image:qwen-t2i": "qwen-image-t2i",
  "image:qwen": "qwen-image-edit",
  "image:qwen-2511": "qwen-image-edit-2511",
  "image:p-edit": "p-image-edit",
  "image:seedream-edit": "seedream-v4-edit",
  "image:nano-banana": "nano-banana-edit",
  "image:z-turbo": "z-image-turbo",
  "image:fal-edit-2.7": "wan-v2.7-fal-edit", // routed through fal.ai, not RunPod
  "image:fal-pro-edit-2.7": "wan-v2.7-fal-pro-edit", // routed through fal.ai, not RunPod
  "image:fal-t2i-2.7": "wan-v2.7-fal-t2i", // routed through fal.ai, not RunPod
  "image:fal-pro-t2i-2.7": "wan-v2.7-fal-pro-t2i", // routed through fal.ai, not RunPod
  "image:fal-seedream-edit-4.5": "seedream-v4.5-fal-edit", // routed through fal.ai, not RunPod
};

export interface RunpodStartRequest {
  mode: JobMode;
  prompt: string;
  negativePrompt?: string;
  durationSeconds?: number;
  resolution?: "720p" | "1080p";
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
  const outputObj = raw.output as Record<string, unknown> | string | number | undefined;

  // RunPod progress_update() writes directly to the `output` field as a
  // string or number while the job is IN_PROGRESS.  Try that first.
  const directOutput = typeof outputObj === "string" || typeof outputObj === "number" ? outputObj : undefined;

  const candidates = [
    directOutput,
    raw.progress,
    raw.progressPercent,
    raw.progress_percentage,
    ...(outputObj && typeof outputObj === "object"
      ? [
          (outputObj as Record<string, unknown>).progress,
          (outputObj as Record<string, unknown>).progressPercent,
          (outputObj as Record<string, unknown>).progress_percentage,
          (outputObj as Record<string, unknown>).percent,
        ]
      : []),
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

const withInputWrapper = (payload: Record<string, unknown>) => ({
  input: payload,
});

const withSafetyDisabled = (payload: Record<string, unknown>) => [
  withInputWrapper({
    ...payload,
    enable_safety_checker: false,
    safety_checker: false,
    nsfw: true,
  }),
];

const sizeForResolution = (resolution?: "720p" | "1080p"): string =>
  resolution === "1080p" ? "1920*1080" : "1280*720";

const maybeNegativePrompt = (negativePrompt?: string): Record<string, unknown> =>
  negativePrompt ? { negative_prompt: negativePrompt } : {};

const runCandidatePayloads = (input: RunpodStartRequest): Array<Record<string, unknown>> => {
  const neg = maybeNegativePrompt(input.negativePrompt);

  switch (input.mode) {
    case "video:t2v": {
      const duration = input.durationSeconds || 5;
      const base = {
        prompt: input.prompt,
        ...neg,
        duration,
        size: sizeForResolution(input.resolution),
        seed: -1,
        enable_prompt_expansion: false,
        enable_safety_checker: false,
        safety_checker: false,
        nsfw: true,
      };

      return [
        withInputWrapper(base),
        withInputWrapper({ ...base, video_length: duration }),
      ];
    }
    case "video:i2v": {
      const duration = input.durationSeconds || 5;
      const image = input.inputImageUrl;
      const base = {
        prompt: input.prompt,
        ...neg,
        image,
        duration,
        size: sizeForResolution(input.resolution),
        seed: -1,
        enable_prompt_expansion: false,
        enable_safety_checker: false,
        safety_checker: false,
        nsfw: true,
      };

      return [
        withInputWrapper(base),
        withInputWrapper({ ...base, image_url: image }),
        withInputWrapper({ ...base, input_image: image }),
      ];
    }
    case "image:flux": {
      const image = input.inputImageUrl;
      const base = {
        prompt: input.prompt,
        ...neg,
        image,
        seed: -1,
        guidance: 2.5,
        num_inference_steps: 30,
        enable_safety_checker: false,
      };

      return [
        withInputWrapper(base),
        withInputWrapper({ ...base, image_url: image }),
      ];
    }
    case "image:flux-dev": {
      const base = {
        prompt: input.prompt,
        ...neg,
        seed: -1,
        guidance: 7.5,
        num_inference_steps: 28,
        width: 1024,
        height: 1024,
      };

      return [withInputWrapper(base)];
    }
    case "image:flux-schnell": {
      const base = {
        prompt: input.prompt,
        ...neg,
        seed: -1,
        num_inference_steps: 4,
        width: 1024,
        height: 1024,
      };

      return [withInputWrapper(base)];
    }
    case "image:qwen-t2i": {
      const base = {
        prompt: input.prompt,
        ...neg,
        seed: -1,
        enable_safety_checker: false,
      };

      return [withInputWrapper(base)];
    }
    case "image:qwen": {
      const image = input.inputImageUrl;
      const base = {
        prompt: input.prompt,
        ...neg,
        image,
        seed: -1,
        enable_safety_checker: false,
      };

      return [
        withInputWrapper(base),
        withInputWrapper({ ...base, image_url: image }),
      ];
    }
    case "image:qwen-2511": {
      const image = input.inputImageUrl;
      return [
        withInputWrapper({
          prompt: input.prompt,
          images: [image],
          seed: -1,
          output_format: "png",
        }),
      ];
    }
    case "image:p-edit": {
      const image = input.inputImageUrl;
      return [
        withInputWrapper({
          prompt: input.prompt,
          images: [image],
          seed: -1,
          disable_safety_checker: true,
        }),
      ];
    }
    case "image:seedream-edit": {
      const image = input.inputImageUrl;
      return [
        withInputWrapper({
          prompt: input.prompt,
          images: [image],
          enable_safety_checker: false,
        }),
      ];
    }
    case "image:nano-banana": {
      const image = input.inputImageUrl;
      return [
        withInputWrapper({
          prompt: input.prompt,
          images: [image],
          enable_safety_checker: false,
        }),
      ];
    }
    case "image:z-turbo": {
      const image = input.inputImageUrl;
      return [
        withInputWrapper({
          prompt: input.prompt,
          image,
          strength: 0.8,
          seed: -1,
          enable_safety_checker: false,
        }),
      ];
    }
    case "video:fal-i2v":
      // Handled by fal.ai client, not RunPod
      return [withInputWrapper({ prompt: input.prompt })];
    default:
      return withSafetyDisabled({ prompt: input.prompt, ...neg });
  }
};

/**
 * Structured error thrown by RunPod operations so callers can inspect
 * the HTTP status and whether this is a billing/credit issue without
 * needing to keyword-match a JSON blob.
 */
export class RunpodError extends Error {
  httpStatus: number;
  isBillingError: boolean;
  runpodBody: Record<string, unknown>;

  constructor(body: Record<string, unknown>, httpStatus: number) {
    const errorField = typeof body.error === "string" ? body.error : "";
    const messageField = typeof body.message === "string" ? body.message : "";
    const detail = errorField || messageField || JSON.stringify(body);

    super(detail);
    this.name = "RunpodError";
    this.httpStatus = httpStatus;
    this.runpodBody = body;

    // Detect billing/credit issues from HTTP status codes (401 = auth,
    // 402 = payment required, 403 = forbidden which RunPod sometimes uses
    // for billing) AND from the specific error text in the response body.
    const lowerDetail = detail.toLowerCase();
    this.isBillingError =
      httpStatus === 402 ||
      (httpStatus === 401 && lowerDetail.includes("credit")) ||
      (httpStatus === 403 && lowerDetail.includes("credit")) ||
      lowerDetail.includes("insufficient fund") ||
      lowerDetail.includes("insufficient credit") ||
      lowerDetail.includes("no credits") ||
      lowerDetail.includes("billing limit") ||
      lowerDetail.includes("out of credit");
  }
}

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

/**
 * Returns true when a failed response is a billing/auth issue that
 * retrying with a different payload shape will never fix.
 */
const isBillingOrAuthFailure = (status: number, body: Record<string, unknown>): boolean => {
  if (status === 402) return true;
  const errorText = (typeof body.error === "string" ? body.error : "").toLowerCase();
  const messageText = (typeof body.message === "string" ? body.message : "").toLowerCase();
  const combined = `${errorText} ${messageText}`;
  return (
    combined.includes("insufficient fund") ||
    combined.includes("insufficient credit") ||
    combined.includes("no credits") ||
    combined.includes("billing limit") ||
    combined.includes("out of credit") ||
    ((status === 401 || status === 403) && combined.includes("credit"))
  );
};

export const startRunpodJob = async (input: RunpodStartRequest): Promise<RunpodRunResponse> => {
  const endpoint = MODEL_ENDPOINT_BY_MODE[input.mode];
  const candidates = runCandidatePayloads(input);

  let lastError: Record<string, unknown> | null = null;
  let lastStatus = 0;

  for (const payload of candidates) {
    const result = await runRequest(endpoint, payload);

    if (result.ok && typeof result.body.id === "string") {
      return {
        id: result.body.id,
        status: parseJobStatus(result.body.status),
        raw: result.body,
      };
    }

    lastError = result.body;
    lastStatus = result.status;

    // Billing/auth errors won't be fixed by trying a different payload
    // shape, so bail out immediately instead of burning through candidates.
    if (isBillingOrAuthFailure(result.status, result.body)) {
      break;
    }
  }

  throw new RunpodError(
    lastError || { error: "RunPod request failed before receiving a response body." },
    lastStatus,
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

  let raw: Record<string, unknown> = {};
  try {
    raw = (await response.json()) as Record<string, unknown>;
  } catch {
    raw = {};
  }

  if (!response.ok) {
    throw new Error(
      JSON.stringify({
        httpStatus: response.status,
        ...raw,
      }),
    );
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
