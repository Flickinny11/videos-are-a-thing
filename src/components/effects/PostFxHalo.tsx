"use client";

import { BloomEffect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import { useEffect, useRef } from "react";
import {
  AmbientLight,
  Clock,
  Color,
  IcosahedronGeometry,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

export function PostFxHalo() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;

    const width = target.clientWidth;
    const height = target.clientHeight;

    const scene = new Scene();
    scene.background = new Color(0x020611);

    const camera = new PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    target.appendChild(renderer.domElement);

    const mesh = new Mesh(
      new IcosahedronGeometry(1.12, 6),
      new MeshPhysicalMaterial({
        color: new Color("#54b4ff"),
        roughness: 0.18,
        metalness: 0.45,
        transmission: 0.28,
        thickness: 0.85,
      }),
    );

    scene.add(mesh);
    scene.add(new AmbientLight(0x6cc3ff, 1.35));

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new EffectPass(camera, new BloomEffect({ luminanceThreshold: 0.18, intensity: 0.9, radius: 0.55 })),
    );

    const clock = new Clock();

    let raf = 0;
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      mesh.rotation.x = elapsed * 0.25;
      mesh.rotation.y = elapsed * 0.38;
      mesh.position.y = Math.sin(elapsed * 0.8) * 0.12;
      composer.render();
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    const onResize = () => {
      const w = target.clientWidth;
      const h = target.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      composer.setSize(w, h);
    };

    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      composer.dispose();
      mesh.geometry.dispose();
      (mesh.material as MeshPhysicalMaterial).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      target.removeChild(renderer.domElement);
    };
  }, []);

  return <div className="h-[220px] w-full overflow-hidden rounded-2xl border border-cyan-100/20" ref={ref} />;
}
