/**
 * LTX-2.3 (Lightricks, via fal.ai) — single source of truth for all 10 video
 * endpoints. This descriptor drives BOTH the server-side payload builder
 * (buildLtxPayload, used by fal.ts) AND the Studio UI (StudioCreateView), so the
 * config options, file inputs, ranges, and enums stay in sync.
 *
 * Two families with materially different contracts (verified against fal's
 * OpenAPI schema, which is what fal enforces server-side):
 *   - "duration"  → fal-ai/ltx-2.3/*        : length via `duration` seconds enum,
 *                                             NO num_frames, NO safety param.
 *   - "frames"    → fal-ai/ltx-2.3-quality/*: length via `num_frames` (9–481),
 *                                             has enable_safety_checker (forced off).
 */

export type LtxFamily = "duration" | "frames";

export type LtxControlKind = "enumInt" | "enumStr" | "int" | "float" | "bool" | "text";

export interface LtxControl {
  /** fal payload key (also the form-field suffix). */
  key: string;
  label: string;
  kind: LtxControlKind;
  enumValues?: Array<string | number>;
  min?: number;
  max?: number;
  step?: number;
  default: string | number | boolean;
  hint?: string;
}

export interface LtxFileInput {
  /** fal payload key (image_url, end_image_url, audio_url, video_url). */
  key: string;
  kind: "image" | "video" | "audio";
  label: string;
  /** HTML <input accept> value. */
  accept: string;
  /** Human-readable format hint. */
  formats: string;
  required: boolean;
  hint?: string;
}

export interface LtxModel {
  mode: string; // JobMode
  endpointId: string;
  family: LtxFamily;
  label: string;
  modelName: string; // stored on the job/media row
  pricing: string;
  promptRequired: boolean;
  promptUsed: boolean;
  files: LtxFileInput[];
  controls: LtxControl[];
  /** fal safety-checker param to force OFF (only the -quality family has one). */
  safetyParam?: string;
}

const IMG_ACCEPT = "image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif,image/gif,.png,.jpg,.jpeg,.webp,.avif,.heic,.heif,.gif";
const IMG_FORMATS = "PNG, JPEG, WebP, AVIF, HEIF, or (static) GIF";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v";
const VIDEO_FORMATS = "MP4 (recommended), MOV, WebM";
const AUDIO_ACCEPT = "audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.flac";
const AUDIO_FORMATS = "MP3, WAV, M4A/AAC, OGG, FLAC";

const QUALITY_NEGATIVE_DEFAULT =
  "color distortion, overexposure, static, blurry details, subtitles, style, artwork, painting, frame, still, dim overall tone, worst quality, low quality, JPEG compression artifacts, ugly, mutilated, extra fingers, poorly drawn hands, poorly drawn face, deformed, disfigured, malformed limbs, fused fingers, motionless frame, cluttered background, three legs, crowded background, walking backwards";

// ── Shared control groups ───────────────────────────────────────────

/** duration-family shared controls; `durations` enum differs (quality 10s vs fast 20s). */
const durationControls = (durations: number[], aspectRatios: string[], defaultAspect: string): LtxControl[] => [
  { key: "duration", label: "Duration (seconds)", kind: "enumInt", enumValues: durations, default: durations[0], hint: "fal enforces these exact lengths." },
  { key: "resolution", label: "Resolution", kind: "enumStr", enumValues: ["1080p", "1440p", "2160p"], default: "1080p", hint: "1440p/2160p cost more; >10s requires 1080p." },
  { key: "aspect_ratio", label: "Aspect Ratio", kind: "enumStr", enumValues: aspectRatios, default: defaultAspect },
  { key: "fps", label: "Frames / sec", kind: "enumInt", enumValues: [24, 25, 48, 50], default: 25, hint: "Output frames = duration × fps." },
  { key: "generate_audio", label: "Generate Audio", kind: "bool", default: true, hint: "Native synchronized audio." },
];

