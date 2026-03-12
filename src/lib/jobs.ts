import { nanoid } from "nanoid";

import { supabaseService } from "@/lib/supabase/service";
import type { JobMode, JobRecord, JobResponse, JobStatus, LibraryItem, MediaKind, MediaRecord } from "@/types/app";

export const mapJobRowToResponse = (row: JobRecord): JobResponse => ({
  id: row.id,
  status: row.status,
  model: row.model,
  mode: row.mode,
  progressPercent: row.progress_percent,
  delayTimeMs: row.delay_time_ms,
  executionTimeMs: row.execution_time_ms,
  errorReason: row.error_reason,
  outputMediaId: row.output_media_id,
  runpodJobId: row.runpod_job_id,
  prompt: row.prompt,
  createdAt: row.created_at,
});

export const createJobEvent = async (
  userId: string,
  jobId: string,
  status: JobStatus,
  message: string,
  raw?: Record<string, unknown>,
) => {
  await supabaseService.from("job_events").insert({
    user_id: userId,
    job_id: jobId,
    status,
    message,
    raw: raw || null,
  });
};

export const createGenerationJob = async (input: {
  userId: string;
  mode: JobMode;
  model: string;
  prompt: string;
  durationSeconds: number | null;
  inputMediaPath: string | null;
  runpodJobId: string;
  initialStatus: JobStatus;
  runpodRaw: Record<string, unknown>;
}) => {
  const { data, error } = await supabaseService
    .from("generation_jobs")
    .insert({
      user_id: input.userId,
      mode: input.mode,
      model: input.model,
      prompt: input.prompt,
      duration_seconds: input.durationSeconds,
      input_media_path: input.inputMediaPath,
      runpod_job_id: input.runpodJobId,
      status: input.initialStatus,
      runpod_raw: input.runpodRaw,
    })
    .select("*")
    .single<JobRecord>();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create generation job.");
  }

  return data;
};

export const listUserJobs = async (userId: string) => {
  const { data, error } = await supabaseService
    .from("generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<JobRecord[]>();

  if (error) throw new Error(error.message);
  return data || [];
};

export const getUserJob = async (userId: string, jobId: string) => {
  const { data, error } = await supabaseService
    .from("generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("id", jobId)
    .single<JobRecord>();

  if (error || !data) {
    throw new Error("Job not found.");
  }

  return data;
};

export const updateJobStatus = async (input: {
  jobId: string;
  status: JobStatus;
  progressPercent: number | null;
  delayTimeMs: number | null;
  executionTimeMs: number | null;
  errorReason: string | null;
  runpodRaw: Record<string, unknown>;
  outputMediaId?: string | null;
}) => {
  const patch: Record<string, unknown> = {
    status: input.status,
    progress_percent: input.progressPercent,
    delay_time_ms: input.delayTimeMs,
    execution_time_ms: input.executionTimeMs,
    error_reason: input.errorReason,
    runpod_raw: input.runpodRaw,
  };

  if (input.outputMediaId !== undefined) {
    patch.output_media_id = input.outputMediaId;
  }

  const { data, error } = await supabaseService
    .from("generation_jobs")
    .update(patch)
    .eq("id", input.jobId)
    .select("*")
    .single<JobRecord>();

  if (error || !data) throw new Error(error?.message || "Failed to update job.");
  return data;
};

export const createMediaAsset = async (input: {
  userId: string;
  jobId: string;
  kind: MediaKind;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  prompt: string;
  model: string;
  meta?: Record<string, unknown>;
}) => {
  const { data, error } = await supabaseService
    .from("media_assets")
    .insert({
      user_id: input.userId,
      job_id: input.jobId,
      kind: input.kind,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      prompt: input.prompt,
      model: input.model,
      meta: input.meta || null,
    })
    .select("*")
    .single<MediaRecord>();

  if (error || !data) throw new Error(error?.message || "Failed to create media asset.");
  return data;
};

export const saveUploadedInput = async (input: {
  userId: string;
  file: File;
}) => {
  const extension = input.file.name.split(".").pop() || "bin";
  const filename = `${Date.now()}-${nanoid(8)}.${extension}`;
  const path = `${input.userId}/${filename}`;

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const { error } = await supabaseService.storage
    .from("inputs-private")
    .upload(path, bytes, {
      upsert: false,
      contentType: input.file.type || "application/octet-stream",
    });

  if (error) throw new Error(error.message);

  const signed = await supabaseService.storage
    .from("inputs-private")
    .createSignedUrl(path, 60 * 30);

  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error?.message || "Could not create signed input URL.");
  }

  return {
    path,
    signedUrl: signed.data.signedUrl,
  };
};

export const persistRemoteMediaToStorage = async (input: {
  userId: string;
  jobId: string;
  remoteUrl: string;
  kind: MediaKind;
}) => {
  const response = await fetch(input.remoteUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download generated media from RunPod (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || (input.kind === "video" ? "video/mp4" : "image/png");
  const inferredExt = contentType.includes("video") ? "mp4" : contentType.includes("webp") ? "webp" : contentType.includes("jpeg") ? "jpg" : "png";
  const path = `${input.userId}/${input.jobId}/output-${nanoid(6)}.${inferredExt}`;

  const { error } = await supabaseService.storage
    .from("media-library")
    .upload(path, Buffer.from(arrayBuffer), {
      upsert: true,
      contentType,
    });

  if (error) throw new Error(error.message);

  return {
    path,
    sizeBytes: arrayBuffer.byteLength,
    mimeType: contentType,
  };
};

export const getUserLibrary = async (userId: string): Promise<LibraryItem[]> => {
  const { data, error } = await supabaseService
    .from("media_assets")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<MediaRecord[]>();

  if (error) throw new Error(error.message);

  const rows = data || [];

  const items = await Promise.all(
    rows.map(async (row) => {
      const signed = await supabaseService.storage
        .from("media-library")
        .createSignedUrl(row.storage_path, 60 * 60);

      if (signed.error || !signed.data?.signedUrl) {
        throw new Error(signed.error?.message || "Could not create signed playback URL.");
      }

      return {
        id: row.id,
        kind: row.kind,
        playUrl: signed.data.signedUrl,
        downloadUrl: signed.data.signedUrl,
        createdAt: row.created_at,
        prompt: row.prompt,
        model: row.model,
        mimeType: row.mime_type,
      } satisfies LibraryItem;
    }),
  );

  return items;
};
