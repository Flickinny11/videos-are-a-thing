"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EffectsErrorBoundary } from "@/components/app/EffectsErrorBoundary";
import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { PremiumProgressBar } from "@/components/effects/PremiumProgressBar";
import { RapierFloatField } from "@/components/effects/RapierFloatField";
import { formatDurationMs, getRealtimeProgressPercent, isActiveJob } from "@/lib/job-progress";
import type { JobResponse } from "@/types/app";

const statusTone = (status: string) => {
  if (status === "COMPLETED") return "text-emerald-300";
  if (status === "FAILED" || status === "TIMED_OUT" || status === "CANCELLED") return "text-rose-300";
  if (status === "IN_PROGRESS") return "text-cyan-100";
  return "text-sky-100";
};

const progressBarStatus = (status: string): "active" | "completed" | "failed" => {
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED" || status === "TIMED_OUT" || status === "CANCELLED") return "failed";
  return "active";
};

export function QueueView() {
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pollTimerRef = useRef<number>(0);
  const mountedRef = useRef(true);

  const activeJobs = useMemo(() => jobs.filter((job) => isActiveJob(job.status)), [jobs]);
  const hasActive = activeJobs.length > 0;

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Failed to load queue");
      if (mountedRef.current) {
        setJobs(data.jobs || []);
        setError("");
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load queue");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const pollingRef = useRef(false);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  // Poll active jobs for real RunPod progress, then merge updates
  const pollActiveJobs = useCallback(async () => {
    if (pollingRef.current || !mountedRef.current) return;
    pollingRef.current = true;

    try {
      const currentJobs = jobsRef.current;
      const active = currentJobs.filter((job) => isActiveJob(job.status));

      if (!active.length) {
        await fetchJobs();
        return;
      }

      const settled = await Promise.allSettled(
        active.map(async (job) => {
          const response = await fetch(`/api/jobs/${job.id}/poll`, { method: "POST", cache: "no-store" });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.success) return null;
          return data.job as JobResponse;
        }),
      );

      if (!mountedRef.current) return;

      const successes = settled
        .filter((item): item is PromiseFulfilledResult<JobResponse | null> => item.status === "fulfilled")
        .map((item) => item.value)
        .filter((v): v is JobResponse => v !== null);

      if (successes.length) {
        const patch = new Map(successes.map((job) => [job.id, job]));
        setJobs((current) => current.map((job) => patch.get(job.id) || job));
      }

      // If any jobs just completed, do a full refresh to pick up new library items
      const justCompleted = successes.some(
        (s) => s.status === "COMPLETED" && active.find((a) => a.id === s.id)?.status !== "COMPLETED",
      );
      if (justCompleted) {
        await fetchJobs();
      }
    } finally {
      pollingRef.current = false;
    }
  }, [fetchJobs]);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    void fetchJobs();
    return () => { mountedRef.current = false; };
  }, [fetchJobs]);

  // Auto-poll: 3s when jobs are in-progress, 6s when queued, 15s when idle.
  useEffect(() => {
    const getPollInterval = () => {
      if (!hasActive) return 15000;
      const inProgress = activeJobs.some((j) => j.status === "IN_PROGRESS");
      return inProgress ? 3000 : 6000;
    };

    const tick = async () => {
      if (!mountedRef.current) return;
      await pollActiveJobs();
      if (mountedRef.current) {
        pollTimerRef.current = window.setTimeout(tick, getPollInterval());
      }
    };

    pollTimerRef.current = window.setTimeout(tick, getPollInterval());
    return () => window.clearTimeout(pollTimerRef.current);
  }, [hasActive, pollActiveJobs]);

  return (
    <section className="space-y-6">
      <article className="relative isolate overflow-hidden rounded-[2.1rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        <EffectsErrorBoundary>
          <OglLiquidRibbon className="pointer-events-none absolute inset-0 opacity-70" />
        </EffectsErrorBoundary>
        <EffectsErrorBoundary>
          <RapierFloatField className="pointer-events-none absolute inset-0 opacity-45" count={12} />
        </EffectsErrorBoundary>
        <div className="relative z-10">
          <h2 className="text-2xl font-semibold md:text-4xl">
            Generation Queue
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-cyan-100/80">
            Jobs are polled automatically. Progress updates come directly from RunPod in real time.
          </p>
          {hasActive ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-100/35 bg-cyan-200/10 px-3 py-1 text-[11px] uppercase tracking-[0.15em] text-cyan-100/75">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              {activeJobs.length} active {activeJobs.length === 1 ? "job" : "jobs"} — polling every {activeJobs.some((j) => j.status === "IN_PROGRESS") ? "3" : "6"}s
            </div>
          ) : null}
        </div>
      </article>

      <article className="rounded-[2.1rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        <h3 className="mb-4 text-xl font-semibold">Jobs</h3>

        {loading ? <p className="text-sm text-cyan-100/70">Loading queue...</p> : null}
        {!loading && jobs.length === 0 ? <p className="text-sm text-cyan-100/70">No jobs yet.</p> : null}
        {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {jobs.map((job) => {
            const progress = getRealtimeProgressPercent(job);

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

                  <PremiumProgressBar
                    progress={progress}
                    status={progressBarStatus(job.status)}
                    className="h-4"
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-cyan-100/80">
                  <span>Queue: {formatDurationMs(job.delayTimeMs)}</span>
                  <span>Exec: {formatDurationMs(job.executionTimeMs)}</span>
                </div>
                {job.errorReason ? (
                  <p className="mt-2 text-xs text-rose-300/90 truncate">{job.errorReason}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      </article>
    </section>
  );
}
