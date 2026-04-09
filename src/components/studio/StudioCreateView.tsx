"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EffectsErrorBoundary } from "@/components/app/EffectsErrorBoundary";
import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { PostFxHalo } from "@/components/effects/PostFxHalo";
import { RapierFloatField } from "@/components/effects/RapierFloatField";

type VideoProvider = "runpod" | "fal" | "fal-i2v-2.7" | "fal-r2v-2.7";

export function StudioCreateView() {
  const router = useRouter();
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
  const [enablePromptExpansion, setEnablePromptExpansion] = useState(true);

  // Wan 2.7 R2V extras
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [referenceVideos, setReferenceVideos] = useState<File[]>([]);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1" | "4:3" | "3:4">("16:9");
  const [multiShots, setMultiShots] = useState(false);

  // fal.ai image model extras
  const [editImages, setEditImages] = useState<File[]>([]);
  const [imageSize, setImageSize] = useState<string>("square_hd");
  const [numImages, setNumImages] = useState(1);
  const [maxImages, setMaxImages] = useState(1);

  const isFalProvider = videoProvider === "fal" || videoProvider === "fal-i2v-2.7" || videoProvider === "fal-r2v-2.7";

  const fileRequired = useMemo(
    () => {
      if (mediaType === "video") {
        if (videoProvider === "fal-r2v-2.7") return false; // uses referenceImages instead
        if (videoProvider === "fal-i2v-2.7") return false; // image is optional for 2.7 I2V
        if (videoProvider === "fal") return true;
        return videoMode === "i2v";
      }
      // T2I models need no file; fal edit models use editImages (multi-upload), not sourceFile
      const noSourceFileModels = [
        "flux-dev", "flux-schnell", "qwen-t2i",
        "fal-t2i-2.7", "fal-pro-t2i-2.7",
        "fal-edit-2.7", "fal-pro-edit-2.7",
        "fal-seedream-edit-4.5",
      ];
      if (noSourceFileModels.includes(imageModel)) return false;
      return true;
    },
    [mediaType, videoMode, videoProvider, imageModel],
  );

  const durationOptions = useMemo(() => {
    if (videoProvider === "fal-r2v-2.7") return [2, 3, 4, 5, 6, 7, 8, 9, 10];
    if (videoProvider === "fal-i2v-2.7") return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    return [5, 10, 15];
  }, [videoProvider]);

  const submit = async () => {
    setError("");
    setFlash("");

    if (!prompt.trim()) {
      setError("Prompt is required.");
      return;
    }

    if (fileRequired && !sourceFile) {
      setError("Please upload an input image.");
      return;
    }

    setIsSubmitting(true);

    try {
      const body = new FormData();
      body.set("prompt", prompt.trim());
      if (negativePrompt.trim()) body.set("negativePrompt", negativePrompt.trim());
      body.set("mediaType", mediaType);
      body.set("videoMode", videoProvider === "fal" ? "i2v" : videoMode);
      body.set("videoProvider", videoProvider);
      body.set("duration", String(duration));
      body.set("resolution", resolution);
      body.set("imageModel", imageModel);
      if (sourceFile) body.set("sourceFile", sourceFile);
      if (audioFile) body.set("audioFile", audioFile);

      // Wan 2.7 I2V extras
      if (videoProvider === "fal-i2v-2.7") {
        if (endImageFile) body.set("endImageFile", endImageFile);
        body.set("enablePromptExpansion", String(enablePromptExpansion));
      }

      // Wan 2.7 R2V extras
      if (videoProvider === "fal-r2v-2.7") {
        body.set("aspectRatio", aspectRatio);
        body.set("multiShots", String(multiShots));
        referenceImages.forEach((file, i) => body.append(`referenceImage_${i}`, file));
        referenceVideos.forEach((file, i) => body.append(`referenceVideo_${i}`, file));
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

      const response = await fetch("/api/jobs", {
        method: "POST",
        body,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Job submission failed.");
      }

      setFlash("success");
      setPrompt("");
      setNegativePrompt("");
      setSourceFile(null);
      setAudioFile(null);
      setEndImageFile(null);
      setReferenceImages([]);
      setReferenceVideos([]);
      setEditImages([]);
      router.push("/queue");
      router.refresh();
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
    { value: "fal-i2v-2.7", label: "Wan 2.7 fal.ai (I2V)" },
    { value: "fal-r2v-2.7", label: "Wan 2.7 fal.ai (R2V)" },
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

  return (
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

              {/* Duration selector */}
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

              {/* Resolution selector */}
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

              {/* Multi-shots toggle - R2V only */}
              {videoProvider === "fal-r2v-2.7" ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className={pill(multiShots, "amber")}
                    onClick={() => setMultiShots(!multiShots)}
                  >
                    Multi-shots: {multiShots ? "ON" : "OFF"}
                  </button>
                  <span className="text-xs text-cyan-100/60">Enable intelligent multi-shot segmentation</span>
                </div>
              ) : null}

              {/* Prompt expansion toggle - I2V 2.7 only */}
              {videoProvider === "fal-i2v-2.7" ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className={pill(enablePromptExpansion, "amber")}
                    onClick={() => setEnablePromptExpansion(!enablePromptExpansion)}
                  >
                    Prompt Expansion: {enablePromptExpansion ? "ON" : "OFF"}
                  </button>
                  <span className="text-xs text-cyan-100/60">Intelligent prompt rewriting</span>
                </div>
              ) : null}

              {/* fal.ai pricing hint */}
              {isFalProvider ? (
                <p className="text-xs text-violet-300/70">
                  fal.ai &middot; $0.10/sec &middot; {duration}s = ${(duration * 0.10).toFixed(2)} &middot; Safety filter disabled
                </p>
              ) : null}

              {/* Image upload for I2V modes */}
              {(videoProvider === "fal" || videoProvider === "fal-i2v-2.7" || videoMode === "i2v") && videoProvider !== "fal-r2v-2.7" ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                    Input Image {videoProvider === "fal-i2v-2.7" ? "(optional start frame)" : ""}
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                    onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
                  />
                </div>
              ) : null}

              {/* End image upload - I2V 2.7 only */}
              {videoProvider === "fal-i2v-2.7" ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">End Frame Image (optional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                    onChange={(event) => setEndImageFile(event.target.files?.[0] || null)}
                  />
                  <p className="mt-1 text-xs text-cyan-200/50">First-and-last-frame-to-video: provide both start and end images.</p>
                </div>
              ) : null}

              {/* Audio upload - fal.ai I2V modes */}
              {(videoProvider === "fal" || videoProvider === "fal-i2v-2.7") ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-amber-200/80">Audio (optional)</label>
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

              {/* Reference images - R2V only (multiple) */}
              {videoProvider === "fal-r2v-2.7" ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Reference Images (optional, multiple)</label>
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
                      Upload one or more reference images for character/object appearance. Max 20 MB each.
                    </p>
                    {referenceImages.length > 0 ? (
                      <p className="mt-1 text-xs text-emerald-300/70">{referenceImages.length} image(s) selected</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-violet-200/80">Reference Videos (optional, multiple)</label>
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
                      Upload reference videos for motion/appearance. Max 100 MB each.
                    </p>
                    {referenceVideos.length > 0 ? (
                      <p className="mt-1 text-xs text-emerald-300/70">{referenceVideos.length} video(s) selected</p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <select
                className="w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                value={imageModel}
                onChange={(event) => setImageModel(event.target.value)}
              >
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
            {flash ? (
              <span className={`text-sm ${flash === "success" ? "text-emerald-300" : "text-rose-300"}`}>{flash}</span>
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
          <p>Video: WAN 2.6 T2V/I2V (RunPod) + WAN 2.6/2.7 I2V + WAN 2.7 R2V (fal.ai)</p>
          <p>Image: Wan 2.7 T2I/Edit/Pro (fal.ai) + Qwen + Flux + more</p>
          <p>Upload inputs are private signed URLs and outputs are re-hosted to your storage bucket.</p>
        </div>
      </article>
    </section>
  );
}
