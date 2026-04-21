import { envServer } from "@/lib/env/server";
import type { JobMode, JobStatus, MediaKind } from "@/types/app";

/**
 * Atlas Cloud Seedance 2.0 client.
 *
 * Atlas Cloud hosts ByteDance Seedance 2.0 variants with less-restrictive
 * content moderation than fal.ai / Volcengine — in particular, realistic
 * human faces / likeness are permitted. There is NO `safety_filter` toggle;
 * moderation is infra-level.
 *
 * Endpoints (base: https://api.atlascloud.ai/api/v1):
 *   POST /model/uploadMedia        — multipart upload, returns URL
 *   POST /model/generateVideo      — submit (returns predictionId)
 *   GET  /model/getResult?predictionId={id}   — primary poll
 *   GET  /model/result/{id}        — fallback poll (404-retry target)
 *
 * Supported JobModes:
 *   video:atlas-seedance-i2v          — bytedance/seedance-2.0/image-to-video
 *   video:atlas-seedance-fast-i2v     — bytedance/seedance-2.0-fast/image-to-video
 *   video:atlas-seedance-r2v          — bytedance/seedance-2.0/reference-to-video
 *   video:atlas-seedance-fast-r2v     — bytedance/seedance-2.0-fast/reference-to-video
 *   video:atlas-seedance-t2v          — bytedance/seedance-2.0/text-to-video
 *   video:atlas-seedance-fast-t2v     — bytedance/seedance-2.0-fast/text-to-video
 */

const ATLAS_BASE = "https://api.atlascloud.ai/api/v1";

export type AtlasSeedanceVariant =
  | "bytedance/seedance-2.0/image-to-video"
  | "bytedance/seedance-2.0-fast/image-to-video"
  | "bytedance/seedance-2.0/reference-to-video"
  | "bytedance/seedance-2.0-fast/reference-to-video"
  | "bytedance/seedance-2.0/text-to-video"
  | "bytedance/seedance-2.0-fast/text-to-video";

const ATLAS_MODEL_IDS: Record<string, AtlasSeedanceVariant> = {
  "video:atlas-seedance-i2v": "bytedance/seedance-2.0/image-to-video",
  "video:atlas-seedance-fast-i2v": "bytedance/seedance-2.0-fast/image-to-video",
  "video:atlas-seedance-r2v": "bytedance/seedance-2.0/reference-to-video",
  "video:atlas-seedance-fast-r2v": "bytedance/seedance-2.0-fast/reference-to-video",
  "video:atlas-seedance-t2v": "bytedance/seedance-2.0/text-to-video",
  "video:atlas-seedance-fast-t2v": "bytedance/seedance-2.0-fast/text-to-video",
};

const ATLAS_MODEL_NAMES: Record<string, string> = {
  "video:atlas-seedance-i2v": "seedance-2.0-atlas-i2v",
  "video:atlas-seedance-fast-i2v": "seedance-2.0-fast-atlas-i2v",
  "video:atlas-seedance-r2v": "seedance-2.0-atlas-r2v",
  "video:atlas-seedance-fast-r2v": "seedance-2.0-fast-atlas-r2v",
  "video:atlas-seedance-t2v": "seedance-2.0-atlas-t2v",
  "video:atlas-seedance-fast-t2v": "seedance-2.0-fast-atlas-t2v",
};

export const isAtlasMode = (mode: string): boolean => mode in ATLAS_MODEL_IDS;

export const atlasModelIdForMode = (mode: string): AtlasSeedanceVariant => {
  const id = ATLAS_MODEL_IDS[mode];
  if (!id) throw new Error(`No Atlas Cloud model ID mapped for mode "${mode}".`);
  return id;
};

export const atlasModelName = (mode: string): string =>
  ATLAS_MODEL_NAMES[mode] || "seedance-atlas-unknown";

/** Atlas Cloud Seedance 2.0 outputs are always videos. */
export const atlasMediaKind = (mode: string): MediaKind => {
  void mode;
  return "video";
};

