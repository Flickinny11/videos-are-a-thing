"use client";

import { gsap } from "gsap";
import Image from "next/image";
import { VFXProvider, VFXSpan } from "react-vfx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CurtainsLayer } from "@/components/effects/CurtainsLayer";
import { InteractiveButton } from "@/components/effects/InteractiveButton";
import { LenisProvider } from "@/components/effects/LenisProvider";
import { downloadFile } from "@/lib/download";
import { OglNebulaBackground } from "@/components/effects/OglNebulaBackground";
import { PostFxHalo } from "@/components/effects/PostFxHalo";
import { PhysicsIcons } from "@/components/effects/PhysicsIcons";
import { PremiumProgressBar } from "@/components/effects/PremiumProgressBar";
import { getRealtimeProgressPercent } from "@/lib/job-progress";
import type { JobResponse, LibraryItem } from "@/types/app";

interface Props {
  userEmail: string;
}

const isActive = (status: string) => status === "IN_QUEUE" || status === "IN_PROGRESS" || status === "RETRY" || status === "THROTTLED";

const statusTone = (status: string) => {
  if (status === "COMPLETED") return "text-emerald-300";
  if (status === "FAILED" || status === "TIMED_OUT") return "text-rose-300";
  if (status === "IN_PROGRESS") return "text-cyan-200";
  return "text-blue-100";
};

