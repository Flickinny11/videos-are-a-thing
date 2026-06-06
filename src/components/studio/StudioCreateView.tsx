"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EffectsErrorBoundary } from "@/components/app/EffectsErrorBoundary";
import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { PostFxHalo } from "@/components/effects/PostFxHalo";
import { PremiumProgressBar } from "@/components/effects/PremiumProgressBar";
import { RapierFloatField } from "@/components/effects/RapierFloatField";
import { getRealtimeProgressPercent, isActiveJob } from "@/lib/job-progress";
import { LTX_MODELS, type LtxControl } from "@/lib/ltx";
import type { JobResponse } from "@/types/app";

/** First few words of a prompt, for the in-progress request chips. */
const promptPreview = (text: string, words = 6): string => {
  const trimmed = text.trim();
  if (!trimmed) return "(no prompt)";
  const parts = trimmed.split(/\s+/);
  return parts.length <= words ? trimmed : `${parts.slice(0, words).join(" ")}…`;
};

type VideoProvider =
  | "runpod"
  | "fal"
  | "fal-i2v-2.7"
  | "fal-r2v-2.7"
  | "fal-cosmos3-i2v"
  | "ltx-t2v"
  | "ltx-t2v-fast"
  | "ltx-i2v"
  | "ltx-i2v-fast"
  | "ltx-a2v"
  | "ltx-extend"
  | "ltx-retake"
  | "ltx-q-t2v"
  | "ltx-q-i2v"
  | "ltx-q-a2v"
  | "atlas-seedance-i2v"
  | "atlas-seedance-fast-i2v"
  | "atlas-seedance-r2v"
  | "atlas-seedance-fast-r2v"
  | "atlas-seedance-t2v"
  | "atlas-seedance-fast-t2v";

/** map a videoProvider value to its JobMode key for LTX (e.g. "ltx-t2v" → "video:ltx-t2v"). */
const ltxModeForProvider = (provider: string): string => `video:${provider}`;

type AtlasResolution = "480p" | "720p" | "1080p";
type AtlasRatio =
  | "adaptive"
  | "21:9"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16";

/**
 * Cosmos 3 Super output dimensions. fal clamps/snaps to the nearest supported
 * NVIDIA tier and aspect ratio, so a generous set of presets is safe. Covers
 * 256p / 480p / 720p plus HD (incl. 1024×1024). Default is 480p 16:9 (832×480).
 */
const COSMOS_TIERS: { value: string; label: string; width: number; height: number }[] = [
  { value: "256p-16:9", label: "256p · 16:9", width: 448, height: 256 },
  { value: "480p-16:9", label: "480p · 16:9", width: 832, height: 480 },
  { value: "480p-9:16", label: "480p · 9:16", width: 480, height: 832 },
  { value: "480p-1:1", label: "480p · 1:1", width: 640, height: 640 },
  { value: "720p-16:9", label: "720p · 16:9", width: 1280, height: 720 },
  { value: "720p-9:16", label: "720p · 9:16", width: 720, height: 1280 },
  { value: "720p-1:1", label: "720p · 1:1", width: 960, height: 960 },
  { value: "hd-1:1", label: "1024² HD · 1:1", width: 1024, height: 1024 },
  { value: "hd-16:9", label: "1024 HD · 16:9", width: 1024, height: 576 },
  { value: "hd-9:16", label: "1024 HD · 9:16", width: 576, height: 1024 },
  { value: "hd-4:3", label: "1024 HD · 4:3", width: 1024, height: 768 },
];

// ── Wan "Perspective" faders → camera-control prompt language ──
// Wan 2.7 Pro Edit has no native camera params, so each fader position is
// translated into descriptive cinematography text. The composed sentence is
// sent as (or appended to) the prompt — the same fader-driven control the
// dedicated camera-angle models expose, applied to the Wan editor.
interface PerspectiveState {
  orbit: number; // -180..180 (azimuth: left/right around subject)
  tilt: number; // -45..45   (elevation: + up/low-angle, - down/high-angle)
  zoom: number; // -10..10   (+ closer/tighter, - wider)
  roll: number; // -45..45   (dutch angle, + clockwise)
  dolly: number; // -10..10  (+ push in, - pull back)
  panX: number; // -10..10   (reframe left/right)
  pedY: number; // -10..10   (reframe down/up)
  scale: number; // 0.5..2   (subject size)
  focal: number; // 14..200 mm (lens)
}

const PERSPECTIVE_DEFAULT: PerspectiveState = {
  orbit: 0, tilt: 0, zoom: 0, roll: 0, dolly: 0, panX: 0, pedY: 0, scale: 1, focal: 50,
};

const buildPerspectivePrompt = (p: PerspectiveState): string => {
  const clauses: string[] = [];
  if (p.orbit !== 0)
    clauses.push(`orbit the camera ${Math.abs(p.orbit)}° to the ${p.orbit > 0 ? "right" : "left"} around the subject`);
  if (p.tilt !== 0)
    clauses.push(
      p.tilt > 0
        ? `tilt the camera up ${Math.abs(p.tilt)}° for a low-angle shot looking up`
        : `tilt the camera down ${Math.abs(p.tilt)}° for a high-angle shot looking down`,
    );
  if (p.zoom !== 0)
    clauses.push(
      p.zoom > 0
        ? `zoom in ${Math.round(p.zoom * 10)}% tighter toward a close-up`
        : `zoom out ${Math.round(Math.abs(p.zoom) * 10)}% to a wider shot`,
    );
  if (p.dolly !== 0)
    clauses.push(p.dolly > 0 ? "dolly the camera in toward the subject" : "dolly the camera back away from the subject");
  if (p.roll !== 0)
    clauses.push(`roll the camera ${Math.abs(p.roll)}° ${p.roll > 0 ? "clockwise" : "counter-clockwise"} (dutch angle)`);
  if (p.panX !== 0) clauses.push(`reframe the shot toward the ${p.panX > 0 ? "right" : "left"}`);
  if (p.pedY !== 0) clauses.push(`reframe the shot ${p.pedY > 0 ? "upward" : "downward"}`);
  if (p.scale !== 1) clauses.push(`render the subject ${p.scale.toFixed(2)}× its current size in frame`);
  if (p.focal !== 50) {
    const lens = p.focal <= 24 ? "wide-angle" : p.focal >= 85 ? "telephoto" : "standard";
    clauses.push(`shoot on a ${Math.round(p.focal)}mm ${lens} lens`);
  }
  if (clauses.length === 0) return "";
  return `Keep the same subject, lighting, and style; change only the camera: ${clauses.join("; ")}.`;
};

function PerspectiveSlider(props: {
  label: string; min: number; max: number; step: number; value: number;
  onChange: (value: number) => void; unit?: string; hint?: string;
}) {
  const { label, min, max, step, value, onChange, unit = "", hint } = props;
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-violet-200/80">
        {label} — {value}{unit}
      </label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-violet-300"
      />
      {hint ? <p className="mt-1 text-[11px] text-violet-200/55">{hint}</p> : null}
    </div>
  );
}

