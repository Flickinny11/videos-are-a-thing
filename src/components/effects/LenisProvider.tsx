"use client";

import Lenis from "lenis";
import { useEffect } from "react";

export function LenisProvider() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const lenis = new Lenis({
      lerp: 0.09,
      smoothWheel: true,
      syncTouch: true,
      wheelMultiplier: 0.86,
      touchMultiplier: 1.1,
    });

    let locomotive: { destroy: () => void } | null = null;

    const bootLocomotive = async () => {
      if (window.innerWidth < 1180) return;

      const locomotiveModule = await import("locomotive-scroll");
      const LocomotiveScroll = locomotiveModule.default;

      locomotive = new LocomotiveScroll({
        lenisOptions: {
          lerp: 0.09,
          duration: 1.15,
          smoothWheel: true,
        },
      });
    };

    void bootLocomotive();

    let frame = 0;
    let active = true;

    const raf = (time: number) => {
      if (!active) return;
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };

    frame = requestAnimationFrame(raf);

    const onVisibilityChange = () => {
      active = document.visibilityState === "visible";
      if (active) {
        frame = requestAnimationFrame(raf);
      } else {
        cancelAnimationFrame(frame);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cancelAnimationFrame(frame);
      lenis.destroy();
      locomotive?.destroy();
    };
  }, []);

  return null;
}
