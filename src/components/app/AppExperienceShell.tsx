"use client";

import { ReactNode } from "react";
import { VFXProvider } from "react-vfx";

import { ExtensionNoiseGuard } from "@/components/app/ExtensionNoiseGuard";
import { CurtainsLayer } from "@/components/effects/CurtainsLayer";
import { LenisProvider } from "@/components/effects/LenisProvider";
import { OglNebulaBackground } from "@/components/effects/OglNebulaBackground";

import { AppTopNav } from "./AppTopNav";

interface Props {
  userEmail: string;
  children: ReactNode;
}

export function AppExperienceShell({ userEmail, children }: Props) {
  return (
    <VFXProvider>
      <ExtensionNoiseGuard />
      <LenisProvider />
      <OglNebulaBackground />
      <CurtainsLayer />

      <div data-scroll-container className="relative min-h-screen overflow-x-clip px-4 pb-16 pt-6 text-slate-100 md:px-8">
        <div className="mx-auto max-w-7xl">
          <AppTopNav userEmail={userEmail} />
          <main>{children}</main>
        </div>
      </div>
    </VFXProvider>
  );
}