/** -quality (frames) family shared controls. num_frames max = 481 (the real schema max, not the 121 default). */
const qualityControls = (resolutionEnum: string[], defaultResolution: string, withImageStrength: boolean): LtxControl[] => [
  { key: "num_frames", label: "Frames", kind: "int", min: 9, max: 481, step: 1, default: 121, hint: "9–481 (≈20s @ 24fps). fal's default is only 121 — full range exposed here." },
  { key: "frames_per_second", label: "Frames / sec", kind: "float", min: 1, max: 60, step: 1, default: 24, hint: "1–60. Clip length = frames ÷ fps." },
  { key: "resolution", label: "Resolution", kind: "enumStr", enumValues: resolutionEnum, default: defaultResolution },
  ...(withImageStrength
    ? ([{ key: "image_strength", label: "Image Strength", kind: "float", min: 0, max: 1, step: 0.05, default: 0.7, hint: "How strongly the first frame conditions the video." }] as LtxControl[])
    : []),
  { key: "num_inference_steps", label: "Inference Steps", kind: "int", min: 8, max: 30, step: 1, default: 15, hint: "More = higher quality, slower." },
  { key: "guidance_scale", label: "Guidance Scale", kind: "float", min: 1, max: 20, step: 0.5, default: 1, hint: "Higher = stronger prompt adherence." },
  { key: "video_quality", label: "Video Quality", kind: "enumStr", enumValues: ["low", "medium", "high", "maximum"], default: "high" },
  { key: "video_write_mode", label: "Write Mode", kind: "enumStr", enumValues: ["fast", "balanced", "small"], default: "balanced" },
  { key: "generate_audio", label: "Generate Audio", kind: "bool", default: true },
  { key: "enable_prompt_expansion", label: "Prompt Expansion", kind: "bool", default: true, hint: "LLM rewrites the prompt." },
  { key: "negative_prompt", label: "Negative Prompt", kind: "text", default: QUALITY_NEGATIVE_DEFAULT, hint: "Leave default unless you need to steer away from specific artifacts." },
  { key: "seed", label: "Seed (optional)", kind: "int", min: 0, max: 2147483647, step: 1, default: "", hint: "Blank = random." },
];

// ── The 10 models ───────────────────────────────────────────────────

