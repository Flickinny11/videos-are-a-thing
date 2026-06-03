import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { atlasMediaKind, getAtlasJobStatus, isAtlasMode } from "@/lib/atlas";
import { falMediaKind, getFalJobStatus, isFalMode } from "@/lib/fal";
import {
  createJobEvent,
  createMediaAsset,
  getUserJob,
  mapJobRowToResponse,
  persistRemoteMediaToStorage,
  updateJobStatus,
} from "@/lib/jobs";
import { extractMediaUrlFromOutput, getRunpodJobStatus } from "@/lib/runpod";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);

interface ParsedPollError {
  httpStatus: number | null;
  message: string;
  raw: Record<string, unknown>;
}

const parsePollError = (error: unknown): ParsedPollError => {
  if (!(error instanceof Error)) {
    return {
      httpStatus: null,
      message: "Polling failed.",
      raw: {},
    };
  }

  let parsedRaw: Record<string, unknown> = {};
  try {
    const maybe = JSON.parse(error.message) as unknown;
    if (maybe && typeof maybe === "object" && !Array.isArray(maybe)) {
      parsedRaw = maybe as Record<string, unknown>;
    }
  } catch {
    parsedRaw = {};
  }

  // Provider error classes (FalError / AtlasError / RunpodError) carry the real
  // HTTP status on the thrown object itself — prefer that over whatever happens
  // to be embedded in the (often empty) message body, so a "request expired"
  // 404/4xx is actually recognizable instead of being lost.
  const errObj = error as unknown as { httpStatus?: unknown };
  const errorHttpStatus =
    typeof errObj.httpStatus === "number" && Number.isFinite(errObj.httpStatus)
      ? errObj.httpStatus
      : null;

  const httpStatus =
    errorHttpStatus ??
    (typeof parsedRaw.httpStatus === "number" && Number.isFinite(parsedRaw.httpStatus)
      ? parsedRaw.httpStatus
      : null);

  const parsedMessageCandidates = [parsedRaw.error, parsedRaw.message];
  const parsedMessage = parsedMessageCandidates.find((value) => typeof value === "string");

  const rawMessage =
    typeof parsedMessage === "string" && parsedMessage.trim().length
      ? parsedMessage
      : error.message || "Polling failed.";
  // An empty provider body ("{}" / whitespace) is unhelpful in the UI; surface
  // the status instead.
  const message =
    rawMessage.replace(/[{}\s]/g, "").length === 0 && httpStatus !== null
      ? `Provider returned HTTP ${httpStatus} for this request (it may have expired or been removed).`
      : rawMessage;

  return { httpStatus, message, raw: parsedRaw };
};

