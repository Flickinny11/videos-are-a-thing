import type { JobResponse } from "@/types/app";

const TERMINAL_FAILURE = new Set(["FAILED", "TIMED_OUT", "CANCELLED"]);

export const isActiveJob = (status: string) =>
  status === "IN_QUEUE" || status === "IN_PROGRESS" || status === "RETRY" || status === "THROTTLED";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const getRealtimeProgressPercent = (job: JobResponse): number => {
  if (typeof job.progressPercent === "number") {
    return clamp(Math.round(job.progressPercent), 0, 100);
  }

  if (job.status === "COMPLETED") return 100;
  if (TERMINAL_FAILURE.has(job.status)) return 100;

  // Timing-derived fallback when endpoint doesn't expose direct progress%.
  if (job.status === "IN_QUEUE" || job.status === "RETRY" || job.status === "THROTTLED") {
    const queueMs = Math.max(0, job.delayTimeMs || 0);
    return clamp(8 + Math.round(queueMs / 820), 8, 38);
  }

  if (job.status === "IN_PROGRESS") {
    const execMs = Math.max(0, job.executionTimeMs || 0);
    return clamp(42 + Math.round(execMs / 740), 42, 96);
  }

  return 0;
};

export const getAdaptivePollMs = (jobs: JobResponse[], failureStreak: number): number => {
  const active = jobs.filter((job) => isActiveJob(job.status));
  if (!active.length) return 9000;

  const inProgress = active.some((job) => job.status === "IN_PROGRESS");
  const queueOnly = active.every((job) => job.status === "IN_QUEUE" || job.status === "RETRY" || job.status === "THROTTLED");

  let base = 7000;
  if (inProgress) base = 4500;
  if (queueOnly) base = 8200;
  if (active.length >= 4) base += 1800;
  if (active.length >= 8) base += 2400;

  const backoff = Math.min(failureStreak * 2300, 22000);
  const jitter = Math.round(Math.random() * 700);

  return base + backoff + jitter;
};

export const formatDurationMs = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
};
