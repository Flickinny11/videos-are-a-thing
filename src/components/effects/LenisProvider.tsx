"use client";

import Lenis from "lenis";
import { useEffect } from "react";

export function LenisProvider() {
  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      syncTouch: true,
      wheelMultiplier: 0.92,
    });

    let locomotive: { destroy: () => void } | null = null;

    const bootLocomotive = async () => {
      if (window.innerWidth < 1024) return;

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

    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };

    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      locomotive?.destroy();
    };
  }, []);

  return null;
}