export type AtlasResolution = "480p" | "720p" | "1080p";
export type AtlasRatio =
  | "adaptive"
  | "21:9"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16";

export interface AtlasStartRequest {
  mode: JobMode;
  prompt: string;
  /** i2v/t2v primary image (first frame) */
  imageUrl?: string;
  /** i2v end-frame (last frame) image */
  endImageUrl?: string;
  /** r2v: up to 9 reference images */
  imageUrls?: string[];
  /** r2v: up to 3 reference videos (≤15s total) */
  videoUrls?: string[];
  /** r2v: up to 3 audio clips (≤15s total) */
  audioUrls?: string[];
  /** Duration 4-15s or -1 for auto */
  duration?: number;
  resolution?: AtlasResolution;
  ratio?: AtlasRatio;
  generateAudio?: boolean;
  watermark?: boolean;
  returnLastFrame?: boolean;
  seed?: number;
}

export interface AtlasRunResponse {
  predictionId: string;
  status: JobStatus;
  raw: Record<string, unknown>;
}

export interface AtlasStatusResponse {
  predictionId: string;
  status: JobStatus;
  progress: number | null;
  mediaUrl: string | null;
  hasNsfw: boolean[] | null;
  error: string | null;
  raw: Record<string, unknown>;
}

export class AtlasError extends Error {
  httpStatus: number;
  atlasBody: Record<string, unknown>;
  isBillingError: boolean;

  constructor(body: Record<string, unknown>, httpStatus: number) {
    const errorField = typeof body.error === "string" ? body.error : "";
    const messageField = typeof body.message === "string" ? body.message : "";
    const detailField = typeof body.detail === "string" ? body.detail : "";
    const detail = errorField || messageField || detailField || JSON.stringify(body);

    super(detail);
    this.name = "AtlasError";
    this.httpStatus = httpStatus;
    this.atlasBody = body;

    const lowerDetail = detail.toLowerCase();
    // Only flag as billing when the signal is specific. Bare words like
    // "exceeded" / "insufficient" / "balance" / 429 match many non-billing
    // errors (duration exceeded, reference count exceeded, rate limited,
    // white balance, etc.), so we require an explicit credit/billing
    // co-occurrence or an HTTP 402.
    const hasBillingPhrase =
      lowerDetail.includes("insufficient credit") ||
      lowerDetail.includes("insufficient balance") ||
      lowerDetail.includes("insufficient funds") ||
      lowerDetail.includes("no credits") ||
      lowerDetail.includes("out of credit") ||
      lowerDetail.includes("credit exceeded") ||
      lowerDetail.includes("credit limit") ||
      lowerDetail.includes("quota exceeded") ||
      lowerDetail.includes("billing") ||
      lowerDetail.includes("payment required") ||
      lowerDetail.includes("subscription");
    this.isBillingError =
      httpStatus === 402 ||
      (httpStatus === 401 && lowerDetail.includes("credit")) ||
      (httpStatus === 403 && lowerDetail.includes("credit")) ||
      hasBillingPhrase;
  }
}

const atlasAuth = () => `Bearer ${envServer.atlasCloudApiKey}`;

const clampDuration = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (value === -1) return -1;
  if (!Number.isFinite(value)) return undefined;
  return Math.min(15, Math.max(4, Math.round(value)));
};

