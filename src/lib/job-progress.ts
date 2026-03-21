import type { JobResponse } from "@/types/app";

const TERMINAL_FAILURE = new Set(["FAILED", "TIMED_OUT", "CANCELLED"]);

export const isActiveJob = (status: string) =>
  status === "IN_QUEUE" || status === "IN_PROGRESS" || status === "RETRY" || status === "THROTTLED";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Returns the best available progress percentage for a job.
 *
 * Priority:
 * 1. Terminal states → 100%
 * 2. Real RunPod progress_update() percentage (from output field during IN_PROGRESS)
 * 3. Timing-based estimate as fallback only when RunPod hasn't reported progress
 */
export const getRealtimeProgressPercent = (job: JobResponse): number => {
  if (job.status === "COMPLETED") return 100;
  if (TERMINAL_FAILURE.has(job.status)) return 100;

  // Real RunPod progress — always preferred
  if (typeof job.progressPercent === "number" && job.progressPercent > 0) {
    return clamp(Math.round(job.progressPercent), 1, 99);
  }

  // Timing fallback when RunPod hasn't reported real progress
  if (job.status === "IN_QUEUE" || job.status === "RETRY" || job.status === "THROTTLED") {
    const queueMs = Math.max(0, job.delayTimeMs || 0);
    return clamp(5 + Math.round(queueMs / 1000), 5, 30);
  }

  if (job.status === "IN_PROGRESS") {
    const execMs = Math.max(0, job.executionTimeMs || 0);
    return clamp(35 + Math.round(execMs / 800), 35, 95);
  }

  return 0;
};

export const formatDurationMs = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
};
