"use client";

import { usePathname, useRouter } from "next/navigation";
import { MouseEvent, ReactNode, useMemo } from "react";

interface Props {
  href: string;
  label: string;
  detail: string;
  icon: ReactNode;
}

export function TransitionNavLink({ href, label, detail, icon }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const active = useMemo(() => pathname === href, [pathname, href]);

  const onNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();

    if (pathname === href) return;

    const navigate = () => router.push(href);
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      (document as Document & { startViewTransition: (callback: () => void) => void }).startViewTransition(
        navigate,
      );
      return;
    }
    navigate();
  };

  return (
    <a
      href={href}
      onClick={onNavigate}
      className={`group relative isolate overflow-hidden rounded-2xl border px-4 py-3 transition duration-300 ${
        active
          ? "border-cyan-100/70 bg-cyan-300/18 text-cyan-50 shadow-[0_12px_40px_rgba(34,211,238,0.35)]"
          : "border-cyan-200/20 bg-slate-900/45 text-cyan-100/85 hover:border-cyan-100/40 hover:bg-cyan-300/12"
      }`}
      style={{ viewTransitionName: `nav-pill-${label.toLowerCase()}` }}
    >
      <span className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_35%_20%,rgba(255,255,255,0.3),transparent_44%),linear-gradient(145deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04)_38%,rgba(8,145,178,0.18))] opacity-80 transition duration-500 group-hover:opacity-100" />
      <span className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/30 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
          {icon}
        </span>
        <span>
          <span className="block text-sm font-semibold uppercase tracking-[0.16em]">{label}</span>
          <span className="block text-[11px] tracking-[0.08em] text-cyan-50/70">{detail}</span>
        </span>
      </span>
    </a>
  );
}
