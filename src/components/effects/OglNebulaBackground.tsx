"use client";

import { Camera, Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

export function OglNebulaBackground() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;

    const renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio, 2), alpha: true });
    const gl = renderer.gl;
    gl.clearColor(0.03, 0.05, 0.1, 1);

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

        uniform float uTime;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float hash(vec2 p){
          p = fract(p * vec2(123.34, 345.45));
          p += dot(p, p + 34.345);
          return fract(p.x * p.y);
        }

        float noise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);

          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));

          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          vec2 uv = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
          float t = uTime * 0.18;

          float layerA = noise(uv * 3.4 + vec2(t, -t));
          float layerB = noise(uv * 5.7 - vec2(t * 0.7, t * 1.1));
          float layerC = noise(uv * 11.2 + vec2(sin(t), cos(t)));

          float cloud = smoothstep(0.18, 0.95, 0.5 * layerA + 0.35 * layerB + 0.15 * layerC);
          vec3 deep = vec3(0.02, 0.05, 0.14);
          vec3 glow = vec3(0.07, 0.35, 0.62);
          vec3 ambient = vec3(0.18, 0.28, 0.46);

          vec3 color = mix(deep, ambient, cloud);
          color += glow * pow(cloud, 2.6) * 0.78;

          float vignette = smoothstep(1.15, 0.15, length(uv));
          color *= vignette;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [window.innerWidth, window.innerHeight] },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const width = target.clientWidth || window.innerWidth;
      const height = target.clientHeight || window.innerHeight;
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
      if (gl.canvas.parentElement) gl.canvas.parentElement.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <div ref={ref} className="pointer-events-none fixed inset-0 -z-20 opacity-95" aria-hidden="true" />;
}
