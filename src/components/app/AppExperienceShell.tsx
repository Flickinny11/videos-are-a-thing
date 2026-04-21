"use client";

import dynamic from "next/dynamic";
import { ReactNode, useEffect, useState } from "react";

import { EffectsErrorBoundary } from "@/components/app/EffectsErrorBoundary";
import { ExtensionNoiseGuard } from "@/components/app/ExtensionNoiseGuard";

import { AppTopNav } from "./AppTopNav";

interface Props {
  userEmail: string;
  children: ReactNode;
}

// Lazy, client-only, per-effect dynamic imports so a single broken
// module never blocks the app shell from rendering. Each is still
// individually wrapped in an EffectsErrorBoundary below.
const OglNebulaBackground = dynamic(
  () => import("@/components/effects/OglNebulaBackground").then((m) => m.OglNebulaBackground),
  { ssr: false },
);
const CurtainsLayer = dynamic(
  () => import("@/components/effects/CurtainsLayer").then((m) => m.CurtainsLayer),
  { ssr: false },
);
const LenisProvider = dynamic(
  () => import("@/components/effects/LenisProvider").then((m) => m.LenisProvider),
  { ssr: false },
);

/**
 * Defers heavy WebGL effect mounting until after first paint and
 * isolates each effect behind its own error boundary.
 */
function EffectsLayer() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!mounted) return null;

  return (
    <>
      <EffectsErrorBoundary>
        <LenisProvider />
      </EffectsErrorBoundary>
      <EffectsErrorBoundary>
        <OglNebulaBackground />
      </EffectsErrorBoundary>
      <EffectsErrorBoundary>
        <CurtainsLayer />
      </EffectsErrorBoundary>
    </>
  );
}

export function AppExperienceShell({ userEmail, children }: Props) {
  return (
    <>
      <ExtensionNoiseGuard />
      <EffectsLayer />

      <div data-scroll-container className="relative min-h-screen overflow-x-clip px-4 pb-16 pt-6 text-slate-100 md:px-8">
        <div className="mx-auto max-w-7xl">
          <AppTopNav userEmail={userEmail} />
          <main>{children}</main>
        </div>
      </div>
    </>
  );
}
