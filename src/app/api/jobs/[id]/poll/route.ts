import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
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

    const runpod = await getRunpodJobStatus(current.mode, current.runpod_job_id);

    let updated = await updateJobStatus({
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

    return NextResponse.json({
      success: true,
      job: mapJobRowToResponse(updated),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Polling failed.";
    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 500 },
    );
  }
}