export const LTX_MODELS: Record<string, LtxModel> = {
  // ── fal-ai/ltx-2.3/* (duration family, no safety param) ──
  "video:ltx-t2v": {
    mode: "video:ltx-t2v",
    endpointId: "fal-ai/ltx-2.3/text-to-video",
    family: "duration",
    label: "LTX 2.3 Text→Video",
    modelName: "ltx-2.3-t2v",
    pricing: "$0.08/s (1080p)",
    promptRequired: true,
    promptUsed: true,
    files: [],
    controls: durationControls([6, 8, 10], ["16:9", "9:16"], "16:9"),
  },
  "video:ltx-t2v-fast": {
    mode: "video:ltx-t2v-fast",
    endpointId: "fal-ai/ltx-2.3/text-to-video/fast",
    family: "duration",
    label: "LTX 2.3 Fast Text→Video",
    modelName: "ltx-2.3-t2v-fast",
    pricing: "$0.04/s (1080p)",
    promptRequired: true,
    promptUsed: true,
    files: [],
    controls: durationControls([6, 8, 10, 12, 14, 16, 18, 20], ["16:9", "9:16"], "16:9"),
  },
  "video:ltx-i2v": {
    mode: "video:ltx-i2v",
    endpointId: "fal-ai/ltx-2.3/image-to-video",
    family: "duration",
    label: "LTX 2.3 Image→Video",
    modelName: "ltx-2.3-i2v",
    pricing: "$0.06/s (1080p)",
    promptRequired: true,
    promptUsed: true,
    files: [
      { key: "image_url", kind: "image", label: "First Frame Image", accept: IMG_ACCEPT, formats: IMG_FORMATS, required: true },
      { key: "end_image_url", kind: "image", label: "End Frame Image (optional)", accept: IMG_ACCEPT, formats: IMG_FORMATS, required: false, hint: "For first-and-last-frame interpolation." },
    ],
    controls: durationControls([6, 8, 10], ["auto", "16:9", "9:16"], "auto"),
  },
  "video:ltx-i2v-fast": {
    mode: "video:ltx-i2v-fast",
    endpointId: "fal-ai/ltx-2.3/image-to-video/fast",
    family: "duration",
    label: "LTX 2.3 Fast Image→Video",
    modelName: "ltx-2.3-i2v-fast",
    pricing: "$0.04/s (1080p)",
    promptRequired: true,
    promptUsed: true,
    files: [
      { key: "image_url", kind: "image", label: "First Frame Image", accept: IMG_ACCEPT, formats: IMG_FORMATS, required: true },
      { key: "end_image_url", kind: "image", label: "End Frame Image (optional)", accept: IMG_ACCEPT, formats: IMG_FORMATS, required: false, hint: "For first-and-last-frame interpolation." },
    ],
    controls: durationControls([6, 8, 10, 12, 14, 16, 18, 20], ["auto", "16:9", "9:16"], "auto"),
  },
  "video:ltx-a2v": {
    mode: "video:ltx-a2v",
    endpointId: "fal-ai/ltx-2.3/audio-to-video",
    family: "duration",
    label: "LTX 2.3 Audio→Video",
    modelName: "ltx-2.3-a2v",
    pricing: "$0.10/s",
    promptRequired: false,
    promptUsed: true,
    files: [
      { key: "audio_url", kind: "audio", label: "Driving Audio", accept: AUDIO_ACCEPT, formats: AUDIO_FORMATS, required: true, hint: "Output length matches the audio (2–20s)." },
      { key: "image_url", kind: "image", label: "Reference Image (optional)", accept: IMG_ACCEPT, formats: IMG_FORMATS, required: false, hint: "Provide a prompt OR a reference image." },
    ],
    controls: [
      { key: "guidance_scale", label: "Guidance Scale", kind: "float", min: 1, max: 50, step: 0.5, default: 5, hint: "≈5 for text, ≈9 when a reference image is provided." },
      { key: "aspect_ratio", label: "Aspect Ratio", kind: "enumStr", enumValues: ["auto", "16:9", "9:16"], default: "auto" },
    ],
  },
  "video:ltx-extend": {
    mode: "video:ltx-extend",
    endpointId: "fal-ai/ltx-2.3/extend-video",
    family: "duration",
    label: "LTX 2.3 Extend Video",
    modelName: "ltx-2.3-extend",
    pricing: "$0.10/s",
    promptRequired: false,
    promptUsed: true,
    files: [
      { key: "video_url", kind: "video", label: "Source Video", accept: VIDEO_ACCEPT, formats: VIDEO_FORMATS, required: true, hint: "Frames are generated onto this clip." },
    ],
    controls: [
      { key: "mode", label: "Extend From", kind: "enumStr", enumValues: ["end", "start"], default: "end", hint: "Add frames to the end or the start." },
      { key: "duration", label: "Added Duration (seconds)", kind: "float", min: 1, max: 20, step: 1, default: 5 },
      { key: "context", label: "Context (seconds)", kind: "float", min: 1, max: 20, step: 1, default: "", hint: "Optional: how much of the source to condition on." },
    ],
  },
  "video:ltx-retake": {
    mode: "video:ltx-retake",
    endpointId: "fal-ai/ltx-2.3/retake-video",
    family: "duration",
    label: "LTX 2.3 Retake Video",
    modelName: "ltx-2.3-retake",
    pricing: "$0.10/s",
    promptRequired: true,
    promptUsed: true,
    files: [
      { key: "video_url", kind: "video", label: "Source Video", accept: VIDEO_ACCEPT, formats: VIDEO_FORMATS, required: true, hint: "The segment to re-generate." },
    ],
    controls: [
      { key: "retake_mode", label: "Retake Mode", kind: "enumStr", enumValues: ["replace_audio_and_video", "replace_video", "replace_audio"], default: "replace_audio_and_video" },
      { key: "start_time", label: "Start Time (seconds)", kind: "float", min: 0, max: 20, step: 0.5, default: 0 },
      { key: "duration", label: "Duration (seconds)", kind: "float", min: 2, max: 20, step: 1, default: 5 },
    ],
  },

  // ── fal-ai/ltx-2.3-quality/* (frames family, enable_safety_checker forced off) ──
  "video:ltx-q-t2v": {
    mode: "video:ltx-q-t2v",
    endpointId: "fal-ai/ltx-2.3-quality/text-to-video",
    family: "frames",
    label: "LTX 2.3 Quality Text→Video",
    modelName: "ltx-2.3-quality-t2v",
    pricing: "per-second by resolution",
    promptRequired: true,
    promptUsed: true,
    safetyParam: "enable_safety_checker",
    files: [],
    controls: qualityControls(
      ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"],
      "landscape_16_9",
      false,
    ),
  },
  "video:ltx-q-i2v": {
    mode: "video:ltx-q-i2v",
    endpointId: "fal-ai/ltx-2.3-quality/image-to-video",
    family: "frames",
    label: "LTX 2.3 Quality Image→Video",
    modelName: "ltx-2.3-quality-i2v",
    pricing: "per-second by resolution",
    promptRequired: true,
    promptUsed: true,
    safetyParam: "enable_safety_checker",
    files: [
      { key: "image_url", kind: "image", label: "First Frame Image", accept: IMG_ACCEPT, formats: IMG_FORMATS, required: true },
    ],
    controls: qualityControls(
      ["auto", "square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"],
      "auto",
      true,
    ),
  },
  "video:ltx-q-a2v": {
    mode: "video:ltx-q-a2v",
    endpointId: "fal-ai/ltx-2.3-quality/audio-to-video",
    family: "frames",
    label: "LTX 2.3 Quality Audio→Video",
    modelName: "ltx-2.3-quality-a2v",
    pricing: "per-second by resolution",
    promptRequired: true,
    promptUsed: true,
    safetyParam: "enable_safety_checker",
    files: [
      { key: "audio_url", kind: "audio", label: "Driving Audio", accept: AUDIO_ACCEPT, formats: AUDIO_FORMATS, required: true },
      { key: "image_url", kind: "image", label: "Reference Image (optional)", accept: IMG_ACCEPT, formats: IMG_FORMATS, required: false },
    ],
    controls: [
      { key: "match_audio_length", label: "Match Audio Length", kind: "bool", default: true, hint: "When ON, output length follows the audio and Frames is ignored." },
      ...qualityControls(
        ["auto", "square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"],
        "auto",
        true,
      ),
    ],
  },
};

