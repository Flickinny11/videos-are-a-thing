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
          id: "video:fal-i2v",
          name: "Wan 2.6 Image-to-Video (fal.ai)",
          provider: "fal.ai",
          type: "video",
          inputType: "image",
          requiresImage: true,
          safetyFilter: "disabled",
          pricing: { "720p": "$0.10/sec", "1080p": "$0.15/sec" },
          parameters: {
            prompt: { type: "string", required: true, maxLength: 800 },
            negativePrompt: { type: "string", required: false, maxLength: 500 },
            duration: { type: "string", options: ["5", "10", "15"], default: "5" },
            resolution: { type: "string", options: ["720p", "1080p"], default: "1080p" },
            sourceFile: { type: "file", required: true, accept: "image/*" },
            audioFile: { type: "file", required: false, accept: "audio/wav,audio/mp3", maxSizeMB: 15 },
          },
        },
        {
          id: "image:flux",
          name: "Flux 1 Kontext Dev (image-to-image)",
          endpoint: "black-forest-labs-flux-1-kontext-dev",
          type: "image",
          inputType: "image",
          requiresImage: true,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
        {
          id: "image:flux-dev",
          name: "Flux 1 Dev (text-to-image, quality)",
          endpoint: "black-forest-labs-flux-1-dev",
          type: "image",
          inputType: "text",
          requiresImage: false,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
          },
        },
        {
          id: "image:flux-schnell",
          name: "Flux 1 Schnell (text-to-image, fast)",
          endpoint: "black-forest-labs-flux-1-schnell",
          type: "image",
          inputType: "text",
          requiresImage: false,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
          },
        },
        {
          id: "image:qwen-t2i",
          name: "Qwen Image (text-to-image)",
          endpoint: "qwen-image-t2i",
          type: "image",
          inputType: "text",
          requiresImage: false,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
          },
        },
        {
          id: "image:qwen",
          name: "Qwen Image Edit (image-to-image)",
          endpoint: "qwen-image-edit",
          type: "image",
          inputType: "image",
          requiresImage: true,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
            negativePrompt: { type: "string", required: false },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
        {
          id: "image:qwen-2511",
          name: "Qwen Image Edit 2511 (image-to-image)",
          endpoint: "qwen-image-edit-2511",
          type: "image",
          inputType: "image",
          requiresImage: true,
          safetyFilter: "none",
          parameters: {
            prompt: { type: "string", required: true },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
        {
          id: "image:p-edit",
          name: "P-Image Edit (image-to-image, $0.01)",
          endpoint: "p-image-edit",
          type: "image",
          inputType: "image",
          requiresImage: true,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
        {
          id: "image:seedream-edit",
          name: "Seedream 4.0 Edit (image-to-image)",
          endpoint: "seedream-v4-edit",
          type: "image",
          inputType: "image",
          requiresImage: true,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
        {
          id: "image:nano-banana",
          name: "Nano Banana Edit (image-to-image)",
          endpoint: "nano-banana-edit",
          type: "image",
          inputType: "image",
          requiresImage: true,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
            sourceFile: { type: "file", required: true, accept: "image/*" },
          },
        },
        {
          id: "image:z-turbo",
          name: "Z-Image Turbo (image-to-image)",
          endpoint: "z-image-turbo",
          type: "image",
          inputType: "image",
          requiresImage: true,
          safetyFilter: "disabled",
          parameters: {
            prompt: { type: "string", required: true },
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
