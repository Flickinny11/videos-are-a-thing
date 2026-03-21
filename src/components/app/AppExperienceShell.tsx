"use client";

import { ReactNode, useEffect, useState } from "react";

import { EffectsErrorBoundary } from "@/components/app/EffectsErrorBoundary";
import { ExtensionNoiseGuard } from "@/components/app/ExtensionNoiseGuard";

import { AppTopNav } from "./AppTopNav";

interface Props {
  userEmail: string;
  children: ReactNode;
}

/**
 * Lazily loads heavy WebGL effect components so that a failure in any
 * of them never takes down the page. Each effect is individually
 * wrapped in an EffectsErrorBoundary.
 */
function EffectsLayer() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Defer effect initialisation to after first paint so the main
    // content is visible before WebGL contexts spin up.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!mounted) return null;

  // Dynamic imports so a single broken effect can't prevent the
  // module from loading at all.
  const OglNebulaBackground = require("@/components/effects/OglNebulaBackground").OglNebulaBackground;
  const CurtainsLayer = require("@/components/effects/CurtainsLayer").CurtainsLayer;
  const LenisProvider = require("@/components/effects/LenisProvider").LenisProvider;

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
