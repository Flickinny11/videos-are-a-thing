import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { listUserJobs, mapJobRowToResponse } from "@/lib/jobs";

/**
 * GET /api/v1/jobs
 *
 * List all jobs for the authenticated user.
 * Supports optional query params:
 * - status: filter by status (e.g. ?status=COMPLETED)
 * - mode: filter by mode (e.g. ?mode=video:t2v)
 * - limit: max results (default 50)
 * - offset: pagination offset (default 0)
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status")?.toUpperCase();
    const modeFilter = url.searchParams.get("mode");
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

    let rows = await listUserJobs(user.id);

    if (statusFilter) {
      rows = rows.filter((row) => row.status === statusFilter);
    }
    if (modeFilter) {
      rows = rows.filter((row) => row.mode === modeFilter);
    }

    const total = rows.length;
    const paged = rows.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      total,
      limit,
      offset,
      jobs: paged.map(mapJobRowToResponse),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