export function StudioCreateView() {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("video");
  const [videoMode, setVideoMode] = useState<"i2v" | "t2v">("t2v");
  const [videoProvider, setVideoProvider] = useState<VideoProvider>("runpod");
  const [duration, setDuration] = useState<number>(5);
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [imageModel, setImageModel] = useState<string>("flux-schnell");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flash, setFlash] = useState<string>("");
  const [error, setError] = useState("");

  // Wan 2.7 I2V extras
  const [endImageFile, setEndImageFile] = useState<File | null>(null);
  const [videoClipFile, setVideoClipFile] = useState<File | null>(null);
  const [enablePromptExpansion, setEnablePromptExpansion] = useState(true);

  // Wan 2.7 R2V extras
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [referenceVideos, setReferenceVideos] = useState<File[]>([]);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1" | "4:3" | "3:4">("16:9");
  const [multiShots, setMultiShots] = useState(false);

  // Optional seed (both 2.7 video models + Cosmos)
  const [seed, setSeed] = useState<string>("");

  // ── Cosmos 3 Super I2V (NVIDIA, via fal.ai) ──
  const [cosmosNumFrames, setCosmosNumFrames] = useState<number>(189);
  const [cosmosFps, setCosmosFps] = useState<number>(24);
  const [cosmosSteps, setCosmosSteps] = useState<number>(28);
  const [cosmosGuidance, setCosmosGuidance] = useState<number>(6);
  const [cosmosTier, setCosmosTier] = useState<string>("480p-16:9"); // maps to width/height
  const [cosmosAgentic, setCosmosAgentic] = useState(false);
  const [cosmosAgenticIterations, setCosmosAgenticIterations] = useState<number>(2);
  const [cosmosAgenticSamples, setCosmosAgenticSamples] = useState<number>(2);
  const [cosmosAgenticEarlyStop, setCosmosAgenticEarlyStop] = useState(true);

  // ── LTX-2.3 (descriptor-driven) ──
  const [ltxValues, setLtxValues] = useState<Record<string, string | boolean>>({});
  const [ltxFiles, setLtxFiles] = useState<Record<string, File | null>>({});

  // ── In-progress request tracker (so the user can stay on Studio and fire
  //    multiple generations back-to-back while watching their status). ──
  const [trackedJobs, setTrackedJobs] = useState<JobResponse[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // fal.ai image model extras
  const [editImages, setEditImages] = useState<File[]>([]);
  const [imageSize, setImageSize] = useState<string>("square_hd");
  const [numImages, setNumImages] = useState(1);
  const [maxImages, setMaxImages] = useState(1);

  // Camera-angle models (Qwen 2511 / FLUX 2 Multiple Angles)
  const [angleHorizontal, setAngleHorizontal] = useState(0);
  const [angleVertical, setAngleVertical] = useState(0);
  const [angleZoom, setAngleZoom] = useState(5);
  const [angleLoraScale, setAngleLoraScale] = useState(1);
  const [angleGuidance, setAngleGuidance] = useState(4.5);
  const [angleSteps, setAngleSteps] = useState(28);
  const [angleAcceleration, setAngleAcceleration] = useState<"none" | "regular">("regular");
  const [angleOutputFormat, setAngleOutputFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [angleNumImages, setAngleNumImages] = useState(1);
  const [angleImageSize, setAngleImageSize] = useState<string>(""); // "" = match input image
  const [angleCustomW, setAngleCustomW] = useState(1024);
  const [angleCustomH, setAngleCustomH] = useState(1024);

  // Wan 2.7 Pro/Edit "Perspective" faders → camera-control prompt text
  const [perspectiveOpen, setPerspectiveOpen] = useState(false);
  const [persp, setPersp] = useState<PerspectiveState>({ ...PERSPECTIVE_DEFAULT });
  const setPerspField = (key: keyof PerspectiveState, value: number) =>
    setPersp((prev) => ({ ...prev, [key]: value }));

  // Atlas Cloud Seedance extras
  const [atlasResolution, setAtlasResolution] = useState<AtlasResolution>("720p");
  const [atlasRatio, setAtlasRatio] = useState<AtlasRatio>("adaptive");
  const [atlasDuration, setAtlasDuration] = useState<number>(5);
  const [atlasGenerateAudio, setAtlasGenerateAudio] = useState(true);
  const [atlasWatermark, setAtlasWatermark] = useState(false);
  const [atlasReturnLastFrame, setAtlasReturnLastFrame] = useState(false);
  const [atlasRefImages, setAtlasRefImages] = useState<File[]>([]);
  const [atlasRefVideos, setAtlasRefVideos] = useState<File[]>([]);
  const [atlasRefAudios, setAtlasRefAudios] = useState<File[]>([]);

  const isAngleModel = imageModel === "qwen-angles" || imageModel === "flux2-angles";
  const isWanEditModel = imageModel === "fal-edit-2.7" || imageModel === "fal-pro-edit-2.7";
  const perspectiveText = buildPerspectivePrompt(persp);

  const isCosmosProvider = videoProvider === "fal-cosmos3-i2v";
  const isLtxProvider = videoProvider.startsWith("ltx-");
  const ltxModel = isLtxProvider ? LTX_MODELS[ltxModeForProvider(videoProvider)] : undefined;

  // Initialize LTX control values to the selected model's defaults; reset files.
  useEffect(() => {
    if (!ltxModel) return;
    const defaults: Record<string, string | boolean> = {};
    for (const c of ltxModel.controls) {
      defaults[c.key] = typeof c.default === "boolean" ? c.default : String(c.default);
    }
    setLtxValues(defaults);
    setLtxFiles({});
  }, [ltxModel]);
  const isFalProvider =
    videoProvider === "fal" ||
    videoProvider === "fal-i2v-2.7" ||
    videoProvider === "fal-r2v-2.7" ||
    isCosmosProvider;

  const isAtlasProvider =
    videoProvider === "atlas-seedance-i2v" ||
    videoProvider === "atlas-seedance-fast-i2v" ||
    videoProvider === "atlas-seedance-r2v" ||
    videoProvider === "atlas-seedance-fast-r2v" ||
    videoProvider === "atlas-seedance-t2v" ||
    videoProvider === "atlas-seedance-fast-t2v";

  const isAtlasI2V =
    videoProvider === "atlas-seedance-i2v" || videoProvider === "atlas-seedance-fast-i2v";
  const isAtlasR2V =
    videoProvider === "atlas-seedance-r2v" || videoProvider === "atlas-seedance-fast-r2v";
  const isAtlasT2V =
    videoProvider === "atlas-seedance-t2v" || videoProvider === "atlas-seedance-fast-t2v";
  const isAtlasFast =
    videoProvider === "atlas-seedance-fast-i2v" ||
    videoProvider === "atlas-seedance-fast-r2v" ||
    videoProvider === "atlas-seedance-fast-t2v";

  const fileRequired = useMemo(
    () => {
      if (mediaType === "video") {
        if (videoProvider.startsWith("ltx-")) return false; // LTX uses its own ltxfile_* inputs
        if (videoProvider === "fal-r2v-2.7") return false; // uses referenceImages instead
        if (videoProvider === "fal-i2v-2.7") return false; // image is optional for 2.7 I2V
        if (videoProvider === "fal-cosmos3-i2v") return true; // conditioning first frame required
        if (videoProvider === "fal") return true;
        if (isAtlasI2V) return true; // Atlas i2v requires start image
        if (isAtlasR2V) return false; // uses atlasRefImages / atlasRefVideos
        if (isAtlasT2V) return false; // text only
        return videoMode === "i2v";
      }
      // T2I models need no file; fal edit models use editImages (multi-upload), not sourceFile
      const noSourceFileModels = [
        "flux-dev", "flux-schnell", "qwen-t2i",
        "fal-t2i-2.7", "fal-pro-t2i-2.7",
        "fal-edit-2.7", "fal-pro-edit-2.7",
        "fal-seedream-edit-4.5",
        "qwen-angles", "flux2-angles",
      ];
      if (noSourceFileModels.includes(imageModel)) return false;
      return true;
    },
    [mediaType, videoMode, videoProvider, imageModel, isAtlasI2V, isAtlasR2V, isAtlasT2V],
  );

  const durationOptions = useMemo(() => {
    if (videoProvider === "fal-r2v-2.7") return [2, 3, 4, 5, 6, 7, 8, 9, 10];
    if (videoProvider === "fal-i2v-2.7") return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    if (isAtlasProvider) return [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    return [5, 10, 15];
  }, [videoProvider, isAtlasProvider]);

  // ── In-progress request tracker + polling ──────────────────────────
  const mountedRef = useRef(true);
  const pollingRef = useRef(false);
  const trackedRef = useRef<JobResponse[]>([]);
  trackedRef.current = trackedJobs;

  const upsertJobs = useCallback((incoming: JobResponse[]) => {
    if (!incoming.length) return;
    setTrackedJobs((current) => {
      const byId = new Map(current.map((j) => [j.id, j]));
      for (const job of incoming) byId.set(job.id, job);
      return Array.from(byId.values()).sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
      );
    });
  }, []);

  // Poll active tracked jobs. This is also what drives completion + the
  // download/persist-to-library step server-side, so generated videos land in
  // the Library even when the user never leaves the Studio page.
  const pollActiveJobs = useCallback(async () => {
    if (pollingRef.current || !mountedRef.current) return;
    pollingRef.current = true;
    try {
      const active = trackedRef.current.filter((j) => isActiveJob(j.status));
      if (!active.length) return;
      const settled = await Promise.allSettled(
        active.map(async (job) => {
          const res = await fetch(`/api/jobs/${job.id}/poll`, { method: "POST", cache: "no-store" });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.success) return null;
          return data.job as JobResponse;
        }),
      );
      if (!mountedRef.current) return;
      const updates = settled
        .filter((r): r is PromiseFulfilledResult<JobResponse | null> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((v): v is JobResponse => v !== null);
      upsertJobs(updates);
    } finally {
      pollingRef.current = false;
    }
  }, [upsertJobs]);

  // Seed the tracker with jobs already in flight (e.g. fired right before a reload).
  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/jobs", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!mountedRef.current || !res.ok || !data?.success) return;
        const jobs = (data.jobs as JobResponse[]) || [];
        // /api/jobs is newest-first. Only surface the few most recent in-flight
        // requests — not every historical job still stuck IN_QUEUE — so the
        // tracker stays a compact status strip instead of flooding the page.
        upsertJobs(jobs.filter((j) => isActiveJob(j.status)).slice(0, 5));
      } catch {
        /* non-fatal: tracker simply starts empty */
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, [upsertJobs]);

  const hasActiveTracked = useMemo(() => trackedJobs.some((j) => isActiveJob(j.status)), [trackedJobs]);
  const anyInProgress = useMemo(
    () => trackedJobs.some((j) => j.status === "IN_PROGRESS"),
    [trackedJobs],
  );

  useEffect(() => {
    if (!hasActiveTracked) return;
    const interval = anyInProgress ? 3000 : 6000;
    const timer = setInterval(() => {
      void pollActiveJobs();
    }, interval);
    return () => clearInterval(timer);
  }, [hasActiveTracked, anyInProgress, pollActiveJobs]);

  const visibleJobs = useMemo(
    () => trackedJobs.filter((j) => !dismissed.includes(j.id)),
    [trackedJobs, dismissed],
  );

  const dismissJob = useCallback((id: string) => {
    setDismissed((cur) => (cur.includes(id) ? cur : [...cur, id]));
  }, []);

  const submit = async () => {
    setError("");
    setFlash("");

    if (isLtxProvider && ltxModel) {
      if (ltxModel.promptRequired && !prompt.trim()) {
        setError(`A prompt is required for ${ltxModel.label}.`);
        return;
      }
      const missing = ltxModel.files.find((f) => f.required && !ltxFiles[f.key]);
      if (missing) {
        setError(`${missing.label} is required for ${ltxModel.label}.`);
        return;
      }
    } else {
      // Prompt is optional for the camera-angle models (they build their own
      // prompt from the sliders) and for the Wan editor when the Perspective
      // faders are providing the instruction.
      const promptOptionalNow =
        isAngleModel || (isWanEditModel && perspectiveOpen && perspectiveText.length > 0);
      if (!promptOptionalNow && !prompt.trim()) {
        setError("Prompt is required (or use the Perspective / angle controls).");
        return;
      }
      if (isAngleModel && editImages.length === 0) {
        setError("Please upload an input image for camera-angle control.");
        return;
      }
      if (fileRequired && !sourceFile) {
        setError("Please upload an input image.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // When the Wan editor's Perspective faders are in use, fold the generated
      // camera-control sentence into the prompt (it can stand alone).
      const finalPrompt =
        isWanEditModel && perspectiveOpen && perspectiveText
          ? [perspectiveText, prompt.trim()].filter(Boolean).join(" ")
          : prompt.trim();

      const body = new FormData();
      body.set("prompt", finalPrompt);
      if (negativePrompt.trim()) body.set("negativePrompt", negativePrompt.trim());
      body.set("mediaType", mediaType);
      body.set("videoMode", videoProvider === "fal" ? "i2v" : videoMode);
      body.set("videoProvider", videoProvider);
      const effectiveDuration = isAtlasProvider ? atlasDuration : duration;
      body.set("duration", String(effectiveDuration));
      body.set("resolution", resolution);
      body.set("imageModel", imageModel);
      if (sourceFile) body.set("sourceFile", sourceFile);
      if (audioFile) body.set("audioFile", audioFile);

      // Wan 2.6 I2V extras (fal.ai)
      if (videoProvider === "fal") {
        body.set("enablePromptExpansion", String(enablePromptExpansion));
        body.set("multiShots", String(multiShots));
      }

      // Wan 2.7 I2V extras
      if (videoProvider === "fal-i2v-2.7") {
        if (endImageFile) body.set("endImageFile", endImageFile);
        if (videoClipFile) body.set("videoClipFile", videoClipFile);
        body.set("enablePromptExpansion", String(enablePromptExpansion));
      }

      // Wan 2.7 R2V extras
      if (videoProvider === "fal-r2v-2.7") {
        body.set("aspectRatio", aspectRatio);
        body.set("multiShots", String(multiShots));
        referenceImages.forEach((file, i) => body.append(`referenceImage_${i}`, file));
        referenceVideos.forEach((file, i) => body.append(`referenceVideo_${i}`, file));
      }

      // Optional seed for all fal.ai Wan video models
      if ((videoProvider === "fal" || videoProvider === "fal-i2v-2.7" || videoProvider === "fal-r2v-2.7") && seed.trim()) {
        body.set("seed", seed.trim());
      }

      // Cosmos 3 Super I2V extras (NVIDIA via fal.ai)
      if (videoProvider === "fal-cosmos3-i2v") {
        const tier = COSMOS_TIERS.find((t) => t.value === cosmosTier) ?? COSMOS_TIERS[1];
        body.set("numFrames", String(cosmosNumFrames));
        body.set("framesPerSecond", String(cosmosFps));
        body.set("numInferenceSteps", String(cosmosSteps));
        body.set("guidanceScale", String(cosmosGuidance));
        body.set("cosmosWidth", String(tier.width));
        body.set("cosmosHeight", String(tier.height));
        body.set("enablePromptExpansion", String(enablePromptExpansion));
        body.set("enableAgenticGeneration", String(cosmosAgentic));
        body.set("agenticMaxIterations", String(cosmosAgenticIterations));
        body.set("agenticSamplesPerIteration", String(cosmosAgenticSamples));
        body.set("agenticEarlyStop", String(cosmosAgenticEarlyStop));
        if (seed.trim()) body.set("seed", seed.trim());
      }

      // LTX 2.3 (descriptor-driven): emit ltx_<control> values + ltxfile_<file> uploads
      if (isLtxProvider && ltxModel) {
        for (const c of ltxModel.controls) {
          const v = ltxValues[c.key];
          if (v !== undefined && v !== "") body.set(`ltx_${c.key}`, String(v));
        }
        for (const f of ltxModel.files) {
          const file = ltxFiles[f.key];
          if (file) body.append(`ltxfile_${f.key}`, file);
        }
      }

      // Atlas Cloud Seedance extras
      if (isAtlasProvider) {
        body.set("atlasResolution", atlasResolution);
        body.set("atlasRatio", atlasRatio);
        body.set("atlasDuration", String(atlasDuration));
        body.set("atlasGenerateAudio", String(atlasGenerateAudio));
        body.set("atlasWatermark", String(atlasWatermark));
        body.set("atlasReturnLastFrame", String(atlasReturnLastFrame));
        if (seed.trim()) body.set("seed", seed.trim());

        if (isAtlasI2V && endImageFile) {
          body.set("endImageFile", endImageFile);
        }

        if (isAtlasR2V) {
          atlasRefImages.forEach((file, i) => body.append(`atlasRefImage_${i}`, file));
          atlasRefVideos.forEach((file, i) => body.append(`atlasRefVideo_${i}`, file));
          atlasRefAudios.forEach((file, i) => body.append(`atlasRefAudio_${i}`, file));
        }
      }

      // fal.ai image model extras
      const isFalImageModel = ["fal-edit-2.7", "fal-pro-edit-2.7", "fal-t2i-2.7", "fal-pro-t2i-2.7", "fal-seedream-edit-4.5"].includes(imageModel);
      if (mediaType === "image" && isFalImageModel) {
        body.set("imageSize", imageSize);
        body.set("numImages", String(numImages));
        if (imageModel === "fal-edit-2.7" || imageModel === "fal-pro-edit-2.7") {
          body.set("enablePromptExpansion", String(enablePromptExpansion));
          editImages.forEach((file, i) => body.append(`editImage_${i}`, file));
        }
        if (imageModel === "fal-seedream-edit-4.5") {
          body.set("maxImages", String(maxImages));
          editImages.forEach((file, i) => body.append(`editImage_${i}`, file));
        }
      }

      // Camera-angle models (Qwen 2511 / FLUX 2 Multiple Angles)
      if (mediaType === "image" && isAngleModel) {
        editImages.forEach((file, i) => body.append(`editImage_${i}`, file));
        body.set("angleHorizontal", String(angleHorizontal));
        body.set("angleVertical", String(angleVertical));
        body.set("angleZoom", String(angleZoom));
        body.set("angleLoraScale", String(angleLoraScale));
        body.set("angleGuidanceScale", String(angleGuidance));
        body.set("angleNumInferenceSteps", String(angleSteps));
        body.set("angleNumImages", String(angleNumImages));
        body.set("angleAcceleration", angleAcceleration);
        body.set("angleOutputFormat", angleOutputFormat);
        body.set("angleImageSize", angleImageSize);
        if (angleImageSize === "custom") {
          body.set("angleCustomWidth", String(angleCustomW));
          body.set("angleCustomHeight", String(angleCustomH));
        }
        if (seed.trim()) body.set("seed", seed.trim());
      }

      const response = await fetch("/api/jobs", {
        method: "POST",
        body,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Job submission failed.");
      }

      setFlash("success");
      // Add the freshly-submitted job to the in-progress tracker so it shows up
      // at the top of the page and starts polling — without leaving Studio.
      if (data.job) upsertJobs([data.job as JobResponse]);
      // Intentionally keep the prompt, uploaded files, and every control exactly
      // as they are after a successful submit. The page never navigates or
      // reloads, so the form stays populated and the user can simply click
      // Generate again to re-run the same prompt (or tweak one control and
      // resubmit) without having to re-enter anything.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected submit error.");
      setFlash("failure");
    } finally {
      setIsSubmitting(false);
    }
  };

  const providerOptions: { value: VideoProvider; label: string }[] = [
    { value: "runpod", label: "RunPod" },
    { value: "fal", label: "Wan 2.6 fal.ai (I2V)" },
    { value: "fal-i2v-2.7", label: "Wan 2.7 I2V (fal.ai)" },
    { value: "fal-r2v-2.7", label: "Wan 2.7 R2V (fal.ai)" },
    { value: "fal-cosmos3-i2v", label: "Cosmos 3 Super I2V (NVIDIA · fal.ai)" },
    { value: "ltx-t2v", label: "LTX 2.3 Text→Video" },
    { value: "ltx-t2v-fast", label: "LTX 2.3 Fast Text→Video" },
    { value: "ltx-i2v", label: "LTX 2.3 Image→Video" },
    { value: "ltx-i2v-fast", label: "LTX 2.3 Fast Image→Video" },
    { value: "ltx-a2v", label: "LTX 2.3 Audio→Video" },
    { value: "ltx-extend", label: "LTX 2.3 Extend Video" },
    { value: "ltx-retake", label: "LTX 2.3 Retake Video" },
    { value: "ltx-q-t2v", label: "LTX 2.3 Quality Text→Video" },
    { value: "ltx-q-i2v", label: "LTX 2.3 Quality Image→Video" },
    { value: "ltx-q-a2v", label: "LTX 2.3 Quality Audio→Video" },
    { value: "atlas-seedance-i2v", label: "Seedance 2.0 I2V (Atlas Cloud)" },
    { value: "atlas-seedance-fast-i2v", label: "Seedance 2.0 Fast I2V (Atlas Cloud)" },
    { value: "atlas-seedance-r2v", label: "Seedance 2.0 R2V (Atlas Cloud)" },
    { value: "atlas-seedance-fast-r2v", label: "Seedance 2.0 Fast R2V (Atlas Cloud)" },
    { value: "atlas-seedance-t2v", label: "Seedance 2.0 T2V (Atlas Cloud)" },
    { value: "atlas-seedance-fast-t2v", label: "Seedance 2.0 Fast T2V (Atlas Cloud)" },
  ];

  // Button style helper
  const pill = (active: boolean, color: "cyan" | "violet" | "white" | "amber" = "cyan") => {
    const activeStyles: Record<string, string> = {
      cyan: "border-cyan-100/80 bg-cyan-200/80 text-slate-900 shadow-[0_0_12px_rgba(34,211,238,0.3)]",
      violet: "border-violet-100/80 bg-violet-200/80 text-slate-900 shadow-[0_0_12px_rgba(167,139,250,0.3)]",
      white: "border-cyan-100/80 bg-white/85 text-slate-900 shadow-[0_0_12px_rgba(255,255,255,0.2)]",
      amber: "border-amber-100/80 bg-amber-200/80 text-slate-900 shadow-[0_0_12px_rgba(251,191,36,0.3)]",
    };
    const inactiveStyles: Record<string, string> = {
      cyan: "border-cyan-300/30 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/20 hover:shadow-[0_0_8px_rgba(34,211,238,0.12)]",
      violet: "border-violet-300/30 bg-violet-400/10 text-violet-100 hover:bg-violet-400/20 hover:shadow-[0_0_8px_rgba(167,139,250,0.12)]",
      white: "border-cyan-100/30 bg-white/5 text-cyan-100 hover:bg-white/10 hover:shadow-[0_0_8px_rgba(255,255,255,0.08)]",
      amber: "border-amber-300/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20 hover:shadow-[0_0_8px_rgba(251,191,36,0.12)]",
    };
    return `rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
      active ? activeStyles[color] : inactiveStyles[color]
    }`;
  };

  // Render a single descriptor-driven LTX control.
  const setLtxVal = (k: string, v: string | boolean) => setLtxValues((prev) => ({ ...prev, [k]: v }));
  const renderLtxControl = (c: LtxControl) => {
    const val = ltxValues[c.key];
    if (c.kind === "bool") {
      const on = val === true || val === "true";
      return (
        <div key={c.key} className="flex flex-wrap items-center gap-3">
          <button type="button" className={pill(on, "amber")} onClick={() => setLtxVal(c.key, !on)}>
            {c.label}: {on ? "ON" : "OFF"}
          </button>
          {c.hint ? <span className="text-xs text-fuchsia-200/60">{c.hint}</span> : null}
        </div>
      );
    }
    if (c.kind === "enumInt" || c.kind === "enumStr") {
      return (
        <div key={c.key}>
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">{c.label}</label>
          <div className="flex flex-wrap gap-2">
            {(c.enumValues || []).map((ev) => {
              const s = String(ev);
              return (
                <button key={s} type="button" className={pill(String(val) === s)} onClick={() => setLtxVal(c.key, s)}>
                  {s}
                </button>
              );
            })}
          </div>
          {c.hint ? <p className="mt-1 text-xs text-fuchsia-200/60">{c.hint}</p> : null}
        </div>
      );
    }
    if (c.kind === "text") {
      return (
        <div key={c.key}>
          <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">{c.label}</label>
          <textarea
            className="h-20 w-full resize-y rounded-2xl border border-fuchsia-200/25 bg-slate-900/70 p-3 text-sm"
            value={String(val ?? "")}
            onChange={(e) => setLtxVal(c.key, e.target.value)}
          />
          {c.hint ? <p className="mt-1 text-xs text-fuchsia-200/60">{c.hint}</p> : null}
        </div>
      );
    }
    // int / float
    const optional = c.default === "";
    if (optional) {
      return (
        <div key={c.key}>
          <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">{c.label}</label>
          <input
            type="number"
            min={c.min}
            max={c.max}
            step={c.step}
            placeholder="(optional)"
            value={String(val ?? "")}
            onChange={(e) => setLtxVal(c.key, e.target.value)}
            className="block w-full rounded-2xl border border-fuchsia-200/25 bg-slate-900/70 p-3 text-sm"
          />
          {c.hint ? <p className="mt-1 text-xs text-fuchsia-200/60">{c.hint}</p> : null}
        </div>
      );
    }
    const num = Number(val ?? c.default);
    return (
      <div key={c.key}>
        <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">
          {c.label}: {String(val ?? c.default)}
        </label>
        <input
          type="range"
          min={c.min}
          max={c.max}
          step={c.step}
          value={Number.isFinite(num) ? num : Number(c.default)}
          onChange={(e) => setLtxVal(c.key, e.target.value)}
          className="w-full accent-fuchsia-300"
        />
        {c.hint ? <p className="mt-1 text-xs text-fuchsia-200/60">{c.hint}</p> : null}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* In-progress request tracker — stays on Studio so you can fire multiple
          generations back-to-back and watch each one to completion. */}
      {visibleJobs.length > 0 ? (
        <section className="rounded-[2rem] border border-cyan-100/20 bg-slate-950/55 p-4 backdrop-blur-2xl md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-100/90">Active Requests</h3>
            <span className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/60">
              {visibleJobs.filter((j) => isActiveJob(j.status)).length} in progress
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {visibleJobs.map((job) => {
              const done = job.status === "COMPLETED";
              const failed = job.status === "FAILED" || job.status === "TIMED_OUT" || job.status === "CANCELLED";
              const pct = getRealtimeProgressPercent(job);
              return (
                <div key={job.id} className="rounded-2xl border border-cyan-100/15 bg-white/[0.04] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-100">{promptPreview(job.prompt)}</p>
                    <button
                      type="button"
                      onClick={() => dismissJob(job.id)}
                      aria-label="Dismiss request"
                      className="-mr-1 -mt-1 rounded-lg px-2 py-0.5 text-base leading-none text-cyan-100/50 transition hover:bg-white/10 hover:text-cyan-50"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] uppercase tracking-[0.14em]">
                    <span className="text-cyan-100/55">{job.model}</span>
                    <span className={done ? "text-emerald-300" : failed ? "text-rose-300" : "text-cyan-200"}>
                      {done ? "Complete ✓" : failed ? "Failed" : `${pct}%`}
                    </span>
                  </div>
                  <PremiumProgressBar
                    progress={done || failed ? 100 : pct}
                    status={done ? "completed" : failed ? "failed" : "active"}
                    className="mt-2 h-2"
                  />
                  {failed && job.errorReason ? (
                    <p className="mt-1 line-clamp-1 text-[11px] text-rose-300/80">{job.errorReason}</p>
                  ) : null}
                  {done ? <p className="mt-1 text-[11px] text-emerald-300/70">Saved to your Library.</p> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
      <article className="relative isolate overflow-hidden rounded-[2.2rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        <EffectsErrorBoundary>
          <OglLiquidRibbon className="pointer-events-none absolute inset-0 opacity-60" />
        </EffectsErrorBoundary>
        <EffectsErrorBoundary>
          <RapierFloatField className="pointer-events-none absolute inset-0 opacity-40" count={8} />
        </EffectsErrorBoundary>
        <div className="relative z-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-100/35 bg-cyan-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100">
            <span className="h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_16px_rgba(103,232,249,1)]" />
            Generative Command Deck
          </div>
          <h2 className="text-2xl font-semibold leading-tight md:text-4xl">
            Build image and video jobs with a fully instrumented RunPod pipeline.
          </h2>

          <label className="mt-6 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Prompt</label>
          <textarea
            className="mt-2 h-44 w-full resize-y rounded-3xl border border-cyan-200/25 bg-slate-900/70 p-4 text-sm outline-none ring-cyan-300/30 transition focus:ring"
            placeholder="Describe scene, camera movement, lens behavior, mood, texture, and composition..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />

          <label className="mt-4 block text-xs uppercase tracking-[0.2em] text-rose-200/80">Negative Prompt</label>
          <textarea
            className="mt-2 h-20 w-full resize-y rounded-3xl border border-rose-300/20 bg-slate-900/70 p-4 text-sm outline-none ring-rose-300/30 transition focus:ring"
            placeholder="Elements to avoid: blur, distortion, watermark, low quality..."
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {(["video", "image"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMediaType(value)}
                className={pill(mediaType === value)}
              >
                {value}
              </button>
            ))}
          </div>

          {mediaType === "video" ? (
            <div className="mt-5 space-y-4">
              {/* Provider selector */}
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Provider</label>
                <div className="flex flex-wrap gap-2">
                  {providerOptions.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={pill(videoProvider === value, "violet")}
                      onClick={() => {
                        setVideoProvider(value);
                        // Reset duration to valid default when switching providers
                        if (value === "fal-r2v-2.7" && duration > 10) setDuration(5);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Video mode selector - only show for RunPod */}
              {videoProvider === "runpod" ? (
                <div className="flex flex-wrap gap-2">
                  {(["t2v", "i2v"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={pill(videoMode === value, "white")}
                      onClick={() => setVideoMode(value)}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Duration selector — Cosmos uses num_frames/fps; Atlas/LTX have their own. */}
              {!isAtlasProvider && !isCosmosProvider && !isLtxProvider ? (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Duration</label>
                  <div className="flex flex-wrap gap-2">
                    {durationOptions.map((seconds) => (
                      <button
                        key={seconds}
                        type="button"
                        className={pill(duration === seconds)}
                        onClick={() => setDuration(seconds)}
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Resolution selector — non-Atlas (720p/1080p). Cosmos/LTX use their own. */}
              {!isAtlasProvider && !isCosmosProvider && !isLtxProvider ? (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Resolution</label>
                  <div className="flex flex-wrap gap-2">
                    {(["720p", "1080p"] as const).map((res) => (
                      <button
                        key={res}
                        type="button"
                        className={pill(resolution === res)}
                        onClick={() => setResolution(res)}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Aspect Ratio - R2V only */}
              {videoProvider === "fal-r2v-2.7" ? (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Aspect Ratio</label>
                  <div className="flex flex-wrap gap-2">
                    {(["16:9", "9:16", "1:1", "4:3", "3:4"] as const).map((ar) => (
                      <button
                        key={ar}
                        type="button"
                        className={pill(aspectRatio === ar)}
                        onClick={() => setAspectRatio(ar)}
                      >
                        {ar}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Multi-shots toggle - R2V 2.7 and I2V 2.6 */}
              {(videoProvider === "fal-r2v-2.7" || videoProvider === "fal") ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className={pill(multiShots, "amber")}
                    onClick={() => setMultiShots(!multiShots)}
                  >
                    Multi-shots: {multiShots ? "ON" : "OFF"}
                  </button>
                  <span className="text-xs text-cyan-100/60">
                    {videoProvider === "fal"
                      ? "Multi-shot segmentation (requires Prompt Expansion ON)"
                      : "Enable intelligent multi-shot segmentation"}
                  </span>
                </div>
              ) : null}

              {/* Prompt expansion toggle - I2V 2.7, I2V 2.6, and Wan 2.7 Edit models use separate state */}
              {(videoProvider === "fal-i2v-2.7" || videoProvider === "fal") ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className={pill(enablePromptExpansion, "amber")}
                    onClick={() => setEnablePromptExpansion(!enablePromptExpansion)}
                  >
                    Prompt Expansion: {enablePromptExpansion ? "ON" : "OFF"}
                  </button>
                  <span className="text-xs text-cyan-100/60">Intelligent prompt rewriting (LLM)</span>
                </div>
              ) : null}

              {/* fal.ai pricing hint (Wan models; Cosmos shows its own below) */}
              {isFalProvider && !isCosmosProvider ? (
                <p className="text-xs text-violet-300/70">
                  fal.ai &middot; $0.10/sec &middot; {duration}s = ${(duration * 0.10).toFixed(2)} &middot; Safety filter disabled
                </p>
              ) : null}

              {/* Image upload for I2V modes — 1 start frame (JPEG/PNG/BMP/WEBP, max 20 MB) */}
              {videoProvider === "fal" ||
                videoProvider === "fal-i2v-2.7" ||
                isCosmosProvider ||
                isAtlasI2V ||
                (videoProvider === "runpod" && videoMode === "i2v") ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                    {isCosmosProvider ? "Conditioning First Frame (1 image, required)" : `Start Frame Image ${videoProvider === "fal-i2v-2.7" ? "(optional, 1 image)" : "(1 image)"}`}
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp"
                    className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                    onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
                  />
                  {videoProvider === "fal-i2v-2.7" ? (
                    <p className="mt-1 text-xs text-cyan-200/50">JPEG, PNG, BMP, or WEBP — max 20 MB. Mutually exclusive with the video clip below.</p>
                  ) : null}
                  {isCosmosProvider ? (
                    <p className="mt-1 text-xs text-cyan-200/50">
                      Cosmos 3 generates motion starting from this exact frame. JPEG, PNG, WEBP, or BMP — max 20 MB. The Reasoner (prompt expansion) also looks at this image.
                    </p>
                  ) : null}
                  {isAtlasI2V ? (
                    <p className="mt-1 text-xs text-cyan-200/50">
                      Seedance 2.0 first frame. JPEG, PNG, BMP, or WEBP.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* End image upload - I2V 2.7 only — 1 end frame */}
              {videoProvider === "fal-i2v-2.7" ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">End Frame Image (optional, 1 image)</label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp"
                    className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                    onChange={(event) => setEndImageFile(event.target.files?.[0] || null)}
                  />
                  <p className="mt-1 text-xs text-cyan-200/50">First-and-last-frame-to-video: provide start + end images. Same constraints as start frame.</p>
                </div>
              ) : null}

              {/* Video clip upload - I2V 2.7 only — alternative to image_url */}
              {videoProvider === "fal-i2v-2.7" ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-violet-200/80">Video Clip (optional, 1 clip)</label>
                  <input
                    type="file"
                    accept="video/mp4,video/quicktime,.mp4,.mov"
                    className="block w-full rounded-2xl border border-violet-200/25 bg-slate-900/70 p-3 text-sm"
                    onChange={(event) => setVideoClipFile(event.target.files?.[0] || null)}
                  />
                  <p className="mt-1 text-xs text-violet-200/50">
                    Continue from a video clip. MP4 or MOV, 2-10s, max 100 MB. Cannot be combined with start frame image.
                  </p>
                </div>
              ) : null}

              {/* Audio upload - fal.ai I2V modes — 1 audio file */}
              {(videoProvider === "fal" || videoProvider === "fal-i2v-2.7") ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-amber-200/80">Audio (optional, 1 file)</label>
                  <input
                    type="file"
                    accept="audio/wav,audio/mp3,audio/mpeg,.wav,.mp3"
                    className="block w-full rounded-2xl border border-amber-200/25 bg-slate-900/70 p-3 text-sm"
                    onChange={(event) => setAudioFile(event.target.files?.[0] || null)}
                  />
                  <p className="mt-1 text-xs text-amber-200/50">
                    WAV or MP3, up to 15 MB. {videoProvider === "fal-i2v-2.7" ? "Duration: 2-30s." : "Audio will be trimmed to match video duration."}
                  </p>
                </div>
              ) : null}

              {/* Seed input - all fal.ai Wan video models */}
              {(videoProvider === "fal" || videoProvider === "fal-i2v-2.7" || videoProvider === "fal-r2v-2.7") ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Seed (optional)</label>
                  <input
                    type="number"
                    min={0}
                    max={2147483647}
                    step={1}
                    placeholder="Leave blank for random"
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                    className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                  />
                  <p className="mt-1 text-xs text-cyan-200/50">Integer 0-2147483647 for reproducible results.</p>
                </div>
              ) : null}

              {/* Reference images - R2V only (multiple for multi-subject) */}
              {videoProvider === "fal-r2v-2.7" ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Reference Images (optional, multi-subject)</label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                      onChange={(event) => {
                        const files = event.target.files;
                        if (files) setReferenceImages(Array.from(files));
                      }}
                    />
                    <p className="mt-1 text-xs text-cyan-200/50">
                      Character/object appearance. Pass multiple for multi-subject generation. Max 20 MB each.
                    </p>
                    {referenceImages.length > 0 ? (
                      <p className="mt-1 text-xs text-emerald-300/70">{referenceImages.length} image(s) selected</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-violet-200/80">Reference Videos (optional, multi-subject)</label>
                    <input
                      type="file"
                      accept="video/*"
                      multiple
                      className="block w-full rounded-2xl border border-violet-200/25 bg-slate-900/70 p-3 text-sm"
                      onChange={(event) => {
                        const files = event.target.files;
                        if (files) setReferenceVideos(Array.from(files));
                      }}
                    />
                    <p className="mt-1 text-xs text-violet-200/50">
                      Character/object appearance and motion. Pass multiple for multi-subject. Max 100 MB each.
                    </p>
                    {referenceVideos.length > 0 ? (
                      <p className="mt-1 text-xs text-emerald-300/70">{referenceVideos.length} video(s) selected</p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {/* ── LTX 2.3 config panel (Lightricks via fal.ai) ── */}
              {isLtxProvider && ltxModel ? (
                <div className="space-y-4 rounded-2xl border border-fuchsia-300/25 bg-fuchsia-950/15 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-fuchsia-100/35 bg-fuchsia-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-fuchsia-100">
                      Lightricks &middot; {ltxModel.label}
                    </span>
                    <span className="text-xs text-fuchsia-200/70">fal.ai &middot; {ltxModel.pricing}</span>
                    <span className="text-[11px] text-fuchsia-200/60">
                      {ltxModel.safetyParam ? "Safety filter disabled" : "No safety toggle on this endpoint"}
                    </span>
                  </div>

                  {ltxModel.files.length > 0 ? (
                    <div className="space-y-3">
                      {ltxModel.files.map((f) => (
                        <div key={f.key}>
                          <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">
                            {f.label}
                            {f.required ? " (required)" : ""}
                          </label>
                          <input
                            type="file"
                            accept={f.accept}
                            className="block w-full rounded-2xl border border-fuchsia-200/25 bg-slate-900/70 p-3 text-sm"
                            onChange={(event) =>
                              setLtxFiles((prev) => ({ ...prev, [f.key]: event.target.files?.[0] || null }))
                            }
                          />
                          <p className="mt-1 text-xs text-fuchsia-200/60">
                            {f.formats}
                            {f.hint ? ` — ${f.hint}` : ""}
                          </p>
                          {ltxFiles[f.key] ? (
                            <p className="mt-1 text-xs text-emerald-300/70">{ltxFiles[f.key]?.name}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {ltxModel.controls.map(renderLtxControl)}
                </div>
              ) : null}

              {/* ── Cosmos 3 Super config panel (NVIDIA via fal.ai) ── */}
              {isCosmosProvider ? (
                <div className="space-y-4 rounded-2xl border border-sky-300/25 bg-sky-950/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-sky-100/35 bg-sky-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-sky-100">
                      NVIDIA · Cosmos 3 Super
                    </span>
                    <span className="text-xs text-sky-200/70">
                      $0.05/sec &middot; {(cosmosNumFrames / cosmosFps).toFixed(1)}s &asymp; $
                      {((cosmosNumFrames / cosmosFps) * 0.05 * (cosmosAgentic ? cosmosAgenticIterations * cosmosAgenticSamples : 1)).toFixed(2)}
                      {cosmosAgentic ? " (agentic — billed per candidate)" : ""}
                    </span>
                    <span className="text-[11px] text-sky-200/60">Safety filter disabled</span>
                  </div>

                  {/* Output size tier */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-sky-200/80">Output Size</label>
                    <div className="flex flex-wrap gap-2">
                      {COSMOS_TIERS.map((tier) => (
                        <button
                          key={tier.value}
                          type="button"
                          className={pill(cosmosTier === tier.value)}
                          onClick={() => setCosmosTier(tier.value)}
                        >
                          {tier.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-sky-200/60">Clamped and snapped to the nearest supported NVIDIA tier (256p / 480p / 720p).</p>
                  </div>

                  {/* Video length: num_frames + fps */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-sky-200/80">
                      Video Length — {cosmosNumFrames} frames @ {cosmosFps} fps = {(cosmosNumFrames / cosmosFps).toFixed(1)}s
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={189}
                      step={1}
                      value={cosmosNumFrames}
                      onChange={(event) => setCosmosNumFrames(Number(event.target.value))}
                      className="w-full accent-sky-300"
                    />
                    <label className="mt-3 mb-1 block text-xs uppercase tracking-[0.2em] text-sky-200/80">Frames per second: {cosmosFps}</label>
                    <input
                      type="range"
                      min={4}
                      max={60}
                      step={1}
                      value={cosmosFps}
                      onChange={(event) => setCosmosFps(Number(event.target.value))}
                      className="w-full accent-sky-300"
                    />
                    <p className="mt-1 text-xs text-sky-200/60">num_frames 5–189 &divide; frames_per_second 4–60 sets the clip length (fal caps this endpoint at 189 frames ≈ 7.9s @ 24fps).</p>
                  </div>

                  {/* Inference steps */}
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-sky-200/80">Inference Steps: {cosmosSteps}</label>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      step={1}
                      value={cosmosSteps}
                      onChange={(event) => setCosmosSteps(Number(event.target.value))}
                      className="w-full accent-sky-300"
                    />
                    <p className="mt-1 text-xs text-sky-200/60">More steps = higher quality but slower. Default 28.</p>
                  </div>

                  {/* Guidance scale */}
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-sky-200/80">Guidance Scale: {cosmosGuidance}</label>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={0.5}
                      value={cosmosGuidance}
                      onChange={(event) => setCosmosGuidance(Number(event.target.value))}
                      className="w-full accent-sky-300"
                    />
                    <p className="mt-1 text-xs text-sky-200/60">Higher = stronger prompt adherence, less diversity. Default 6.</p>
                  </div>

                  {/* Prompt expansion (Reasoner) */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={pill(enablePromptExpansion, "amber")}
                      onClick={() => setEnablePromptExpansion(!enablePromptExpansion)}
                    >
                      Prompt Expansion: {enablePromptExpansion ? "ON" : "OFF"}
                    </button>
                    <span className="text-xs text-sky-200/60">Cosmos3-Nano Reasoner (a VLM that sees the first frame) rewrites your prompt into the dense caption Cosmos was trained on.</span>
                  </div>

                  {/* Agentic generation loop */}
                  <div className="space-y-3 rounded-xl border border-sky-300/20 bg-slate-900/40 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className={pill(cosmosAgentic, "amber")}
                        onClick={() => setCosmosAgentic(!cosmosAgentic)}
                      >
                        Agentic Generation: {cosmosAgentic ? "ON" : "OFF"}
                      </button>
                      <span className="text-xs text-sky-200/60">Iterative loop: upsample → render candidates → VLM critique → rewrite. Substantially slower & costlier (each candidate is a full render).</span>
                    </div>
                    {cosmosAgentic ? (
                      <>
                        <div>
                          <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-sky-200/80">Max Iterations: {cosmosAgenticIterations}</label>
                          <div className="flex flex-wrap gap-2">
                            {[1, 2, 3].map((n) => (
                              <button key={n} type="button" className={pill(cosmosAgenticIterations === n)} onClick={() => setCosmosAgenticIterations(n)}>
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-sky-200/80">Candidates per Iteration: {cosmosAgenticSamples}</label>
                          <div className="flex flex-wrap gap-2">
                            {[1, 2, 3].map((n) => (
                              <button key={n} type="button" className={pill(cosmosAgenticSamples === n)} onClick={() => setCosmosAgenticSamples(n)}>
                                {n}
                              </button>
                            ))}
                          </div>
                          <p className="mt-1 text-xs text-sky-200/60">The best candidate advances to the next rewrite stage.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            className={pill(cosmosAgenticEarlyStop, "amber")}
                            onClick={() => setCosmosAgenticEarlyStop(!cosmosAgenticEarlyStop)}
                          >
                            Early Stop: {cosmosAgenticEarlyStop ? "ON" : "OFF"}
                          </button>
                          <span className="text-xs text-sky-200/60">Stop the agent early once the critic score clears the strict quality threshold.</span>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {/* Seed */}
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-sky-200/80">Seed (optional)</label>
                    <input
                      type="number"
                      min={0}
                      max={2147483647}
                      step={1}
                      placeholder="Leave blank for random"
                      value={seed}
                      onChange={(event) => setSeed(event.target.value)}
                      className="block w-full rounded-2xl border border-sky-200/25 bg-slate-900/70 p-3 text-sm"
                    />
                    <p className="mt-1 text-xs text-sky-200/60">Same seed + prompt + model version reproduces the same video.</p>
                  </div>
                </div>
              ) : null}

              {/* ── Atlas Cloud Seedance 2.0 config panel ── */}
              {isAtlasProvider ? (
                <div className="space-y-4 rounded-2xl border border-emerald-300/25 bg-emerald-950/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-100/35 bg-emerald-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-emerald-100">
                      Atlas Cloud · Seedance 2.0{isAtlasFast ? " Fast" : ""}
                    </span>
                    <span className="text-xs text-emerald-200/70">
                      ByteDance · {isAtlasFast ? "$0.081/sec" : "$0.10/sec"} · {atlasDuration === -1 ? "auto" : `${atlasDuration}s`} = ${atlasDuration === -1 ? "—" : (atlasDuration * (isAtlasFast ? 0.081 : 0.1)).toFixed(3)}
                    </span>
                    <span className="text-[11px] text-emerald-200/60">
                      Relaxed face/likeness moderation · Native audio
                    </span>
                  </div>

                  {/* Duration */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-emerald-200/80">Duration</label>
                    <div className="flex flex-wrap gap-2">
                      {([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const).map((seconds) => (
                        <button
                          key={seconds}
                          type="button"
                          className={pill(atlasDuration === seconds)}
                          onClick={() => setAtlasDuration(seconds)}
                        >
                          {seconds}s
                        </button>
                      ))}
                      <button
                        type="button"
                        className={pill(atlasDuration === -1, "amber")}
                        onClick={() => setAtlasDuration(-1)}
                      >
                        auto
                      </button>
                    </div>
                  </div>

                  {/* Resolution (Atlas: 480p | 720p | 1080p) */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-emerald-200/80">Resolution</label>
                    <div className="flex flex-wrap gap-2">
                      {(["480p", "720p", "1080p"] as const).map((res) => (
                        <button
                          key={res}
                          type="button"
                          className={pill(atlasResolution === res)}
                          onClick={() => setAtlasResolution(res)}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-emerald-200/60">480p / 720p / 1080p.</p>
                  </div>

                  {/* Aspect ratio */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-emerald-200/80">Aspect Ratio</label>
                    <div className="flex flex-wrap gap-2">
                      {(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const).map((ar) => (
                        <button
                          key={ar}
                          type="button"
                          className={pill(atlasRatio === ar)}
                          onClick={() => setAtlasRatio(ar)}
                        >
                          {ar}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-emerald-200/60">&quot;adaptive&quot; infers from your source image.</p>
                  </div>

                  {/* Toggles */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={pill(atlasGenerateAudio, "amber")}
                      onClick={() => setAtlasGenerateAudio(!atlasGenerateAudio)}
                    >
                      Generate Audio: {atlasGenerateAudio ? "ON" : "OFF"}
                    </button>
                    <button
                      type="button"
                      className={pill(atlasWatermark, "amber")}
                      onClick={() => setAtlasWatermark(!atlasWatermark)}
                    >
                      Watermark: {atlasWatermark ? "ON" : "OFF"}
                    </button>
                    {isAtlasI2V ? (
                      <button
                        type="button"
                        className={pill(atlasReturnLastFrame, "amber")}
                        onClick={() => setAtlasReturnLastFrame(!atlasReturnLastFrame)}
                      >
                        Return Last Frame: {atlasReturnLastFrame ? "ON" : "OFF"}
                      </button>
                    ) : null}
                  </div>

                  {/* End image for Atlas I2V */}
                  {isAtlasI2V ? (
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-emerald-200/80">End Frame Image (optional, 1 image)</label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp"
                        className="block w-full rounded-2xl border border-emerald-200/25 bg-slate-900/70 p-3 text-sm"
                        onChange={(event) => setEndImageFile(event.target.files?.[0] || null)}
                      />
                      <p className="mt-1 text-xs text-emerald-200/60">Use start + end to produce a first-and-last-frame-to-video shot.</p>
                    </div>
                  ) : null}

                  {/* Reference-to-video: images (up to 9) */}
                  {isAtlasR2V ? (
                    <>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-emerald-200/80">Reference Images (up to 9)</label>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="block w-full rounded-2xl border border-emerald-200/25 bg-slate-900/70 p-3 text-sm"
                          onChange={(event) => {
                            const files = event.target.files;
                            if (files) setAtlasRefImages(Array.from(files).slice(0, 9));
                          }}
                        />
                        <p className="mt-1 text-xs text-emerald-200/60">
                          Use multiple reference images for multi-image/character consistency. Max 9 images.
                        </p>
                        {atlasRefImages.length > 0 ? (
                          <p className="mt-1 text-xs text-emerald-300/70">{atlasRefImages.length} image(s) selected</p>
                        ) : null}
                      </div>

                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-emerald-200/80">Reference Videos (up to 3, ≤15s total)</label>
                        <input
                          type="file"
                          accept="video/*"
                          multiple
                          className="block w-full rounded-2xl border border-emerald-200/25 bg-slate-900/70 p-3 text-sm"
                          onChange={(event) => {
                            const files = event.target.files;
                            if (files) setAtlasRefVideos(Array.from(files).slice(0, 3));
                          }}
                        />
                        <p className="mt-1 text-xs text-emerald-200/60">Use for video editing/extension.</p>
                        {atlasRefVideos.length > 0 ? (
                          <p className="mt-1 text-xs text-emerald-300/70">{atlasRefVideos.length} video(s) selected</p>
                        ) : null}
                      </div>

                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-emerald-200/80">Reference Audio (up to 3, ≤15s total)</label>
                        <input
                          type="file"
                          accept="audio/*"
                          multiple
                          className="block w-full rounded-2xl border border-emerald-200/25 bg-slate-900/70 p-3 text-sm"
                          onChange={(event) => {
                            const files = event.target.files;
                            if (files) setAtlasRefAudios(Array.from(files).slice(0, 3));
                          }}
                        />
                        <p className="mt-1 text-xs text-emerald-200/60">Drives audio/lip-sync.</p>
                        {atlasRefAudios.length > 0 ? (
                          <p className="mt-1 text-xs text-emerald-300/70">{atlasRefAudios.length} audio clip(s) selected</p>
                        ) : null}
                      </div>
                    </>
                  ) : null}

                  {/* Seed for Atlas */}
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-emerald-200/80">Seed (optional)</label>
                    <input
                      type="number"
                      min={0}
                      max={2147483647}
                      step={1}
                      placeholder="Leave blank for random"
                      value={seed}
                      onChange={(event) => setSeed(event.target.value)}
                      className="block w-full rounded-2xl border border-emerald-200/25 bg-slate-900/70 p-3 text-sm"
                    />
                    <p className="mt-1 text-xs text-emerald-200/60">Integer 0-2147483647 for reproducible results.</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <select
                className="w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                value={imageModel}
                onChange={(event) => {
                  const value = event.target.value;
                  setImageModel(value);
                  // Seed each camera-angle model with its own recommended defaults.
                  if (value === "flux2-angles") {
                    setAngleVertical((v) => Math.min(60, Math.max(0, v)));
                    setAngleGuidance(2.5);
                    setAngleSteps(40);
                  } else if (value === "qwen-angles") {
                    setAngleGuidance(4.5);
                    setAngleSteps(28);
                  }
                }}
              >
                <optgroup label="Camera-Angle Control (fal.ai)">
                  <option value="flux2-angles">FLUX 2 Multi-Angle ✦ newest (fal.ai)</option>
                  <option value="qwen-angles">Qwen 2511 Multi-Angle (fal.ai, $0.035/MP)</option>
                </optgroup>
                <optgroup label="Wan 2.7 fal.ai - Text-to-Image">
                  <option value="fal-t2i-2.7">Wan 2.7 T2I (fal.ai, $0.03)</option>
                  <option value="fal-pro-t2i-2.7">Wan 2.7 Pro T2I (fal.ai, premium)</option>
                </optgroup>
                <optgroup label="Wan 2.7 fal.ai - Image Edit (1-4 images)">
                  <option value="fal-edit-2.7">Wan 2.7 Edit (fal.ai, $0.03)</option>
                  <option value="fal-pro-edit-2.7">Wan 2.7 Pro Edit (fal.ai, $0.075)</option>
                </optgroup>
                <optgroup label="Seedream 4.5 fal.ai - Image Edit (up to 10 images)">
                  <option value="fal-seedream-edit-4.5">Seedream 4.5 Edit (fal.ai, $0.04)</option>
                </optgroup>
                <optgroup label="Text-to-Image (no upload needed)">
                  <option value="flux-schnell">Flux 1 Schnell (fast)</option>
                  <option value="flux-dev">Flux 1 Dev (quality)</option>
                  <option value="qwen-t2i">Qwen Image (text-to-image)</option>
                </optgroup>
                <optgroup label="Image-to-Image (upload required)">
                  <option value="flux">Flux Kontext Dev (edit)</option>
                  <option value="qwen">Qwen Image Edit</option>
                  <option value="qwen-2511">Qwen Image Edit 2511</option>
                  <option value="p-edit">P-Image Edit ($0.01)</option>
                  <option value="seedream-edit">Seedream 4.0 Edit</option>
                  <option value="nano-banana">Nano Banana Edit</option>
                  <option value="z-turbo">Z-Image Turbo (i2i)</option>
                </optgroup>
              </select>

              {/* ── Camera-angle control panel (Qwen 2511 / FLUX 2 Multiple Angles) ── */}
              {isAngleModel ? (
                <div className="space-y-4 rounded-2xl border border-fuchsia-300/25 bg-fuchsia-950/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-fuchsia-100/35 bg-fuchsia-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-fuchsia-100">
                      {imageModel === "flux2-angles" ? "FLUX 2 · Multi-Angle" : "Qwen 2511 · Multi-Angle"}
                    </span>
                    <span className="text-xs text-fuchsia-200/70">
                      {imageModel === "flux2-angles" ? "Newest camera-control LoRA" : "$0.035 / megapixel"} · azimuth + elevation + zoom
                    </span>
                    <span className="text-[11px] text-emerald-200/70">Safety filter disabled</span>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Input Image (required, 1)</label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp"
                      className="block w-full rounded-2xl border border-fuchsia-100/25 bg-slate-900/70 p-3 text-sm"
                      onChange={(event) => setEditImages(event.target.files?.[0] ? [event.target.files[0]] : [])}
                    />
                    <p className="mt-1 text-xs text-fuchsia-200/50">The photo whose camera angle you want to change.</p>
                    {editImages.length > 0 ? (
                      <p className="mt-1 text-xs text-emerald-300/70">{editImages.length} image selected</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">
                      Horizontal Angle (azimuth) — {angleHorizontal}°
                    </label>
                    <input type="range" min={0} max={360} step={1} value={angleHorizontal}
                      onChange={(e) => setAngleHorizontal(Number(e.target.value))} className="w-full accent-fuchsia-300" />
                    <p className="mt-1 text-[11px] text-fuchsia-200/60">0°=front · 90°=right side · 180°=back · 270°=left · 360°=front.</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">
                      Vertical Angle (elevation) — {angleVertical}°
                    </label>
                    <input
                      type="range"
                      min={imageModel === "flux2-angles" ? 0 : -30}
                      max={imageModel === "flux2-angles" ? 60 : 90}
                      step={1}
                      value={angleVertical}
                      onChange={(e) => setAngleVertical(Number(e.target.value))}
                      className="w-full accent-fuchsia-300"
                    />
                    <p className="mt-1 text-[11px] text-fuchsia-200/60">
                      {imageModel === "flux2-angles"
                        ? "0°=eye-level · 30°=elevated · 60°=high-angle (looking down)."
                        : "-30°=low-angle (looking up) · 0°=eye-level · 30°=elevated · 60°=high · 90°=bird's-eye."}
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Zoom / Distance — {angleZoom}</label>
                    <input type="range" min={0} max={10} step={0.5} value={angleZoom}
                      onChange={(e) => setAngleZoom(Number(e.target.value))} className="w-full accent-fuchsia-300" />
                    <p className="mt-1 text-[11px] text-fuchsia-200/60">0=wide shot (far) · 5=medium · 10=close-up (very close).</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">LoRA Scale — {angleLoraScale}</label>
                      <input type="range" min={0} max={4} step={0.05} value={angleLoraScale}
                        onChange={(e) => setAngleLoraScale(Number(e.target.value))} className="w-full accent-fuchsia-300" />
                      <p className="mt-1 text-[11px] text-fuchsia-200/60">Strength of the camera-control effect (1 = default).</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Guidance (CFG) — {angleGuidance}</label>
                      <input type="range" min={1} max={20} step={0.5} value={angleGuidance}
                        onChange={(e) => setAngleGuidance(Number(e.target.value))} className="w-full accent-fuchsia-300" />
                      <p className="mt-1 text-[11px] text-fuchsia-200/60">Higher = stronger prompt adherence.</p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Inference Steps — {angleSteps}</label>
                      <input type="range" min={1} max={50} step={1} value={angleSteps}
                        onChange={(e) => setAngleSteps(Number(e.target.value))} className="w-full accent-fuchsia-300" />
                      <p className="mt-1 text-[11px] text-fuchsia-200/60">More steps = higher quality, slower.</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Number of Images</label>
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3, 4].map((n) => (
                          <button key={n} type="button" className={pill(angleNumImages === n)} onClick={() => setAngleNumImages(n)}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Acceleration</label>
                      <div className="flex flex-wrap gap-2">
                        {(["regular", "none"] as const).map((a) => (
                          <button key={a} type="button" className={pill(angleAcceleration === a)} onClick={() => setAngleAcceleration(a)}>
                            {a}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-fuchsia-200/60">&quot;regular&quot; is faster; &quot;none&quot; can be slightly higher quality.</p>
                    </div>
                    <div>
                      <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Output Format</label>
                      <div className="flex flex-wrap gap-2">
                        {(["png", "jpeg", "webp"] as const).map((f) => (
                          <button key={f} type="button" className={pill(angleOutputFormat === f)} onClick={() => setAngleOutputFormat(f)}>
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Output Image Size</label>
                    <select
                      className="w-full rounded-2xl border border-fuchsia-100/25 bg-slate-900/70 p-3 text-sm"
                      value={angleImageSize}
                      onChange={(e) => setAngleImageSize(e.target.value)}
                    >
                      <option value="">Match input image (default)</option>
                      <option value="square_hd">Square HD (1024²)</option>
                      <option value="square">Square (512²)</option>
                      <option value="portrait_4_3">Portrait 4:3</option>
                      <option value="portrait_16_9">Portrait 16:9</option>
                      <option value="landscape_4_3">Landscape 4:3</option>
                      <option value="landscape_16_9">Landscape 16:9</option>
                      <option value="custom">Custom (set width × height)…</option>
                    </select>
                    {angleImageSize === "custom" ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-fuchsia-200/70">
                          Width
                          <input type="number" min={256} max={4096} step={8} value={angleCustomW}
                            onChange={(e) => setAngleCustomW(Number(e.target.value))}
                            className="mt-1 block w-full rounded-xl border border-fuchsia-100/25 bg-slate-900/70 p-2 text-sm" />
                        </label>
                        <label className="text-[11px] text-fuchsia-200/70">
                          Height
                          <input type="number" min={256} max={4096} step={8} value={angleCustomH}
                            onChange={(e) => setAngleCustomH(Number(e.target.value))}
                            className="mt-1 block w-full rounded-xl border border-fuchsia-100/25 bg-slate-900/70 p-2 text-sm" />
                        </label>
                      </div>
                    ) : null}
                    <p className="mt-1 text-[11px] text-fuchsia-200/60">Leave on &quot;Match input&quot; to keep the source resolution.</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-fuchsia-200/80">Seed (optional)</label>
                    <input type="number" min={0} max={2147483647} step={1} placeholder="Leave blank for random"
                      value={seed} onChange={(e) => setSeed(e.target.value)}
                      className="block w-full rounded-2xl border border-fuchsia-100/25 bg-slate-900/70 p-3 text-sm" />
                  </div>

                  <p className="text-[11px] text-fuchsia-200/55">
                    The Prompt box above is optional here — it&apos;s appended to the auto-generated camera prompt
                    {imageModel === "qwen-angles" ? "; the Negative Prompt is also honored." : "."}
                  </p>
                </div>
              ) : null}

              {/* ── Wan 2.7 Pro/Edit "Perspective" faders → camera-control prompt ── */}
              {isWanEditModel ? (
                <div>
                  <button
                    type="button"
                    className={pill(perspectiveOpen, "violet")}
                    onClick={() => setPerspectiveOpen((open) => !open)}
                  >
                    Perspective {perspectiveOpen ? "▴" : "▾"}
                  </button>
                  <span className="ml-3 text-xs text-violet-100/60">
                    Optional camera faders — moving them builds a camera-control prompt for the Wan editor.
                  </span>

                  {perspectiveOpen ? (
                    <div className="mt-3 space-y-4 rounded-2xl border border-violet-300/25 bg-violet-950/20 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-violet-200/80">Camera Perspective</span>
                        <button type="button" className="text-[11px] text-violet-200/70 underline" onClick={() => setPersp({ ...PERSPECTIVE_DEFAULT })}>
                          Reset
                        </button>
                      </div>

                      <PerspectiveSlider label="Orbit (left ↔ right)" min={-180} max={180} step={5} value={persp.orbit}
                        onChange={(v) => setPerspField("orbit", v)} unit="°" hint="Rotate around the subject. + right · - left." />
                      <PerspectiveSlider label="Tilt (down ↔ up)" min={-45} max={45} step={1} value={persp.tilt}
                        onChange={(v) => setPerspField("tilt", v)} unit="°" hint="+ up (low-angle) · - down (high-angle)." />
                      <PerspectiveSlider label="Zoom (wide ↔ tight)" min={-10} max={10} step={1} value={persp.zoom}
                        onChange={(v) => setPerspField("zoom", v)} hint="+ closer/tighter · - wider." />
                      <PerspectiveSlider label="Dolly (back ↔ in)" min={-10} max={10} step={1} value={persp.dolly}
                        onChange={(v) => setPerspField("dolly", v)} hint="Physically move the camera. + push in · - pull back." />
                      <PerspectiveSlider label="Roll (dutch angle)" min={-45} max={45} step={1} value={persp.roll}
                        onChange={(v) => setPerspField("roll", v)} unit="°" hint="Tilt the horizon. + clockwise · - counter-clockwise." />
                      <PerspectiveSlider label="Reframe X (left ↔ right)" min={-10} max={10} step={1} value={persp.panX}
                        onChange={(v) => setPerspField("panX", v)} hint="Shift framing horizontally." />
                      <PerspectiveSlider label="Reframe Y (down ↔ up)" min={-10} max={10} step={1} value={persp.pedY}
                        onChange={(v) => setPerspField("pedY", v)} hint="Shift framing vertically." />
                      <PerspectiveSlider label="Subject Scale" min={0.5} max={2} step={0.05} value={persp.scale}
                        onChange={(v) => setPerspField("scale", v)} unit="×" hint="Make the subject bigger/smaller in frame (1 = unchanged)." />
                      <PerspectiveSlider label="Lens Focal Length" min={14} max={200} step={1} value={persp.focal}
                        onChange={(v) => setPerspField("focal", v)} unit="mm" hint="≤24mm wide-angle · 50mm standard · ≥85mm telephoto." />

                      <div className="rounded-xl border border-violet-300/20 bg-slate-900/50 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-violet-200/70">Prompt that will be sent</p>
                        <p className="mt-1 text-xs text-violet-100/90">
                          {perspectiveText || "Move a fader to generate camera instructions…"}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* fal.ai image model config options */}
              {["fal-t2i-2.7", "fal-pro-t2i-2.7", "fal-edit-2.7", "fal-pro-edit-2.7"].includes(imageModel) ? (
                <div className="space-y-4 rounded-2xl border border-violet-300/20 bg-violet-950/20 p-4">
                  <p className="text-xs text-violet-300/70">fal.ai &middot; Wan 2.7 &middot; Safety filter disabled</p>

                  {/* Image Size */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Image Size</label>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { value: "square_hd", label: "Square HD" },
                        { value: "square", label: "Square" },
                        { value: "portrait_4_3", label: "Portrait 4:3" },
                        { value: "portrait_16_9", label: "Portrait 16:9" },
                        { value: "landscape_4_3", label: "Landscape 4:3" },
                        { value: "landscape_16_9", label: "Landscape 16:9" },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={pill(imageSize === value)}
                          onClick={() => setImageSize(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Number of Images */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                      Number of Images (max {["fal-edit-2.7", "fal-pro-edit-2.7"].includes(imageModel) ? 4 : 5})
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(["fal-edit-2.7", "fal-pro-edit-2.7"].includes(imageModel)
                        ? [1, 2, 3, 4]
                        : [1, 2, 3, 4, 5]
                      ).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={pill(numImages === n)}
                          onClick={() => setNumImages(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Prompt Expansion - edit models only */}
                  {["fal-edit-2.7", "fal-pro-edit-2.7"].includes(imageModel) ? (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className={pill(enablePromptExpansion, "amber")}
                        onClick={() => setEnablePromptExpansion(!enablePromptExpansion)}
                      >
                        Prompt Expansion: {enablePromptExpansion ? "ON" : "OFF"}
                      </button>
                      <span className="text-xs text-cyan-100/60">DashScope prompt expansion</span>
                    </div>
                  ) : null}

                  {/* Edit Images upload (1-4 images) - edit models only */}
                  {["fal-edit-2.7", "fal-pro-edit-2.7"].includes(imageModel) ? (
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                        Input Images (1-4, required)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                        onChange={(event) => {
                          const files = event.target.files;
                          if (files) setEditImages(Array.from(files).slice(0, 4));
                        }}
                      />
                      <p className="mt-1 text-xs text-cyan-200/50">
                        Reference them as &quot;image 1&quot;, &quot;image 2&quot;, etc. in your prompt. Supports Chinese and English.
                      </p>
                      {editImages.length > 0 ? (
                        <p className="mt-1 text-xs text-emerald-300/70">{editImages.length} image(s) selected</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Seedream 4.5 Edit config options */}
              {imageModel === "fal-seedream-edit-4.5" ? (
                <div className="space-y-4 rounded-2xl border border-violet-300/20 bg-violet-950/20 p-4">
                  <p className="text-xs text-violet-300/70">fal.ai &middot; Seedream 4.5 &middot; ByteDance &middot; $0.04/image</p>

                  {/* Image Size */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Image Size</label>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { value: "auto_4K", label: "Auto 4K" },
                        { value: "square_hd", label: "Square HD" },
                        { value: "landscape_16_9", label: "Landscape 16:9" },
                        { value: "portrait_16_9", label: "Portrait 16:9" },
                        { value: "landscape_4_3", label: "Landscape 4:3" },
                        { value: "portrait_4_3", label: "Portrait 4:3" },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={pill(imageSize === value)}
                          onClick={() => setImageSize(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Number of Generations */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                      Generations (num_images, max 6)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={pill(numImages === n)}
                          onClick={() => setNumImages(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Max Images per Generation */}
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                      Max Images per Generation (max 6)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={pill(maxImages === n)}
                          onClick={() => setMaxImages(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-cyan-200/50">
                      Total output: {numImages} to {maxImages * numImages} images. Input + output must not exceed 15.
                    </p>
                  </div>

                  {/* Edit Images upload (up to 10 images) */}
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                      Input Images (1-10, required)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                      onChange={(event) => {
                        const files = event.target.files;
                        if (files) setEditImages(Array.from(files).slice(0, 10));
                      }}
                    />
                    <p className="mt-1 text-xs text-cyan-200/50">
                      Reference them as &quot;Figure 1&quot;, &quot;Figure 2&quot;, etc. in your prompt. Up to 10 images.
                    </p>
                    {editImages.length > 0 ? (
                      <p className="mt-1 text-xs text-emerald-300/70">{editImages.length} image(s) selected</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Standard file upload for non-fal image models */}
              {fileRequired ? (
                <input
                  type="file"
                  accept="image/*"
                  className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                  onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
                />
              ) : null}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={isSubmitting}
              className={`
                rounded-2xl border border-cyan-50/70 bg-gradient-to-r from-cyan-100 to-cyan-300 px-6 py-3
                text-xs font-semibold uppercase tracking-[0.16em] text-slate-900
                shadow-[0_20px_55px_rgba(34,211,238,0.45)] transition-all duration-200
                disabled:opacity-70 disabled:cursor-wait
                ${isSubmitting
                  ? "scale-[0.96] shadow-[0_12px_30px_rgba(34,211,238,0.6)] brightness-110"
                  : "hover:scale-[1.02] hover:shadow-[0_24px_60px_rgba(34,211,238,0.5)] active:scale-[0.96]"
                }
              `}
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
            <a
              href="/queue"
              className="rounded-2xl border border-cyan-100/40 bg-slate-900/55 px-5 py-3 text-xs uppercase tracking-[0.16em] text-cyan-100 transition-all duration-200 hover:bg-slate-800/65 hover:shadow-[0_0_10px_rgba(34,211,238,0.15)] active:scale-[0.94] active:brightness-110"
            >
              Open Queue
            </a>
            {flash === "success" ? (
              <span className="text-sm text-emerald-300">
                ✓ Submitted — generation started. Track it above; stay here to queue more.
              </span>
            ) : flash === "failure" ? (
              <span className="text-sm text-rose-300">Submission failed.</span>
            ) : null}
            {error ? <span className="text-sm text-rose-300">{error}</span> : null}
          </div>
        </div>
      </article>

      <article className="rounded-[2.2rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-6">
        <h3 className="text-xl font-semibold">
          Render Reactor
        </h3>
        <p className="mt-2 text-sm text-cyan-100/80">
          Model output is persisted to Supabase, status is synchronized through queue polling, and media is surfaced in
          library playback/download.
        </p>
        <div className="mt-4">
          <EffectsErrorBoundary>
            <PostFxHalo />
          </EffectsErrorBoundary>
        </div>
        <div className="mt-4 space-y-3 text-xs text-cyan-100/75">
          <p>Video: WAN 2.6 T2V/I2V (RunPod) + WAN 2.6/2.7 on fal.ai + Seedance 2.0 (Atlas Cloud)</p>
          <p>Seedance 2.0 on Atlas Cloud: I2V, R2V (up to 9 images / 3 videos / 3 audio clips), T2V — plus Fast variants.</p>
          <p>Image: Wan 2.7 T2I/Edit/Pro (fal.ai) + Qwen + Flux + more</p>
          <p>Video: NVIDIA Cosmos 3 Super I2V (fal.ai) — world-model generation with optional agentic refinement.</p>
          <p>Atlas Cloud backend supports realistic faces (relaxed moderation). Uploads are private signed URLs; outputs are re-hosted to Supabase storage before expiring.</p>
        </div>
      </article>
      </section>
    </div>
  );
}
