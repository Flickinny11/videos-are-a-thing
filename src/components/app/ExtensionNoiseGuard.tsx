"use client";

import { useEffect } from "react";

const EXTENSION_CHANNEL_CLOSED = "A listener indicated an asynchronous response by returning true";
const EXTENSION_CHANNEL_CLOSED_ALT = "message channel closed before a response was received";

const isExtensionChannelCloseNoise = (value: unknown) => {
  const message =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "message" in value
        ? String((value as { message: unknown }).message)
        : "";

  if (!message) return false;
  return message.includes(EXTENSION_CHANNEL_CLOSED) || message.includes(EXTENSION_CHANNEL_CLOSED_ALT);
};

export function ExtensionNoiseGuard() {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isExtensionChannelCloseNoise(event.reason)) {
        event.preventDefault();
      }
    };

    const onError = (event: ErrorEvent) => {
      if (isExtensionChannelCloseNoise(event.error) || isExtensionChannelCloseNoise(event.message)) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