// A poll failure is terminal (mark the job FAILED, stop retrying) when the
// provider says the request is gone or invalid. Any non-transient 4xx on a
// status check means the request id is unknown/expired/unrecoverable — only
// 429 (rate limit) and 408 (timeout) are worth retrying among client errors;
// 5xx are transient and re-thrown for the next poll tick.
const isTerminalRunpodPollError = (input: ParsedPollError): boolean => {
  if (
    input.httpStatus !== null &&
    input.httpStatus >= 400 &&
    input.httpStatus < 500 &&
    input.httpStatus !== 429 &&
    input.httpStatus !== 408
  ) {
    return true;
  }

  const text = input.message.toLowerCase();
  return (
    text.includes("request does not exist") ||
    text.includes("job does not exist") ||
    text.includes("job not found") ||
    text.includes("request not found")
  );
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;

    const current = await getUserJob(user.id, id);

    if (TERMINAL.has(current.status)) {
      return NextResponse.json({
        success: true,
        job: mapJobRowToResponse(current),
      });
    }

    // Branch polling based on provider
    let updated;
    if (isAtlasMode(current.mode)) {
      // ── Atlas Cloud polling ──
      let atlasStatus;
      try {
        atlasStatus = await getAtlasJobStatus(current.mode, current.runpod_job_id);
      } catch (error) {
        const parsed = parsePollError(error);

        if (isTerminalRunpodPollError(parsed)) {
          const failedUpdate = await updateJobStatus({
            jobId: current.id,
            status: "FAILED",
            progressPercent: null,
            delayTimeMs: current.delay_time_ms,
            executionTimeMs: current.execution_time_ms,
            errorReason: parsed.message,
            runpodRaw: parsed.raw,
          });

          if (current.status !== "FAILED" || current.error_reason !== parsed.message) {
            await createJobEvent(user.id, current.id, "FAILED", `Atlas Cloud polling failed: ${parsed.message}`, parsed.raw);
          }

          return NextResponse.json({ success: true, job: mapJobRowToResponse(failedUpdate) });
        }

        throw error;
      }

      updated = await updateJobStatus({
        jobId: current.id,
        status: atlasStatus.status,
        progressPercent: atlasStatus.progress,
        delayTimeMs: current.delay_time_ms,
        executionTimeMs: current.execution_time_ms,
        errorReason: atlasStatus.error,
        runpodRaw: atlasStatus.raw,
      });

      if (updated.status !== current.status) {
        await createJobEvent(
          user.id, current.id, updated.status,
          atlasStatus.error || `Atlas Cloud status updated to ${updated.status}.`,
          atlasStatus.raw,
        );
      }

      if (updated.status === "COMPLETED" && !updated.output_media_id) {
        const mediaUrl = atlasStatus.mediaUrl;
        const kind = atlasMediaKind(current.mode);
        if (!mediaUrl) {
          updated = await updateJobStatus({
            jobId: current.id,
            status: "FAILED",
            progressPercent: null,
            delayTimeMs: current.delay_time_ms,
            executionTimeMs: current.execution_time_ms,
            errorReason: `Atlas Cloud completed but no downloadable ${kind} URL was found.`,
            runpodRaw: atlasStatus.raw,
          });
        } else {
          const persisted = await persistRemoteMediaToStorage({
            userId: user.id,
            jobId: current.id,
            remoteUrl: mediaUrl,
            kind,
          });

          const media = await createMediaAsset({
            userId: user.id,
            jobId: current.id,
            kind,
            storagePath: persisted.path,
            mimeType: persisted.mimeType,
            sizeBytes: persisted.sizeBytes,
            prompt: updated.prompt,
            model: updated.model,
            meta: {
              sourceUrl: mediaUrl,
              atlasPredictionId: updated.runpod_job_id,
              hasNsfwContents: atlasStatus.hasNsfw,
              provider: "atlas-cloud",
            },
          });

          updated = await updateJobStatus({
            jobId: current.id,
            status: "COMPLETED",
            progressPercent: 100,
            delayTimeMs: current.delay_time_ms,
            executionTimeMs: current.execution_time_ms,
            errorReason: null,
            runpodRaw: atlasStatus.raw,
            outputMediaId: media.id,
          });

          await createJobEvent(
            user.id, current.id, "COMPLETED",
            "Media downloaded from Atlas Cloud and saved to Supabase storage.",
            atlasStatus.raw,
          );
        }
      }
    } else if (isFalMode(current.mode)) {
      // ── fal.ai polling ──
      let falStatus;
      try {
        // Use the authoritative status_url/response_url fal returned at submit
        // (stored in runpod_raw, then threaded forward on every poll).
        const falRaw = (current.runpod_raw || {}) as Record<string, unknown>;
        falStatus = await getFalJobStatus(current.mode, current.runpod_job_id, {
          statusUrl: typeof falRaw.status_url === "string" ? falRaw.status_url : undefined,
          responseUrl: typeof falRaw.response_url === "string" ? falRaw.response_url : undefined,
        });
      } catch (error) {
        const parsed = parsePollError(error);

        if (isTerminalRunpodPollError(parsed)) {
          const failedUpdate = await updateJobStatus({
            jobId: current.id,
            status: "FAILED",
            progressPercent: null,
            delayTimeMs: current.delay_time_ms,
            executionTimeMs: current.execution_time_ms,
            errorReason: parsed.message,
            runpodRaw: parsed.raw,
          });

          if (current.status !== "FAILED" || current.error_reason !== parsed.message) {
            await createJobEvent(user.id, current.id, "FAILED", `fal.ai polling failed: ${parsed.message}`, parsed.raw);
          }

          return NextResponse.json({ success: true, job: mapJobRowToResponse(failedUpdate) });
        }

        throw error;
      }

      updated = await updateJobStatus({
        jobId: current.id,
        status: falStatus.status,
        progressPercent: falStatus.progress,
        delayTimeMs: current.delay_time_ms,
        executionTimeMs: current.execution_time_ms,
        errorReason: falStatus.error,
        runpodRaw: falStatus.raw,
      });

      if (updated.status !== current.status) {
        await createJobEvent(
          user.id, current.id, updated.status,
          falStatus.error || `fal.ai status updated to ${updated.status}.`,
          falStatus.raw,
        );
      }

      if (updated.status === "COMPLETED" && !updated.output_media_id) {
        const mediaUrl = falStatus.mediaUrl;
        const kind = falMediaKind(current.mode);
        if (!mediaUrl) {
          updated = await updateJobStatus({
            jobId: current.id,
            status: "FAILED",
            progressPercent: null,
            delayTimeMs: current.delay_time_ms,
            executionTimeMs: current.execution_time_ms,
            errorReason: `fal.ai completed but no downloadable ${kind} URL was found.`,
            runpodRaw: falStatus.raw,
          });
        } else {
          const persisted = await persistRemoteMediaToStorage({
            userId: user.id,
            jobId: current.id,
            remoteUrl: mediaUrl,
            kind,
          });

          const media = await createMediaAsset({
            userId: user.id,
            jobId: current.id,
            kind,
            storagePath: persisted.path,
            mimeType: persisted.mimeType,
            sizeBytes: persisted.sizeBytes,
            prompt: updated.prompt,
            model: updated.model,
            meta: {
              sourceUrl: mediaUrl,
              falRequestId: updated.runpod_job_id,
              seed: falStatus.seed,
            },
          });

          updated = await updateJobStatus({
            jobId: current.id,
            status: "COMPLETED",
            progressPercent: 100,
            delayTimeMs: current.delay_time_ms,
            executionTimeMs: current.execution_time_ms,
            errorReason: null,
            runpodRaw: falStatus.raw,
            outputMediaId: media.id,
          });

          await createJobEvent(
            user.id, current.id, "COMPLETED",
            "Media downloaded from fal.ai and saved to Supabase storage.",
            falStatus.raw,
          );
        }
      }
    } else {
      // ── RunPod polling ──
      let runpod;
      try {
        runpod = await getRunpodJobStatus(current.mode, current.runpod_job_id);
      } catch (error) {
        const parsed = parsePollError(error);

        if (isTerminalRunpodPollError(parsed)) {
          const failedUpdate = await updateJobStatus({
            jobId: current.id,
            status: "FAILED",
            progressPercent: null,
            delayTimeMs: current.delay_time_ms,
            executionTimeMs: current.execution_time_ms,
            errorReason: parsed.message,
            runpodRaw: parsed.raw,
          });

          if (current.status !== "FAILED" || current.error_reason !== parsed.message) {
            await createJobEvent(
              user.id,
              current.id,
              "FAILED",
              `RunPod polling failed: ${parsed.message}`,
              parsed.raw,
            );
          }

          return NextResponse.json({
            success: true,
            job: mapJobRowToResponse(failedUpdate),
          });
        }

        throw error;
      }

      updated = await updateJobStatus({
        jobId: current.id,
        status: runpod.status,
        progressPercent: runpod.progressPercent,
        delayTimeMs: runpod.delayTime,
        executionTimeMs: runpod.executionTime,
        errorReason: runpod.error,
        runpodRaw: runpod.raw,
      });

      if (updated.status !== current.status) {
        await createJobEvent(
          user.id,
          current.id,
          updated.status,
          runpod.error || `RunPod status updated to ${updated.status}.`,
          runpod.raw,
        );
      }

      if (updated.status === "COMPLETED" && !updated.output_media_id) {
        const kind = updated.mode.startsWith("video") ? "video" : "image";
        const url = extractMediaUrlFromOutput(runpod.output, kind);

        if (!url) {
          updated = await updateJobStatus({
            jobId: current.id,
            status: "FAILED",
            progressPercent: null,
            delayTimeMs: runpod.delayTime,
            executionTimeMs: runpod.executionTime,
            errorReason: "RunPod completed but no downloadable media URL was found.",
            runpodRaw: runpod.raw,
          });
        } else {
          const persisted = await persistRemoteMediaToStorage({
            userId: user.id,
            jobId: current.id,
            remoteUrl: url,
            kind,
          });

          const media = await createMediaAsset({
            userId: user.id,
            jobId: current.id,
            kind,
            storagePath: persisted.path,
            mimeType: persisted.mimeType,
            sizeBytes: persisted.sizeBytes,
            prompt: updated.prompt,
            model: updated.model,
            meta: {
              sourceUrl: url,
              runpodJobId: updated.runpod_job_id,
            },
          });

          updated = await updateJobStatus({
            jobId: current.id,
            status: "COMPLETED",
            progressPercent: runpod.progressPercent,
            delayTimeMs: runpod.delayTime,
            executionTimeMs: runpod.executionTime,
            errorReason: null,
            runpodRaw: runpod.raw,
            outputMediaId: media.id,
          });

          await createJobEvent(
            user.id,
            current.id,
            "COMPLETED",
            "Media downloaded from RunPod and saved to Supabase storage.",
            runpod.raw,
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      job: mapJobRowToResponse(updated),
    });
  } catch (error) {
    const parsed = parsePollError(error);
    const status =
      parsed.message === "Unauthorized"
        ? 401
        : parsed.message === "Job not found."
          ? 404
          : 500;

    return NextResponse.json(
      {
        success: false,
        message: parsed.message,
      },
      { status },
    );
  }
}
