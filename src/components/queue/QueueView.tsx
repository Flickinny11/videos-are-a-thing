"use client";

import { VFXSpan } from "react-vfx";
import { useCallback, useEffect, useMemo, useState } from "react";

import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { PostFxHalo } from "@/components/effects/PostFxHalo";
import { RapierFloatField } from "@/components/effects/RapierFloatField";
import { formatDurationMs, getAdaptivePollMs, getRealtimeProgressPercent, isActiveJob } from "@/lib/job-progress";
import type { JobResponse } from "@/types/app";

const statusTone = (status: string) => {
  if (status === "COMPLETED") return "text-emerald-300";
  if (status === "FAILED" || status === "TIMED_OUT" || status === "CANCELLED") return "text-rose-300";
  if (status === "IN_PROGRESS") return "text-cyan-100";
  return "text-sky-100";
};

const progressTrackTone = (status: string) => {
  if (status === "COMPLETED") return "from-emerald-300 to-emerald-500";
  if (status === "FAILED" || status === "TIMED_OUT" || status === "CANCELLED") return "from-rose-300 to-rose-500";
  return "from-cyan-300 via-blue-300 to-indigo-300";
};

export function QueueView() {
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [failureStreak, setFailureStreak] = useState(0);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);

  const activeJobs = useMemo(() => jobs.filter((job) => isActiveJob(job.status)), [jobs]);
  const nextPollMs = useMemo(() => getAdaptivePollMs(jobs, failureStreak), [jobs, failureStreak]);

  const fetchJobs = useCallback(async (suppressError = false) => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Failed to load queue");
      setJobs(data.jobs || []);
      if (!suppressError) setError("");
    } catch (err) {
      if (!suppressError) {
        setError(err instanceof Error ? err.message : "Failed to load queue");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const pollActiveJobs = useCallback(async () => {
    if (!activeJobs.length) return;

    const settled = await Promise.allSettled(
      activeJobs.map(async (job) => {
        const response = await fetch(`/api/jobs/${job.id}/poll`, { method: "POST", cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || `Poll failed (${response.status})`);
        }
        return data.job as JobResponse;
      }),
    );

    const successes = settled
      .filter((item): item is PromiseFulfilledResult<JobResponse> => item.status === "fulfilled")
      .map((item) => item.value);
    const failures = settled.length - successes.length;

    if (successes.length) {
      const patch = new Map(successes.map((job) => [job.id, job]));
      setJobs((current) => current.map((job) => patch.get(job.id) || job));
      setLastPolledAt(Date.now());
    }

    if (failures) {
      setFailureStreak((value) => Math.min(value + 1, 10));
      setError("Some queue polls failed. Polling cadence is backing off automatically.");
      await fetchJobs(true);
      return;
    }

    setFailureStreak(0);
    setError("");
    if (activeJobs.length > 4) {
      await fetchJobs(true);
    }
  }, [activeJobs, fetchJobs]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!activeJobs.length) return;
    const timer = window.setTimeout(() => {
      void pollActiveJobs();
    }, nextPollMs);

    return () => window.clearTimeout(timer);
  }, [activeJobs.length, pollActiveJobs, nextPollMs]);

  return (
    <section className="space-y-6">
      <article className="relative isolate overflow-hidden rounded-[2.1rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        <OglLiquidRibbon className="pointer-events-none absolute inset-0 opacity-70" />
        <RapierFloatField className="pointer-events-none absolute inset-0 opacity-45" count={12} />
        <div className="relative z-10 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <h2 className="text-2xl font-semibold md:text-4xl">
              <VFXSpan shader="rgbShift">Realtime Queue Reactor with Adaptive Polling</VFXSpan>
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-cyan-100/80">
              Polling cadence is adaptive to job state and failure streak to prevent over-polling while keeping status
              updates near realtime.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.15em] text-cyan-100/75">
              <span className="rounded-full border border-cyan-100/35 bg-cyan-200/10 px-3 py-1">
                Active Jobs: {activeJobs.length}
              </span>
              <span className="rounded-full border border-cyan-100/35 bg-cyan-200/10 px-3 py-1">
                Next Poll: {(nextPollMs / 1000).toFixed(1)}s
              </span>
              <span className="rounded-full border border-cyan-100/35 bg-cyan-200/10 px-3 py-1">
                Last Poll: {lastPolledAt ? new Date(lastPolledAt).toLocaleTimeString() : "-"}
              </span>
            </div>
          </div>
          <div className="rounded-3xl border border-cyan-100/20 bg-slate-900/45 p-3">
            <PostFxHalo />
          </div>
        </div>
      </article>

      <article className="rounded-[2.1rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold">Queue Stream</h3>
          <button
            type="button"
            onClick={() => void fetchJobs()}
            className="rounded-xl border border-cyan-100/40 bg-cyan-300/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/20"
          >
            Refresh
          </button>
        </div>

        {loading ? <p className="text-sm text-cyan-100/70">Loading queue...</p> : null}
        {!loading && jobs.length === 0 ? <p className="text-sm text-cyan-100/70">No jobs yet.</p> : null}
        {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {jobs.map((job) => {
            const progress = getRealtimeProgressPercent(job);
            const timingSource =
              job.progressPercent !== null ? "runpod-progress%" : isActiveJob(job.status) ? "timing-derived%" : "terminal";

            return (
              <article
                key={job.id}
                className="curtain-plane rounded-3xl border border-cyan-100/25 bg-slate-900/60 p-4 shadow-[0_20px_55px_rgba(8,47,73,0.35)]"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/70">{job.mode}</p>
                  <p className={`text-sm font-semibold ${statusTone(job.status)}`}>{job.status}</p>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-100">{job.prompt}</p>

                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.12em] text-cyan-50/80">
                    <span>Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-3 rounded-full border border-cyan-100/25 bg-slate-950/60 p-[2px]">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${progressTrackTone(job.status)}`}
                      style={{ width: `${Math.max(4, progress)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-cyan-100/65">{timingSource}</p>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-cyan-100/80">
                  <span>Queue: {formatDurationMs(job.delayTimeMs)}</span>
                  <span>Exec: {formatDurationMs(job.executionTimeMs)}</span>
                  <span className="truncate">RunPod: {job.runpodJobId}</span>
                  <span className="truncate">{job.errorReason ? `Reason: ${job.errorReason}` : "Reason: -"}</span>
                </div>
              </article>
            );
          })}
        </div>
      </article>
    </section>
  );
}
