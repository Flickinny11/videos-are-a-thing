import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { supabaseService } from "@/lib/supabase/service";

const BUCKET = "inputs-private";

const ALLOWED_EXTENSIONS = new Set([
  // Images
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "tif", "svg",
  // Video
  "mp4", "webm", "mov", "m4v", "avi", "mkv",
  // 3D models
  "glb", "gltf", "obj", "stl", "fbx", "usdz", "usdc", "usd",
  "step", "stp", "3mf", "ply", "abc", "dae", "3ds",
  // Archives (for bundled 3D assets)
  "zip", "tar", "gz",
  // Textures / HDR
  "hdr", "exr",
  // Generic binary
  "bin",
]);

const inferCategory = (ext: string): string => {
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "tif", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "m4v", "avi", "mkv"].includes(ext)) return "video";
  if (["glb", "gltf", "obj", "stl", "fbx", "usdz", "usdc", "usd", "step", "stp", "3mf", "ply", "abc", "dae", "3ds"].includes(ext)) return "3d";
  return "other";
};

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

const resolveContentType = (declared: string, ext: string): string => {
  const t = (declared || "").trim().toLowerCase();
  if (t && t !== "application/octet-stream" && t !== "binary/octet-stream") {
    if (t === "image/jpg" || t === "image/x-png") return EXT_MIME[ext] || "image/png";
    return t;
  }
  return EXT_MIME[ext] || "application/octet-stream";
};

/**
 * POST /api/v1/upload
 *
 * Upload a file to the inputs-private bucket.
 * Returns the storage path and a time-limited signed URL.
 *
 * Supports images, videos, 3D models, textures, and archives.
 * Send as multipart/form-data with a "file" field.
 *
 * Optional form field "category" to override inferred category.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "A file field is required (multipart/form-data)." },
        { status: 400 },
      );
    }

    const extension = (file.name.split(".").pop() || "bin").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { success: false, message: `File extension .${extension} is not supported.` },
        { status: 400 },
      );
    }

    const category = String(formData.get("category") || inferCategory(extension));
    const filename = `${Date.now()}-${nanoid(8)}.${extension}`;
    const path = `${user.id}/${category}/${filename}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = resolveContentType(file.type, extension);
    const { error: uploadError } = await supabaseService.storage
      .from(BUCKET)
      .upload(path, bytes, {
        upsert: false,
        contentType,
      });

    if (uploadError) {
      return NextResponse.json(
        { success: false, message: uploadError.message },
        { status: 500 },
      );
    }

    const signed = await supabaseService.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60);

    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json(
        { success: false, message: signed.error?.message || "Could not create signed URL." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      file: {
        path,
        category,
        extension,
        originalName: file.name,
        sizeBytes: bytes.byteLength,
        mimeType: contentType,
        signedUrl: signed.data.signedUrl,
        expiresInSeconds: 3600,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
