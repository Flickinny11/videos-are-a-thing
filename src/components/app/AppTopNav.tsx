"use client";

import { VFXSpan } from "react-vfx";

import { PhysicsIcons } from "@/components/effects/PhysicsIcons";
import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { RapierFloatField } from "@/components/effects/RapierFloatField";

import { TransitionNavLink } from "./TransitionNavLink";

interface Props {
  userEmail: string;
}

const ICON_PATHS = {
  studio:
    "M4 18.5V5.5C4 4.1 5.1 3 6.5 3H17.5C18.9 3 20 4.1 20 5.5V18.5C20 19.9 18.9 21 17.5 21H6.5C5.1 21 4 19.9 4 18.5ZM7 7H17M7 11H14M7 15H12",
  queue:
    "M4 7.5C4 5.6 5.6 4 7.5 4H16.5C18.4 4 20 5.6 20 7.5V16.5C20 18.4 18.4 20 16.5 20H7.5C5.6 20 4 18.4 4 16.5V7.5ZM8 8V16M12 10V16M16 12V16",
  library:
    "M4 7.5C4 5.6 5.6 4 7.5 4H16.5C18.4 4 20 5.6 20 7.5V16.5C20 18.4 18.4 20 16.5 20H7.5C5.6 20 4 18.4 4 16.5V7.5ZM8.3 15.7L11.4 11.6L14 14.8L16 12.5L19.5 17H4.6L8.3 15.7Z",
} as const;

const Icon = ({ path }: { path: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function AppTopNav({ userEmail }: Props) {
  return (
    <header className="relative mb-8 overflow-hidden rounded-[2.4rem] border border-cyan-100/20 bg-slate-950/45 p-5 backdrop-blur-2xl">
      <OglLiquidRibbon className="pointer-events-none absolute inset-0 opacity-70" />
      <RapierFloatField className="pointer-events-none absolute inset-0 opacity-45" count={10} />
      <PhysicsIcons />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-100/40 bg-cyan-100/10 px-3 py-1 text-[11px] tracking-[0.26em] text-cyan-50">
            <span className="h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(103,232,249,0.95)]" />
            RUNPOD ORBIT DECK
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight md:text-4xl">
            <VFXSpan shader="rgbShift">Studio Navigation Reactor</VFXSpan>
          </h1>
          <p className="mt-2 text-xs uppercase tracking-[0.15em] text-cyan-100/85">{userEmail}</p>
        </div>

        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-2xl border border-cyan-100/45 bg-slate-900/65 px-5 py-3 text-xs uppercase tracking-[0.15em] text-cyan-50 transition hover:border-cyan-50 hover:bg-slate-800/70"
          >
            Sign Out
          </button>
        </form>
      </div>

      <nav className="relative z-10 mt-5 grid gap-3 md:grid-cols-3">
        <TransitionNavLink href="/studio" label="Studio" detail="Create jobs" icon={<Icon path={ICON_PATHS.studio} />} />
        <TransitionNavLink href="/queue" label="Queue" detail="Realtime polling" icon={<Icon path={ICON_PATHS.queue} />} />
        <TransitionNavLink href="/library" label="Library" detail="Play + download" icon={<Icon path={ICON_PATHS.library} />} />
      </nav>
    </header>
  );
}