export const isLtxMode = (mode: string): boolean => mode in LTX_MODELS;

export const ltxModelId = (mode: string): string | undefined => LTX_MODELS[mode]?.endpointId;

export const ltxModelName = (mode: string): string => LTX_MODELS[mode]?.modelName || "ltx-2.3-unknown";

const clampNum = (n: number, min?: number, max?: number) => {
  let v = n;
  if (typeof min === "number") v = Math.max(min, v);
  if (typeof max === "number") v = Math.min(max, v);
  return v;
};

/** Coerce + validate a single control value against its descriptor. Returns undefined to omit. */
const coerceControl = (c: LtxControl, raw: unknown): unknown => {
  if (raw === undefined || raw === null || raw === "") {
    if (c.default === "" || c.default === undefined) return undefined; // optional, omit
    raw = c.default;
  }
  switch (c.kind) {
    case "bool":
      return typeof raw === "boolean" ? raw : String(raw) === "true";
    case "int": {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) return undefined;
      return clampNum(n, c.min, c.max);
    }
    case "float": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return undefined;
      return clampNum(n, c.min, c.max);
    }
    case "enumInt": {
      const n = Math.round(Number(raw));
      const allowed = (c.enumValues || []).map(Number);
      return allowed.includes(n) ? n : Number(c.default);
    }
    case "enumStr": {
      const s = String(raw);
      const allowed = (c.enumValues || []).map(String);
      return allowed.includes(s) ? s : String(c.default);
    }
    case "text":
    default:
      return String(raw);
  }
};

export interface LtxBuildInput {
  prompt?: string;
  /** raw control values keyed by control.key (from the form). */
  ltxParams?: Record<string, unknown>;
  /** resolved signed URLs keyed by file.key. */
  ltxFiles?: Record<string, string>;
}

/** Build the exact fal request body for an LTX endpoint from the descriptor + input. */
export const buildLtxPayload = (mode: string, input: LtxBuildInput): Record<string, unknown> => {
  const m = LTX_MODELS[mode];
  if (!m) throw new Error(`Unknown LTX mode: ${mode}`);

  const payload: Record<string, unknown> = {};

  if (m.promptUsed && input.prompt && input.prompt.trim()) {
    payload.prompt = input.prompt.trim();
  }

  for (const f of m.files) {
    const url = input.ltxFiles?.[f.key];
    if (url) payload[f.key] = url;
  }

  const vals = input.ltxParams || {};
  for (const c of m.controls) {
    const v = coerceControl(c, vals[c.key]);
    if (v !== undefined) payload[c.key] = v;
  }

  // Force the safety checker OFF wherever the endpoint exposes one.
  if (m.safetyParam) payload[m.safetyParam] = false;

  return payload;
};
