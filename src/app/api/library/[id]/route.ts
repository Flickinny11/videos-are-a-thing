import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createJobEvent, deleteUserMediaAsset } from "@/lib/jobs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;

    const removed = await deleteUserMediaAsset(user.id, id);
    await createJobEvent(user.id, removed.job_id, "COMPLETED", "Media deleted from library.", {
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

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status },
    );
  }
}
