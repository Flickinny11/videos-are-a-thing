import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";

/**
 * GET /api/v1/services
 *
 * Lists all available generation services with their capabilities.
 * Useful for programmatic clients to discover what's available.
 */
export async function GET(request: Request) {
  try {
    await requireUser(request);

    return NextResponse.json({
      success: true,
      services: [
        {
          id: "video:t2v",
          name: "Wan 2.6 Text-to-Video",
          endpoint: "wan-2-6-t2v",
          type: "video",
          inputType: "text",
          requiresImage: false,
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
            duration: { type: "number", options: [5, 10, 15], default: 5 },
            resolution: { type: "string", options: ["720p", "1080p"], default: "720p" },
          },
        },
        {
          id: "video:i2v",
          name: "Wan 2.6 Image-to-Video",
          endpoint: "wan-2-6-i2v",
          type: "video",
          inputType: "image",
          requiresImage: true,
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
            duration: { type: "number", options: [5, 10, 15], default: 5 },
            resolution: { type: "string", options: ["720p", "1080p"], default: "720p" },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
        {
          id: "image:flux",
          name: "Flux 1 Kontext Dev",
          endpoint: "black-forest-labs-flux-1-kontext-dev",
          type: "image",
          inputType: "image",
          requiresImage: true,
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
        {
          id: "image:qwen",
          name: "Qwen Image Edit",
          endpoint: "qwen-image-edit",
          type: "image",
          inputType: "image",
          requiresImage: true,
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
      ],
      supportedFileTypes: {
        image: ["image/png", "image/jpeg", "image/webp", "image/gif"],
        video: ["video/mp4", "video/webm", "video/mov"],
        "3d": [
          "model/gltf-binary",
          "model/gltf+json",
          "application/octet-stream",
          "model/obj",
          "model/stl",
          "model/fbx",
          "model/usdz",
          "model/step",
          "model/3mf",
        ],
      },
      supportedFileExtensions: {
        image: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
        video: [".mp4", ".webm", ".mov", ".m4v"],
        "3d": [".glb", ".gltf", ".obj", ".stl", ".fbx", ".usdz", ".usdc", ".usd", ".step", ".stp", ".3mf", ".ply", ".abc"],
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
}
