"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EffectsErrorBoundary } from "@/components/app/EffectsErrorBoundary";
import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { PostFxHalo } from "@/components/effects/PostFxHalo";
import { RapierFloatField } from "@/components/effects/RapierFloatField";

export function StudioCreateView() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("video");
  const [videoMode, setVideoMode] = useState<"i2v" | "t2v">("t2v");
  const [videoProvider, setVideoProvider] = useState<"runpod" | "fal">("runpod");
  const [duration, setDuration] = useState<5 | 10 | 15>(5);
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [imageModel, setImageModel] = useState<string>("flux-schnell");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flash, setFlash] = useState<string>("");
  const [error, setError] = useState("");

  const fileRequired = useMemo(
    () => {
      if (mediaType === "video") {
        // fal.ai I2V always needs an image, RunPod I2V needs an image
        if (videoProvider === "fal") return true;
        return videoMode === "i2v";
      }
      // Text-to-image models don't need a file upload
      const textOnlyModels = ["flux-dev", "flux-schnell", "qwen-t2i"];
      if (textOnlyModels.includes(imageModel)) return false;
      return true; // all other image models need input images
    },
    [mediaType, videoMode, videoProvider, imageModel],
  );

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
      router.push("/queue");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected submit error.");
      setFlash("failure");
    } finally {
      setIsSubmitting(false);
    }
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
                className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                  mediaType === value
                    ? "border-cyan-100/80 bg-cyan-200/80 text-slate-900 shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                    : "border-cyan-300/30 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/20 hover:shadow-[0_0_8px_rgba(34,211,238,0.12)]"
                }`}
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
                  {([
                    { value: "runpod" as const, label: "RunPod" },
                    { value: "fal" as const, label: "Wan 2.6 fal.ai (I2V)" },
                  ]).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                        videoProvider === value
                          ? "border-violet-100/80 bg-violet-200/80 text-slate-900 shadow-[0_0_12px_rgba(167,139,250,0.3)]"
                          : "border-violet-300/30 bg-violet-400/10 text-violet-100 hover:bg-violet-400/20 hover:shadow-[0_0_8px_rgba(167,139,250,0.12)]"
                      }`}
                      onClick={() => setVideoProvider(value)}
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
                      className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                        videoMode === value
                          ? "border-cyan-100/80 bg-white/85 text-slate-900 shadow-[0_0_12px_rgba(255,255,255,0.2)]"
                          : "border-cyan-100/30 bg-white/5 text-cyan-100 hover:bg-white/10 hover:shadow-[0_0_8px_rgba(255,255,255,0.08)]"
                      }`}
                      onClick={() => setVideoMode(value)}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {[5, 10, 15].map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                      duration === seconds
                        ? "border-cyan-100/80 bg-cyan-100 text-slate-900 shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                        : "border-cyan-100/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20 hover:shadow-[0_0_8px_rgba(34,211,238,0.12)]"
                    }`}
                    onClick={() => setDuration(seconds as 5 | 10 | 15)}
                  >
                    {seconds}s
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {(["720p", "1080p"] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                      resolution === res
                        ? "border-cyan-100/80 bg-cyan-100 text-slate-900 shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                        : "border-cyan-100/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20 hover:shadow-[0_0_8px_rgba(34,211,238,0.12)]"
                    }`}
                    onClick={() => setResolution(res)}
                  >
                    {res}
                  </button>
                ))}
              </div>

              {/* fal.ai pricing hint */}
              {videoProvider === "fal" ? (
                <p className="text-xs text-violet-300/70">
                  Pricing: ${resolution === "720p" ? "0.10" : "0.15"}/sec &middot; {duration}s = ${(duration * (resolution === "720p" ? 0.10 : 0.15)).toFixed(2)}
                </p>
              ) : null}

              {/* Image upload - show for i2v (RunPod) or fal.ai (always i2v) */}
              {(videoProvider === "fal" || videoMode === "i2v") ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Input Image</label>
                  <input
                    type="file"
                    accept="image/*"
                    className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                    onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
                  />
                </div>
              ) : null}

              {/* Audio upload - fal.ai only, optional */}
              {videoProvider === "fal" ? (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-amber-200/80">Audio (optional)</label>
                  <input
                    type="file"
                    accept="audio/wav,audio/mp3,audio/mpeg,.wav,.mp3"
                    className="block w-full rounded-2xl border border-amber-200/25 bg-slate-900/70 p-3 text-sm"
                    onChange={(event) => setAudioFile(event.target.files?.[0] || null)}
                  />
                  <p className="mt-1 text-xs text-amber-200/50">WAV or MP3, up to 15 MB. Audio will be trimmed to match video duration.</p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <select
                className="w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                value={imageModel}
                onChange={(event) => setImageModel(event.target.value)}
              >
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
          <p>Video modes: WAN 2.6 T2V + WAN 2.6 I2V (RunPod) + WAN 2.6 I2V (fal.ai)</p>
          <p>Image modes: Qwen Image Edit + Flux Kontext Dev</p>
          <p>Upload inputs are private signed URLs and outputs are re-hosted to your storage bucket.</p>
        </div>
      </article>
    </section>
  );
}
