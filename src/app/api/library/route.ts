import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getUserLibrary } from "@/lib/jobs";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const items = await getUserLibrary(user.id);

    return NextResponse.json({
      success: true,
      items,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unauthorized",
      },
      { status: 401 },
    );
  }
}
