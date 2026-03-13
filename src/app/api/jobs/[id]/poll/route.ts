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

  const httpStatus =
    typeof parsedRaw.httpStatus === "number" && Number.isFinite(parsedRaw.httpStatus)
      ? parsedRaw.httpStatus
      : null;

  const parsedMessageCandidates = [parsedRaw.error, parsedRaw.message];
  const parsedMessage = parsedMessageCandidates.find((value) => typeof value === "string");

  return {
    httpStatus,
    message:
      typeof parsedMessage === "string" && parsedMessage.trim().length
        ? parsedMessage
        : error.message || "Polling failed.",
    raw: parsedRaw,
  };
};

const isTerminalRunpodPollError = (input: ParsedPollError): boolean => {
  if (input.httpStatus === 404) return true;

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

    let runpod;
    try {
      runpod = await getRunpodJobStatus(current.mode, current.runpod_job_id);
    } catch (error) {
      const parsed = parsePollError(error);

      if (isTerminalRunpodPollError(parsed)) {
        const updated = await updateJobStatus({
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
          job: mapJobRowToResponse(updated),
        });
      }

      throw error;
    }

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
