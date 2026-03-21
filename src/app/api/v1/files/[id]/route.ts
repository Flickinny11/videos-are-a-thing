import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { supabaseService } from "@/lib/supabase/service";

/**
 * GET /api/v1/files/:path
 *
 * Get a fresh signed URL for a file in inputs-private storage.
 * The :path parameter is the storage path (URL-encoded if it contains slashes).
 *
 * Usage: GET /api/v1/files/{userId}/{category}/{filename}
 *
 * This is a catch-all route that reconstructs the full path.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;

    // The "id" here is a path segment. For full paths with slashes,
    // pass the path as a query param instead.
    const url = new URL(request.url);
    const storagePath = url.searchParams.get("path") || id;

    // Security: ensure user can only access their own files
    if (!storagePath.startsWith(`${user.id}/`)) {
      return NextResponse.json(
        { success: false, message: "Access denied." },
        { status: 403 },
      );
    }

    const signed = await supabaseService.storage
      .from("inputs-private")
      .createSignedUrl(storagePath, 60 * 60);

    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json(
        { success: false, message: signed.error?.message || "File not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      file: {
        path: storagePath,
        signedUrl: signed.data.signedUrl,
        expiresInSeconds: 3600,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json(
      { success: false, message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

/**
 * DELETE /api/v1/files/:id
 *
 * Delete a file from inputs-private storage.
 * Pass the full path as ?path= query param.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;

    const url = new URL(request.url);
    const storagePath = url.searchParams.get("path") || id;

    if (!storagePath.startsWith(`${user.id}/`)) {
      return NextResponse.json(
        { success: false, message: "Access denied." },
        { status: 403 },
      );
    }

    const { error } = await supabaseService.storage
      .from("inputs-private")
      .remove([storagePath]);

    if (error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      removedPath: storagePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json(
      { success: false, message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
