"use client";

import { useEffect, useRef } from "react";

interface Props {
  className?: string;
  count?: number;
}

type RapierApi = (typeof import("@dimforge/rapier3d"))["default"];
type RapierWorld = import("@dimforge/rapier3d").World;
type RapierRigidBody = import("@dimforge/rapier3d").RigidBody;

export function RapierFloatField({ className, count = 14 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let raf = 0;
    let cancelled = false;
    const bodies: Array<{ body: RapierRigidBody; element: HTMLDivElement }> = [];
    let world: RapierWorld | null = null;
    let cleanupWalls = () => {};
    let rapier: RapierApi | null = null;

    const mount = async () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const targetCount = reduced ? Math.max(4, Math.floor(count * 0.45)) : count;

      const rapierModule = await import("@dimforge/rapier3d");
      rapier = rapierModule.default;
      if (cancelled) return;

      const gravity = { x: 0, y: -4.8, z: 0 };
      world = new rapier.World(gravity);

      const halfW = 5.5;
      const halfH = 3.4;
      const thickness = 0.2;
      const wallBodies: RapierRigidBody[] = [];

      const createWall = (x: number, y: number, hx: number, hy: number) => {
        if (!world || !rapier) return;
        const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(x, y, 0));
        world.createCollider(rapier.ColliderDesc.cuboid(hx, hy, thickness), body);
        wallBodies.push(body);
      };

      createWall(0, -halfH - 0.12, halfW + 0.5, 0.12);
      createWall(0, halfH + 0.12, halfW + 0.5, 0.12);
      createWall(-halfW - 0.2, 0, 0.12, halfH + 0.5);
      createWall(halfW + 0.2, 0, 0.12, halfH + 0.5);

      cleanupWalls = () => {
        wallBodies.forEach((body) => world?.removeRigidBody(body));
      };

      for (let i = 0; i < targetCount; i += 1) {
        const radius = 0.22 + Math.random() * 0.25;
        if (!rapier) break;
        const body = world.createRigidBody(
          rapier.RigidBodyDesc.dynamic()
            .setTranslation((Math.random() - 0.5) * 8.0, Math.random() * 4.0, (Math.random() - 0.5) * 0.25)
            .setLinvel((Math.random() - 0.5) * 2.1, Math.random() * 1.6, 0)
            .setAngvel({ x: 0, y: 0, z: (Math.random() - 0.5) * 4.0 }),
        );

        world.createCollider(
          rapier.ColliderDesc.ball(radius).setRestitution(0.84).setFriction(0.2).setDensity(0.3),
          body,
        );

        const element = document.createElement("div");
        element.className =
          "absolute rounded-[34%] border border-cyan-100/40 bg-gradient-to-br from-white/45 via-cyan-200/30 to-cyan-500/20 shadow-[0_20px_40px_rgba(8,145,178,0.35)] backdrop-blur-xl";
        const size = `${Math.round(radius * 110)}px`;
        element.style.width = size;
        element.style.height = size;
        container.appendChild(element);
        bodies.push({ body, element });
      }

      let impulseFrame = 0;
      const tick = () => {
        if (!world || cancelled) return;
        world.step();
        impulseFrame += 1;

        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        const halfWidthPx = width * 0.5;
        const halfHeightPx = height * 0.5;

        if (impulseFrame % 84 === 0) {
          bodies.forEach(({ body }, index) => {
            if (index % 2 === 0) {
              body.applyImpulse(
                { x: (Math.random() - 0.5) * 0.55, y: Math.random() * 0.28, z: 0 },
                true,
              );
            }
          });
        }

        bodies.forEach(({ body, element }) => {
          const pos = body.translation();
          const rot = body.rotation();
          const x = (pos.x / 5.5) * halfWidthPx + halfWidthPx;
          const y = halfHeightPx - (pos.y / 3.4) * halfHeightPx;
          const z = pos.z * 90;
          const angle = rot.z * 180;
          element.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotate(${angle}deg)`;
        });

        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
    };

    void mount();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanupWalls();
      bodies.forEach(({ body, element }) => {
        if (world) {
          world.removeRigidBody(body);
        }
        element.remove();
      });
      if (world) {
        world.free();
      }
    };
  }, [count]);

  return (
    <div
      ref={ref}
      className={className || "pointer-events-none absolute inset-0 overflow-hidden rounded-[2.2rem]"}
      aria-hidden="true"
    />
  );
}
