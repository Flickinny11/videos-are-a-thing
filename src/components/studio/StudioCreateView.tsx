"use client";

import { useRouter } from "next/navigation";
import { VFXSpan } from "react-vfx";
import { useMemo, useState } from "react";

import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { PostFxHalo } from "@/components/effects/PostFxHalo";
import { RapierFloatField } from "@/components/effects/RapierFloatField";

export function StudioCreateView() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("video");
  const [videoMode, setVideoMode] = useState<"i2v" | "t2v">("t2v");
  const [duration, setDuration] = useState<5 | 10 | 15>(5);
  const [imageModel, setImageModel] = useState<"qwen" | "flux">("qwen");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flash, setFlash] = useState<string>("");
  const [error, setError] = useState("");

  const fileRequired = useMemo(
    () => (mediaType === "video" ? videoMode === "i2v" : true),
    [mediaType, videoMode],
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
      body.set("mediaType", mediaType);
      body.set("videoMode", videoMode);
      body.set("duration", String(duration));
      body.set("imageModel", imageModel);
      if (sourceFile) body.set("sourceFile", sourceFile);

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
      setSourceFile(null);
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
        <OglLiquidRibbon className="pointer-events-none absolute inset-0 opacity-60" />
        <RapierFloatField className="pointer-events-none absolute inset-0 opacity-40" count={8} />
        <div className="relative z-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-100/35 bg-cyan-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100">
            <span className="h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_16px_rgba(103,232,249,1)]" />
            Generative Command Deck
          </div>
          <h2 className="text-2xl font-semibold leading-tight md:text-4xl">
            <VFXSpan shader="glitch">Build image and video jobs with a fully instrumented RunPod pipeline.</VFXSpan>
          </h2>

          <label className="mt-6 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Prompt</label>
          <textarea
            className="mt-2 h-44 w-full resize-y rounded-3xl border border-cyan-200/25 bg-slate-900/70 p-4 text-sm outline-none ring-cyan-300/30 transition focus:ring"
            placeholder="Describe scene, camera movement, lens behavior, mood, texture, and composition..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {(["video", "image"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMediaType(value)}
                className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition ${
                  mediaType === value
                    ? "border-cyan-100/80 bg-cyan-200/80 text-slate-900"
                    : "border-cyan-300/30 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/20"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          {mediaType === "video" ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                {(["t2v", "i2v"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition ${
                      videoMode === value
                        ? "border-cyan-100/80 bg-white/85 text-slate-900"
                        : "border-cyan-100/30 bg-white/5 text-cyan-100 hover:bg-white/10"
                    }`}
                    onClick={() => setVideoMode(value)}
                  >
                    {value.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {[5, 10, 15].map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.15em] transition ${
                      duration === seconds
                        ? "border-cyan-100/80 bg-cyan-100 text-slate-900"
                        : "border-cyan-100/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
                    }`}
                    onClick={() => setDuration(seconds as 5 | 10 | 15)}
                  >
                    {seconds}s
                  </button>
                ))}
              </div>

              {videoMode === "i2v" ? (
                <input
                  type="file"
                  accept="image/*"
                  className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                  onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
                />
              ) : null}
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <select
                className="w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                value={imageModel}
                onChange={(event) => setImageModel(event.target.value as "qwen" | "flux")}
              >
                <option value="qwen">Qwen Image Edit</option>
                <option value="flux">Flux Kontext Dev</option>
              </select>
              <input
                type="file"
                accept="image/*"
                className="block w-full rounded-2xl border border-cyan-100/25 bg-slate-900/70 p-3 text-sm"
                onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
              />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={isSubmitting}
              className="rounded-2xl border border-cyan-50/70 bg-gradient-to-r from-cyan-100 to-cyan-300 px-6 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-900 shadow-[0_20px_55px_rgba(34,211,238,0.45)] transition hover:scale-[1.02] disabled:opacity-70"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
            <a
              href="/queue"
              className="rounded-2xl border border-cyan-100/40 bg-slate-900/55 px-5 py-3 text-xs uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-slate-800/65"
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
          <VFXSpan shader="rgbShift">Render Reactor</VFXSpan>
        </h3>
        <p className="mt-2 text-sm text-cyan-100/80">
          Model output is persisted to Supabase, status is synchronized through queue polling, and media is surfaced in
          library playback/download.
        </p>
        <div className="mt-4">
          <PostFxHalo />
        </div>
        <div className="mt-4 space-y-3 text-xs text-cyan-100/75">
          <p>Video modes: WAN 2.6 T2V + WAN 2.6 I2V</p>
          <p>Image modes: Qwen Image Edit + Flux Kontext Dev</p>
          <p>Upload inputs are private signed URLs and outputs are re-hosted to your storage bucket.</p>
        </div>
      </article>
    </section>
  );
}