const buildAtlasPayload = (input: AtlasStartRequest): Record<string, unknown> => {
  const model = atlasModelIdForMode(input.mode);
  const payload: Record<string, unknown> = { model, prompt: input.prompt };

  const duration = clampDuration(input.duration);
  if (duration !== undefined) payload.duration = duration;
  if (input.resolution) payload.resolution = input.resolution;
  if (input.ratio) payload.ratio = input.ratio;
  if (typeof input.generateAudio === "boolean") payload.generate_audio = input.generateAudio;
  if (typeof input.watermark === "boolean") payload.watermark = input.watermark;
  if (typeof input.returnLastFrame === "boolean") payload.return_last_frame = input.returnLastFrame;
  if (typeof input.seed === "number") payload.seed = input.seed;

  const isReference = input.mode.endsWith("r2v");
  const isImageToVideo = input.mode.endsWith("i2v");

  if (isReference) {
    // Atlas reference-to-video authoritative field names (per current Seedance 2.0 spec):
    //   reference_images, reference_videos, reference_audios.
    if (input.imageUrls?.length) payload.reference_images = input.imageUrls.slice(0, 9);
    if (input.videoUrls?.length) payload.reference_videos = input.videoUrls.slice(0, 3);
    if (input.audioUrls?.length) payload.reference_audios = input.audioUrls.slice(0, 3);
  } else if (isImageToVideo) {
    if (input.imageUrl) payload.image_url = input.imageUrl;
    if (input.endImageUrl) payload.end_image_url = input.endImageUrl;
  }

  return payload;
};

