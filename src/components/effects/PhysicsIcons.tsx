"use client";

import * as CANNON from "cannon-es";
import { useEffect, useRef } from "react";

const ICONS = ["◉", "◆", "◌", "⬢", "◍", "◈"];

export function PhysicsIcons() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);

    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floor);

    const bodies: CANNON.Body[] = [];
    const elements: HTMLDivElement[] = [];

    ICONS.forEach((symbol, index) => {
      const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Sphere(0.28),
        position: new CANNON.Vec3(index * 0.8 - 2, 3 + index * 0.4, 0),
      });
      body.velocity.set((Math.random() - 0.5) * 2, Math.random() * 1.5, 0);
      world.addBody(body);
      bodies.push(body);

      const el = document.createElement("div");
      el.className =
        "absolute rounded-2xl border border-white/30 bg-white/10 px-3 py-2 text-cyan-100 shadow-[0_10px_35px_rgba(0,180,255,0.28)] backdrop-blur-md";
      el.textContent = symbol;
      container.appendChild(el);
      elements.push(el);
    });

    let raf = 0;
    const step = () => {
      world.step(1 / 60);

      for (let i = 0; i < bodies.length; i += 1) {
        const body = bodies[i];
        const el = elements[i];

        if (body.position.y < 0.2) {
          body.position.y = 0.2;
          body.velocity.y *= -0.65;
        }

        const x = body.position.x * 40 + 240;
        const y = 240 - body.position.y * 55;
        el.style.transform = `translate3d(${x}px, ${y}px, ${body.position.z}px) rotate(${body.quaternion.y * 180}deg)`;
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      elements.forEach((el) => el.remove());
      bodies.forEach((body) => world.removeBody(body));
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute right-0 top-0 hidden h-[420px] w-[520px] overflow-hidden rounded-3xl md:block"
      aria-hidden="true"
    />
  );
}
