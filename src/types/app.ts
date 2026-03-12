export type MediaKind = "image" | "video";

export type JobMode = "video:t2v" | "video:i2v" | "image:flux" | "image:qwen";

export type JobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "RETRY"
  | "THROTTLED";

export interface JobRecord {
  id: string;
  user_id: string;
  mode: JobMode;
  model: string;
  prompt: string;
  duration_seconds: number | null;
  input_media_path: string | null;
  runpod_job_id: string;
  status: JobStatus;
  progress_percent: number | null;
  delay_time_ms: number | null;
  execution_time_ms: number | null;
  error_reason: string | null;
  runpod_raw: Record<string, unknown> | null;
  output_media_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaRecord {
  id: string;
  user_id: string;
  job_id: string;
  kind: MediaKind;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  prompt: string;
  model: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface JobResponse {
  id: string;
  status: JobStatus;
  model: string;
  mode: JobMode;
  progressPercent: number | null;
  delayTimeMs: number | null;
  executionTimeMs: number | null;
  errorReason: string | null;
  outputMediaId: string | null;
  runpodJobId: string;
  prompt: string;
  createdAt: string;
}

export interface LibraryItem {
  id: string;
  kind: MediaKind;
  playUrl: string;
  downloadUrl: string;
  createdAt: string;
  prompt: string;
  model: string;
  mimeType: string | null;
}
