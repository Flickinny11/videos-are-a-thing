export type MediaKind = "image" | "video";

export type JobMode =
  | "video:t2v"
  | "video:i2v"
  | "video:fal-i2v"
  | "video:fal-i2v-2.7"
  | "video:fal-r2v-2.7"
  | "video:fal-cosmos3-i2v"
  | "video:hh-t2v"
  | "video:hh-i2v"
  | "video:hh-r2v"
  | "video:hh-edit"
  | "video:ltx-t2v"
  | "video:ltx-t2v-fast"
  | "video:ltx-i2v"
  | "video:ltx-i2v-fast"
  | "video:ltx-a2v"
  | "video:ltx-extend"
  | "video:ltx-retake"
  | "video:ltx-q-t2v"
  | "video:ltx-q-i2v"
  | "video:ltx-q-a2v"
  | "video:atlas-seedance-i2v"
  | "video:atlas-seedance-fast-i2v"
  | "video:atlas-seedance-r2v"
  | "video:atlas-seedance-fast-r2v"
  | "video:atlas-seedance-t2v"
  | "video:atlas-seedance-fast-t2v"
  | "image:flux"
  | "image:flux-dev"
  | "image:flux-schnell"
  | "image:qwen-t2i"
  | "image:qwen"
  | "image:qwen-2511"
  | "image:p-edit"
  | "image:seedream-edit"
  | "image:nano-banana"
  | "image:z-turbo"
  | "image:fal-edit-2.7"
  | "image:fal-pro-edit-2.7"
  | "image:fal-t2i-2.7"
  | "image:fal-pro-t2i-2.7"
  | "image:fal-seedream-edit-4.5"
  | "image:fal-qwen-angles"
  | "image:fal-flux2-angles";

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
  jobId: string;
  mode: JobMode | null;
  kind: MediaKind;
  playUrl: string;
  downloadUrl: string;
  createdAt: string;
  prompt: string;
  model: string;
  mimeType: string | null;
}