export function MediaStudioClient({ userEmail }: Props) {
  const [prompt, setPrompt] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("video");
  const [videoMode, setVideoMode] = useState<"i2v" | "t2v">("t2v");
  const [duration, setDuration] = useState<5 | 10 | 15>(5);
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [imageModel, setImageModel] = useState<string>("flux-schnell");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flash, setFlash] = useState<string>("");
  const [error, setError] = useState<string>("");

  const panelRef = useRef<HTMLDivElement | null>(null);

  const fileRequired = useMemo(
    () => {
      if (mediaType === "video") return videoMode === "i2v";
      const textOnlyModels = ["flux-dev", "flux-schnell", "qwen-t2i"];
      if (textOnlyModels.includes(imageModel)) return false;
      return true;
    },
    [mediaType, videoMode, imageModel],
  );

  const activeJobs = useMemo(() => jobs.filter((job) => isActive(job.status)), [jobs]);

  const fetchJobs = useCallback(async () => {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "Failed to load jobs");
    setJobs(data.jobs || []);
  }, []);

  const fetchLibrary = useCallback(async () => {
    const response = await fetch("/api/library", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "Failed to load library");
    setLibrary(data.items || []);
  }, []);

  const pollingRef = useRef(false);
  const mountedRef = useRef(true);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const pollActiveJobs = useCallback(async () => {
    if (pollingRef.current || !mountedRef.current) return;
    pollingRef.current = true;

    try {
      const currentJobs = jobsRef.current;
      const rows = currentJobs.filter((job) => isActive(job.status));
      if (!rows.length) {
        await fetchJobs();
        return;
      }

      const settled = await Promise.allSettled(
        rows.map(async (job) => {
          const response = await fetch(`/api/jobs/${job.id}/poll`, {
            method: "POST",
            cache: "no-store",
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.success) return null;
          return data.job as JobResponse;
        }),
      );

      if (!mountedRef.current) return;

      const updates = settled
        .filter((r): r is PromiseFulfilledResult<JobResponse | null> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((v): v is JobResponse => v !== null);

      if (updates.length) {
        const patch = new Map(updates.map((job) => [job.id, job]));
        setJobs((current) => current.map((job) => patch.get(job.id) || job));

        // If any jobs just completed, refresh library
        const justCompleted = updates.some(
          (u) => u.status === "COMPLETED" && rows.find((r) => r.id === u.id)?.status !== "COMPLETED",
        );
        if (justCompleted) {
          await fetchLibrary();
        }
      }
    } finally {
      pollingRef.current = false;
    }
  }, [fetchJobs, fetchLibrary]);

  useEffect(() => {
    mountedRef.current = true;
    const boot = async () => {
      try {
        await fetchJobs();
        await fetchLibrary();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load dashboard.");
      }
    };

    void boot();
    return () => { mountedRef.current = false; };
  }, [fetchJobs, fetchLibrary]);

  // Adaptive polling: 3s when in-progress, 6s when queued, 15s when idle
  const hasActive = activeJobs.length > 0;
  const hasInProgress = activeJobs.some((j) => j.status === "IN_PROGRESS");

  useEffect(() => {
    const interval = hasActive
      ? (hasInProgress ? 3000 : 6000)
      : 15000;

    const timer = setInterval(() => {
      void pollActiveJobs();
    }, interval);

    return () => clearInterval(timer);
  }, [hasActive, hasInProgress, pollActiveJobs]);

  useEffect(() => {
    if (!panelRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".studio-stagger",
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.85,
          ease: "power3.out",
          stagger: 0.08,
        },
      );
    }, panelRef);

    return () => ctx.revert();
  }, []);

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
      body.set("resolution", resolution);
      body.set("imageModel", imageModel);
      if (sourceFile) {
        body.set("sourceFile", sourceFile);
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
      if (mediaType === "video" && videoMode === "t2v") setSourceFile(null);

      await fetchJobs();
      await fetchLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected submit error.");
      setFlash("failure");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <VFXProvider>
      <LenisProvider />
      <OglNebulaBackground />
      <CurtainsLayer />
      <div className="relative min-h-screen overflow-hidden px-4 pb-16 pt-8 text-slate-100 md:px-8" ref={panelRef}>
        <div className="mx-auto max-w-7xl">
          <header className="studio-stagger relative mb-10 rounded-3xl border border-cyan-200/20 bg-slate-950/45 p-6 backdrop-blur-xl">
            <PhysicsIcons />
            <div className="mb-2 inline-flex items-center gap-3 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-4 py-1 text-xs tracking-[0.26em] text-cyan-100">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.9)]" />
              RUNPOD MEDIA STUDIO
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
              <VFXSpan shader="rgbShift">Generate cinematic AI video and image outputs in one live command deck.</VFXSpan>
            </h1>
            <p className="mt-4 text-sm text-cyan-50/80">
              Logged in as <span className="font-semibold">{userEmail}</span>
            </p>
            <form action="/auth/logout" method="post" className="mt-4">
              <button className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm transition-all duration-200 hover:bg-white/20 active:scale-95 active:brightness-125" type="submit">
                Sign out
              </button>
            </form>
          </header>

          <section className="studio-stagger mb-8 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-5 backdrop-blur-xl">
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-cyan-200/80">Prompt</label>
              <textarea
                className="h-40 w-full resize-y rounded-2xl border border-cyan-300/25 bg-slate-900/70 p-4 text-sm outline-none ring-cyan-300/30 transition focus:ring"
                placeholder="Describe the scene, movement, lighting, lens, and style..."
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />

              <div className="mt-4 flex flex-wrap gap-2">
                {(["video", "image"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMediaType(value)}
                    className={`rounded-xl px-4 py-2 text-sm transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                      mediaType === value
                        ? "bg-cyan-300 text-slate-900 shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                        : "border border-cyan-300/25 bg-cyan-400/10 hover:bg-cyan-400/20 hover:shadow-[0_0_8px_rgba(34,211,238,0.12)]"
                    }`}
                  >
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>

              {mediaType === "video" ? (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {(["t2v", "i2v"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`rounded-xl px-4 py-2 text-sm transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                          videoMode === value
                            ? "bg-fuchsia-300 text-slate-900 shadow-[0_0_12px_rgba(232,121,249,0.3)]"
                            : "border border-fuchsia-300/30 bg-fuchsia-400/10 hover:bg-fuchsia-400/20 hover:shadow-[0_0_8px_rgba(232,121,249,0.12)]"
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
                        className={`rounded-xl px-4 py-2 text-sm transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                          duration === seconds
                            ? "bg-amber-300 text-slate-900 shadow-[0_0_12px_rgba(252,211,77,0.3)]"
                            : "border border-amber-300/30 bg-amber-300/10 hover:bg-amber-300/20 hover:shadow-[0_0_8px_rgba(252,211,77,0.12)]"
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
                        className={`rounded-xl px-4 py-2 text-sm transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                          resolution === res
                            ? "bg-amber-300 text-slate-900 shadow-[0_0_12px_rgba(252,211,77,0.3)]"
                            : "border border-amber-300/30 bg-amber-300/10 hover:bg-amber-300/20 hover:shadow-[0_0_8px_rgba(252,211,77,0.12)]"
                        }`}
                        onClick={() => setResolution(res)}
                      >
                        {res}
                      </button>
                    ))}
                  </div>

                  {videoMode === "i2v" ? (
                    <input
                      type="file"
                      accept="image/*"
                      className="block w-full rounded-xl border border-cyan-200/25 bg-slate-900/70 p-3 text-sm"
                      onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <select
                    className="w-full rounded-xl border border-cyan-200/25 bg-slate-900/70 p-3 text-sm"
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
                      className="block w-full rounded-xl border border-cyan-200/25 bg-slate-900/70 p-3 text-sm"
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
                    rounded-2xl bg-gradient-to-r from-cyan-300 to-blue-300 px-6 py-3 font-semibold text-slate-900
                    shadow-[0_12px_30px_rgba(56,189,248,0.45)] transition-all duration-200
                    disabled:opacity-70 disabled:cursor-wait
                    ${isSubmitting
                      ? "scale-[0.96] shadow-[0_8px_20px_rgba(56,189,248,0.6)] brightness-110"
                      : "hover:scale-[1.02] hover:shadow-[0_16px_40px_rgba(56,189,248,0.55)] active:scale-[0.96]"
                    }
                  `}
                >
                  {isSubmitting ? "Submitting..." : "Submit"}
                </button>
                {flash ? (
                  <span className={`text-sm ${flash === "success" ? "text-emerald-300" : "text-rose-300"}`}>
                    {flash}
                  </span>
                ) : null}
                {error ? <span className="text-sm text-rose-300">{error}</span> : null}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 backdrop-blur-xl">
              <h2 className="mb-4 text-xl font-semibold">Queue</h2>
              <div className="mb-4">
                <PostFxHalo />
              </div>
              <div className="space-y-3">
                {jobs.length === 0 ? <p className="text-sm text-slate-300/75">No jobs yet.</p> : null}
                {jobs.map((job) => {
                  const progress = getRealtimeProgressPercent(job);
                  const barStatus = job.status === "COMPLETED" ? "completed" as const
                    : (job.status === "FAILED" || job.status === "TIMED_OUT" || job.status === "CANCELLED") ? "failed" as const
                    : "active" as const;

                  return (
                    <article key={job.id} className="rounded-2xl border border-cyan-200/15 bg-white/[0.04] p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold uppercase tracking-wide text-cyan-100">{job.mode}</span>
                        <span className={statusTone(job.status)}>{job.status}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-slate-200/90">{job.prompt}</p>

                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-300/85">
                          <span>{progress}%</span>
                        </div>
                        <PremiumProgressBar progress={progress} status={barStatus} className="h-3" />
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300/85">
                        <span>Queue: {job.delayTimeMs !== null ? `${job.delayTimeMs}ms` : "-"}</span>
                        <span>Exec: {job.executionTimeMs !== null ? `${job.executionTimeMs}ms` : "-"}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="studio-stagger rounded-3xl border border-white/10 bg-slate-950/55 p-5 backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Library</h2>
              <p className="text-sm text-cyan-100/75">Playable + downloadable media from completed jobs</p>
            </div>
            {library.length === 0 ? <p className="text-sm text-slate-300/80">No completed outputs yet.</p> : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {library.map((item) => (
                <article key={item.id} className="curtain-plane rounded-2xl border border-cyan-200/20 bg-slate-900/75 p-3">
                  <div className="mb-3 overflow-hidden rounded-xl border border-white/10">
                    {item.kind === "video" ? (
                      <video
                        src={item.playUrl}
                        controls
                        playsInline
                        preload="none"
                        className="h-56 w-full object-cover"
                        onPlay={(e) => {
                          // Pause all other videos in this section
                          const current = e.currentTarget;
                          document.querySelectorAll<HTMLVideoElement>(".studio-stagger video").forEach((v) => {
                            if (v !== current) v.pause();
                          });
                        }}
                      />
                    ) : (
                      <Image
                        src={item.playUrl}
                        alt={item.prompt}
                        width={720}
                        height={480}
                        unoptimized
                        className="h-56 w-full object-cover"
                      />
                    )}
                  </div>
                  <p className="line-clamp-2 text-sm text-slate-100">{item.prompt}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-cyan-100/80">{item.model}</p>
                  <InteractiveButton
                    onClick={() => downloadFile(item.downloadUrl)}
                    className="mt-3"
                  >
                    Download
                  </InteractiveButton>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </VFXProvider>
  );
}
