"use client";

import { Camera, Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

interface Props {
  className?: string;
}

export function OglLiquidRibbon({ className }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.innerWidth < 820;
    const renderer = new Renderer({
      alpha: true,
      antialias: !reduced,
      dpr: Math.min(window.devicePixelRatio, reduced ? 1.2 : 2),
    });

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    target.appendChild(gl.canvas);

    const camera = new Camera(gl);
    camera.position.z = 1;

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: `
        attribute vec2 uv;
        attribute vec2 position;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 0.0, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uResolution;

        float hash(vec2 p) {
          p = fract(p * vec2(443.8975, 397.2973));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float f = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 5; i++) {
            f += amp * noise(p);
            p *= 2.02;
            amp *= 0.5;
          }
          return f;
        }

        void main() {
          vec2 uv = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
          float t = uTime * 0.12;

          float base = fbm(uv * 3.5 + vec2(t, -t * 1.2));
          float detail = fbm(uv * 9.0 + vec2(-t * 1.8, t * 0.9));
          float liquid = smoothstep(0.2, 0.92, base * 0.72 + detail * 0.28);

          vec3 midnight = vec3(0.04, 0.08, 0.17);
          vec3 cobalt = vec3(0.07, 0.45, 0.93);
          vec3 cyan = vec3(0.58, 0.94, 1.0);

          vec3 color = mix(midnight, cobalt, liquid);
          color = mix(color, cyan, pow(liquid, 3.0) * 0.55);

          float sheen = pow(max(0.0, 1.0 - length(uv * vec2(0.8, 1.2))), 2.8);
          color += vec3(0.45, 0.62, 0.82) * sheen * 0.15;

          float vignette = smoothstep(1.2, 0.15, length(uv));
          color *= vignette;

          gl_FragColor = vec4(color, 0.82);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [target.clientWidth || 1, target.clientHeight || 1] },
      },
      transparent: true,
    });

    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const width = target.clientWidth || 1;
      const height = target.clientHeight || 1;
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [width, height];
    };

    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const render = (time: number) => {
      raf = requestAnimationFrame(render);
      program.uniforms.uTime.value = time * 0.001;
      renderer.render({ scene: mesh, camera });
    };

    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      if (gl.canvas.parentElement) {
        gl.canvas.parentElement.removeChild(gl.canvas);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <div ref={ref} className={className || "pointer-events-none absolute inset-0"} aria-hidden="true" />;
}
