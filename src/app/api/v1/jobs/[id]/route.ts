import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getUserJob, mapJobRowToResponse } from "@/lib/jobs";

/**
 * GET /api/v1/jobs/:id
 *
 * Get a single job by ID.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const row = await getUserJob(user.id, id);

    return NextResponse.json({
      success: true,
      job: mapJobRowToResponse(row),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Not found";
    return NextResponse.json(
      { success: false, message },
      { status: message === "Job not found." ? 404 : 401 },
    );
  }
}
