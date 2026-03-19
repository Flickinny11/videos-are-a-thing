"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Interactive button wrapper that provides premium click feedback:
 * - Scale-down on press (active state)
 * - Ripple glow effect on click
 * - Brief color flash confirmation
 * - Haptic-style bounce-back on release
 * All achieved via lightweight CSS transforms + canvas ripple (no heavy deps).
 */

interface Props {
  children: React.ReactNode;
  onClick: (() => void) | (() => Promise<void>);
  disabled?: boolean;
  className?: string;
  activeClassName?: string;
  variant?: "default" | "danger" | "primary" | "ghost";
}

const VARIANT_STYLES = {
  default:
    "border-cyan-100/45 bg-cyan-100/10 text-cyan-50 hover:bg-cyan-100/20",
  danger:
    "border-rose-200/45 bg-rose-300/10 text-rose-200 hover:bg-rose-300/20",
  primary:
    "border-cyan-50/70 bg-gradient-to-r from-cyan-100 to-cyan-300 text-slate-900 shadow-[0_12px_30px_rgba(56,189,248,0.35)]",
  ghost:
    "border-cyan-100/35 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/20",
} as const;

const RIPPLE_COLORS = {
  default: "rgba(103, 232, 249, 0.35)",
  danger: "rgba(251, 113, 133, 0.35)",
  primary: "rgba(255, 255, 255, 0.4)",
  ghost: "rgba(103, 232, 249, 0.25)",
} as const;

export function InteractiveButton({
  children,
  onClick,
  disabled = false,
  className = "",
  activeClassName = "",
  variant = "default",
}: Props) {
  const [isActive, setIsActive] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const rippleRef = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || isBusy) return;

      // Ripple effect at click position
      const btn = btnRef.current;
      const ripple = rippleRef.current;
      if (btn && ripple) {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const size = Math.max(rect.width, rect.height) * 2;

        ripple.style.width = `${size}px`;
        ripple.style.height = `${size}px`;
        ripple.style.left = `${x - size / 2}px`;
        ripple.style.top = `${y - size / 2}px`;
        ripple.style.background = `radial-gradient(circle, ${RIPPLE_COLORS[variant]} 0%, transparent 70%)`;
        ripple.style.transform = "scale(0)";
        ripple.style.opacity = "1";

        // Force reflow then animate
        ripple.offsetHeight;
        ripple.style.transition = "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out";
        ripple.style.transform = "scale(1)";
        ripple.style.opacity = "0";
      }

      setIsActive(true);
      setIsBusy(true);

      try {
        await onClick();
      } finally {
        // Bounce-back timing
        setTimeout(() => {
          setIsActive(false);
          setIsBusy(false);
        }, 150);
      }
    },
    [disabled, isBusy, onClick, variant],
  );

  return (
    <button
      ref={btnRef}
      type="button"
      disabled={disabled || isBusy}
      onClick={(e) => void handleClick(e)}
      className={`
        relative overflow-hidden rounded-xl border px-3 py-2 text-[11px] uppercase tracking-[0.12em]
        transition-all duration-200 ease-out
        disabled:opacity-60 disabled:cursor-not-allowed
        ${VARIANT_STYLES[variant]}
        ${isActive ? `scale-[0.94] brightness-125 ${activeClassName}` : "active:scale-[0.96]"}
        ${className}
      `}
    >
      {/* Ripple layer */}
      <span
        ref={rippleRef}
        className="pointer-events-none absolute rounded-full"
        style={{ transform: "scale(0)", opacity: 0 }}
        aria-hidden="true"
      />
      {children}
    </button>
  );
}