export const startAtlasJob = async (input: AtlasStartRequest): Promise<AtlasRunResponse> => {
  if (!envServer.atlasCloudApiKey) {
    throw new AtlasError(
      { error: "ATLAS_CLOUD_API_KEY is not configured. Add your Atlas Cloud API key to continue." },
      401,
    );
  }

  const payload = buildAtlasPayload(input);

  console.log(
    `[atlas] submit model=${payload.model} ` +
      `image_url=${payload.image_url ? "set" : "none"} ` +
      `end_image_url=${payload.end_image_url ? "set" : "none"} ` +
      `reference_images=${Array.isArray(payload.reference_images) ? (payload.reference_images as unknown[]).length : 0} ` +
      `reference_videos=${Array.isArray(payload.reference_videos) ? (payload.reference_videos as unknown[]).length : 0} ` +
      `reference_audios=${Array.isArray(payload.reference_audios) ? (payload.reference_audios as unknown[]).length : 0} ` +
      `duration=${payload.duration} resolution=${payload.resolution} ratio=${payload.ratio}`,
  );

  const response = await fetch(`${ATLAS_BASE}/model/generateVideo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: atlasAuth(),
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
    console.error(
      `[atlas] generateVideo failed (HTTP ${response.status}) model=${payload.model} body=${JSON.stringify(body)}`,
    );
    throw new AtlasError(body, response.status);
  }

  const data = (body.data as Record<string, unknown> | undefined) || {};
  const predictionId =
    (typeof body.predictionId === "string" && body.predictionId) ||
    (typeof data.id === "string" && data.id) ||
    (typeof body.id === "string" && body.id) ||
    "";

  if (!predictionId) {
    throw new AtlasError(
      { error: "Atlas Cloud did not return a predictionId.", ...body },
      response.status,
    );
  }

  const rawStatus =
    (typeof data.status === "string" && data.status) ||
    (typeof body.status === "string" && body.status) ||
    "IN_QUEUE";

  return {
    predictionId,
    status: mapAtlasStatus(rawStatus),
    raw: body,
  };
};

const mapAtlasStatus = (status: string): JobStatus => {
  const upper = status?.toUpperCase() || "";
  if (upper === "COMPLETED" || upper === "SUCCEEDED") return "COMPLETED";
  if (upper === "FAILED" || upper === "ERROR") return "FAILED";
  if (upper === "CANCELLED" || upper === "CANCELED") return "CANCELLED";
  if (upper === "IN_QUEUE" || upper === "QUEUED" || upper === "PENDING") return "IN_QUEUE";
  if (upper === "IN_PROGRESS" || upper === "PROCESSING" || upper === "RUNNING") return "IN_PROGRESS";
  return "IN_PROGRESS";
};

export const getAtlasJobStatus = async (
  mode: string,
  predictionId: string,
): Promise<AtlasStatusResponse> => {
  void mode;
  if (!envServer.atlasCloudApiKey) {
    throw new AtlasError({ error: "ATLAS_CLOUD_API_KEY is not configured." }, 401);
  }

  const headers = { Authorization: atlasAuth() };

  // Atlas docs contradict themselves on the polling path. Try the three
  // known variants in order; fall through to the next on 404.
  const pollUrls = [
    `${ATLAS_BASE}/model/getResult?predictionId=${encodeURIComponent(predictionId)}`,
    `${ATLAS_BASE}/model/result/${encodeURIComponent(predictionId)}`,
    `${ATLAS_BASE}/model/prediction/${encodeURIComponent(predictionId)}`,
  ];

  let response: Response | null = null;
  for (const url of pollUrls) {
    response = await fetch(url, { method: "GET", headers, cache: "no-store" });
    if (response.status !== 404) break;
  }
  if (!response) {
    throw new AtlasError({ error: "Atlas Cloud poll returned no response." }, 502);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new AtlasError(body, response.status);
  }

  const payload = (body.data as Record<string, unknown> | undefined) || body;
  const status = mapAtlasStatus(String(payload.status || ""));

  let mediaUrl: string | null = null;
  const outputField = payload.output;
  const outputsField = payload.outputs;
  if (typeof outputField === "string") {
    mediaUrl = outputField;
  } else if (Array.isArray(outputsField) && outputsField.length > 0) {
    const first = outputsField[0];
    if (typeof first === "string") mediaUrl = first;
    else if (first && typeof first === "object" && typeof (first as { url?: unknown }).url === "string") {
      mediaUrl = (first as { url: string }).url;
    }
  } else if (outputField && typeof outputField === "object") {
    const maybeUrl = (outputField as { url?: unknown }).url;
    if (typeof maybeUrl === "string") mediaUrl = maybeUrl;
  }

  const hasNsfwRaw = payload.has_nsfw_contents;
  const hasNsfw = Array.isArray(hasNsfwRaw)
    ? (hasNsfwRaw.filter((v) => typeof v === "boolean") as boolean[])
    : null;

  let progress: number | null = null;
  if (status === "IN_QUEUE") progress = 5;
  else if (status === "IN_PROGRESS") {
    const rawProgress = payload.progress ?? payload.progress_percent;
    if (typeof rawProgress === "number" && Number.isFinite(rawProgress)) {
      progress = Math.min(99, Math.max(1, Math.round(rawProgress)));
    } else {
      progress = 25;
    }
  } else if (status === "COMPLETED") {
    progress = 100;
  }

  const error =
    status === "FAILED"
      ? typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : "Atlas Cloud generation failed."
      : null;

  return {
    predictionId,
    status,
    progress,
    mediaUrl,
    hasNsfw,
    error,
    raw: body,
  };
};

/**
 * Upload a blob/file to Atlas Cloud's media uploader.
 * Not currently used by our pipeline (we pass Supabase signed URLs directly),
 * but retained for future direct-upload flows.
 */
export const uploadAtlasMedia = async (file: Blob, filename = "upload.bin"): Promise<string> => {
  if (!envServer.atlasCloudApiKey) {
    throw new AtlasError({ error: "ATLAS_CLOUD_API_KEY is not configured." }, 401);
  }
  const fd = new FormData();
  fd.append("file", file, filename);
  const response = await fetch(`${ATLAS_BASE}/model/uploadMedia`, {
    method: "POST",
    headers: { Authorization: atlasAuth() },
    body: fd,
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!response.ok) throw new AtlasError(body, response.status);
  const data = (body.data as Record<string, unknown> | undefined) || {};
  const url =
    (typeof body.url === "string" && body.url) ||
    (typeof data.download_url === "string" && data.download_url) ||
    (typeof body.download_url === "string" && body.download_url) ||
    "";
  if (!url) throw new AtlasError({ error: "Atlas upload returned no URL.", ...body }, response.status);
  return url;
};
