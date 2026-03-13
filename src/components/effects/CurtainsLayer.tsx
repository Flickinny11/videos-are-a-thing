"use client";

import { Curtains, Plane } from "curtainsjs";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function CurtainsLayer() {
  const pathname = usePathname();

  useEffect(() => {
    const canvas = document.getElementById("curtains-canvas");
    if (!canvas) return;

    const curtains = new Curtains({
      container: "curtains-canvas",
      watchScroll: false,
      pixelRatio: Math.min(1.6, window.devicePixelRatio),
    });

    const instances: Array<{ remove: () => void }> = [];
    let timeout = 0;

    const attachPlanes = () => {
      const planes = Array.from(document.querySelectorAll(".curtain-plane"));
      planes.forEach((planeEl) => {
        const plane = new Plane(curtains, planeEl as HTMLElement, {
          vertexShader: `
            precision mediump float;
            attribute vec3 aVertexPosition;
            attribute vec2 aTextureCoord;
            varying vec3 vVertexPosition;
            varying vec2 vTextureCoord;
            uniform mat4 uMVMatrix;
            uniform mat4 uPMatrix;
            void main() {
              vec3 vertexPosition = aVertexPosition;
              gl_Position = uPMatrix * uMVMatrix * vec4(vertexPosition, 1.0);
              vTextureCoord = aTextureCoord;
              vVertexPosition = vertexPosition;
            }
          `,
          fragmentShader: `
            precision mediump float;
            varying vec3 vVertexPosition;
            varying vec2 vTextureCoord;
            uniform sampler2D uSampler0;
            uniform float uTime;
            void main() {
              vec2 uv = vTextureCoord;
              uv.x += sin((uv.y + uTime * 0.35) * 12.0) * 0.006;
              uv.y += cos((uv.x + uTime * 0.42) * 9.0) * 0.004;
              vec4 color = texture2D(uSampler0, uv);
              gl_FragColor = color;
            }
          `,
          uniforms: {
            time: {
              name: "uTime",
              type: "1f",
              value: 0,
            },
          },
        });

        plane.onRender(() => {
          if (plane.uniforms.time) {
            plane.uniforms.time.value += 0.02;
          }
        });

        instances.push(plane);
      });
    };

    timeout = window.setTimeout(attachPlanes, 120);

    return () => {
      window.clearTimeout(timeout);
      instances.forEach((plane) => plane.remove());
      curtains.dispose();
    };
  }, [pathname]);

  return <div id="curtains-canvas" className="pointer-events-none fixed inset-0 -z-10 opacity-45" aria-hidden="true" />;
}
