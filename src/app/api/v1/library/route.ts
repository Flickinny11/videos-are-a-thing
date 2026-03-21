import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getUserLibrary } from "@/lib/jobs";

/**
 * GET /api/v1/library
 *
 * List all media assets for the authenticated user.
 * Supports optional query params:
 * - kind: filter by kind (image, video)
 * - limit: max results (default 50)
 * - offset: pagination offset (default 0)
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const kindFilter = url.searchParams.get("kind");
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

    let items = await getUserLibrary(user.id);

    if (kindFilter && (kindFilter === "image" || kindFilter === "video")) {
      items = items.filter((item) => item.kind === kindFilter);
    }

    const total = items.length;
    const paged = items.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      total,
      limit,
      offset,
      items: paged,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
