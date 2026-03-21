import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createJobEvent, deleteUserMediaAsset, getUserMediaAsset } from "@/lib/jobs";
import { supabaseService } from "@/lib/supabase/service";

/**
 * GET /api/v1/library/:id
 *
 * Get a single media asset with a fresh signed URL for download/playback.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const media = await getUserMediaAsset(user.id, id);

    const signed = await supabaseService.storage
      .from("media-library")
      .createSignedUrl(media.storage_path, 60 * 60);

    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error?.message || "Could not create signed URL.");
    }

    return NextResponse.json({
      success: true,
      item: {
        id: media.id,
        jobId: media.job_id,
        kind: media.kind,
        mimeType: media.mime_type,
        sizeBytes: media.size_bytes,
        prompt: media.prompt,
        model: media.model,
        createdAt: media.created_at,
        downloadUrl: signed.data.signedUrl,
        playUrl: signed.data.signedUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Not found";
    const status = message === "Media not found." ? 404 : message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}

/**
 * DELETE /api/v1/library/:id
 *
 * Delete a media asset from storage and database.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const removed = await deleteUserMediaAsset(user.id, id);

    await createJobEvent(user.id, removed.job_id, "COMPLETED", "Media deleted via programmatic API.", {
      mediaId: removed.id,
      storagePath: removed.storage_path,
    });

    return NextResponse.json({
      success: true,
      removedId: removed.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete media.";
    const status = message === "Media not found." ? 404 : message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
