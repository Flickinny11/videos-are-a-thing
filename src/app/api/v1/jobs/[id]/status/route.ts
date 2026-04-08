import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
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

/**
 * POST /api/v1/jobs/:id/status
 *
 * Poll a job's status from the provider (RunPod or fal.ai) and update the local record.
 * If the job is COMPLETED and output hasn't been ingested yet,
 * it downloads the media and saves it to storage.
 *
 * Returns the updated job.
 */
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

    let updated;

    if (isFalMode(current.mode)) {
      // ── fal.ai polling ──
      let falStatus;
      try {
        falStatus = await getFalJobStatus(current.mode, current.runpod_job_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Polling failed.";
        return NextResponse.json(
          { success: false, message },
          { status: 502 },
        );
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
            "Media downloaded from fal.ai and saved to storage via programmatic API.",
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
        const message = error instanceof Error ? error.message : "Polling failed.";
        return NextResponse.json(
          { success: false, message },
          { status: 502 },
        );
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
            meta: { sourceUrl: url, runpodJobId: updated.runpod_job_id },
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
            "Media downloaded and saved to storage via programmatic API.",
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
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message === "Unauthorized" ? 401 : message === "Job not found." ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
