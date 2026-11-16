"use client";

import React, { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

// ============================================================================
// ANDROS — AGUJERO NEGRO PROCEDURAL (WebGL / GLSL, tiempo real)
//   · Cámara fija: el horizonte de sucesos no se mueve, ni zoom ni vibración.
//   · Obsidian Monolith: vacío #0D0E11, sombra negra pura, disco marfil cálido.
//   · Paper Modernist: diagrama técnico de lente gravitacional sobre papel
//     #F6F5F2 con anillos de grafito #1A1A18 y terracota #C95A3B.
//   · Movimiento laminar ultralento (rotación kepleriana), sin destellos.
//   · devicePixelRatio limitado a 2 y limpieza completa del contexto WebGL.
// ============================================================================

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 uRes;      // tamaño del lienzo en píxeles físicos
uniform vec2 uCenter;   // centro de la singularidad (píxeles físicos)
uniform float uRadius;  // radio de la sombra (píxeles físicos)
uniform float uTime;    // segundos (congelado con movimiento reducido)
uniform float uLight;   // 0 = Obsidian Monolith, 1 = Paper Modernist

const float PI = 3.14159265;
const float TAU = 6.28318531;
const float COS_I = 0.13;   // inclinación del disco (casi de canto)
const float R_IN = 1.55;    // borde interior del disco (en radios de sombra)
const float R_OUT = 5.6;    // borde exterior del disco
const float R_RETICLE = 6.4;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise1(float x, float seed) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(vec2(i, seed)), hash(vec2(i + 1.0, seed)), u);
}

// Hilos laminares concéntricos con armónicos angulares suaves (periódicos,
// sin costura). La velocidad angular decrece con el radio (kepleriana).
float streams(float r, float th) {
  float w = 0.035 * (0.45 + pow(max(r, 0.5), -1.5));
  float a = th - uTime * w;
  float b1 = noise1(r * 14.0, 1.0);
  float b2 = noise1(r * 41.0, 2.0);
  float ph = noise1(r * 6.0, 3.0) * TAU;
  float m = 0.62 + 0.26 * sin(a * 2.0 + ph) + 0.12 * sin(a * 5.0 - ph * 1.3);
  return (0.55 * b1 + 0.45 * b2) * m;
}

float diskProfile(float r) {
  return smoothstep(R_IN, R_IN + 0.35, r)
       * (1.0 - smoothstep(R_OUT - 2.2, R_OUT, r))
       * pow(R_IN / max(r, 0.001), 0.9);
}

// Línea antialiasada de ~widthPx píxeles sobre el valor 0 de un campo escalar.
float lineAA(float v, float fw, float widthPx) {
  return 1.0 - clamp(abs(v) / max(fw, 1e-5) - widthPx * 0.5 + 0.5, 0.0, 1.0);
}

// Líneas periódicas (cada unidad del campo) antialiasadas.
float gridAA(float v, float fw, float widthPx) {
  float d = abs(fract(v - 0.5) - 0.5);
  return 1.0 - clamp(d / max(fw, 1e-5) - widthPx * 0.5 + 0.5, 0.0, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float minRes = min(uRes.x, uRes.y);
  float px = 1.0 / uRadius;                    // 1 píxel en radios de sombra

  vec2 p = (frag - uCenter) / uRadius;         // sombra = radio 1
  float rho = length(p);
  float th = atan(p.y, p.x);
  vec2 s = (frag - uCenter) / minRes;          // coordenadas de pantalla

  // ---- Geometría -----------------------------------------------------------
  float shadowMask = 1.0 - smoothstep(1.0 - px * 0.75, 1.0 + px * 0.75, rho);

  // Disco directo (plano inclinado visto casi de canto)
  vec2 dp = vec2(p.x, p.y / COS_I);
  float rd = length(dp);
  float thd = atan(dp.y, dp.x);
  float nearSide = step(p.y, 0.0);             // la mitad cercana cruza delante
  float diskVis = max(nearSide, 1.0 - shadowMask);
  float diskMask = diskProfile(rd) * diskVis;
  float dop = 1.0 + 0.45 * (-dp.x / max(rd, 0.001));   // haz Doppler: izquierda

  // Imagen lenteada de la mitad lejana: abraza la sombra, gruesa arriba.
  float top = 0.5 + 0.5 * sin(th);
  float spread = mix(0.22, 0.62, top);
  float lt = (rho - 1.04) / spread;
  float rl = R_IN + lt * 2.6;
  float lensMask = smoothstep(-0.02, 0.06, lt) * (1.0 - smoothstep(0.55, 1.0, lt))
                 * diskProfile(rl) * mix(0.5, 1.0, top);
  float dopL = 1.0 + 0.35 * (-cos(th));

  float sd = streams(rd, thd);
  float sl = streams(rl, th);

  // Anillo de fotones
  float ringD = (rho - 1.035) * uRadius;
  float photon = exp(-ringD * ringD / 2.2);
  float halo = exp(-max(rho - 1.0, 0.0) * 9.0) * (1.0 - shadowMask);

  // Retícula técnica: cruz con hueco central + círculo con marcas cada 15°
  float fwS = fwidth(s.x);
  float crossLines = max(lineAA(s.x, fwS, 1.0), lineAA(s.y, fwS, 1.0))
              * smoothstep(R_RETICLE * 0.92, R_RETICLE * 1.02, rho)
              * (1.0 - smoothstep(0.55, 0.95, length(s)));
  float circle = lineAA(rho - R_RETICLE, fwidth(rho), 1.0);
  float seg = TAU / 24.0;
  float angDistPx = abs(fract(th / seg + 0.5) - 0.5) * seg * rho * uRadius;
  float ticks = (1.0 - clamp(angDistPx - 0.5, 0.0, 1.0))
              * step(R_RETICLE, rho) * step(rho, R_RETICLE + 0.28);
  float reticle = max(max(crossLines, circle), ticks);

  // Fondo deformado por la lente (radio de Einstein ≈ 2.6 sombras)
  float re = 2.6 * uRadius / minRes;
  vec2 q = s * (1.0 - re * re / max(dot(s, s), 1e-5));

  // ---- Obsidian Monolith ---------------------------------------------------
  vec2 cell = q * 90.0;
  vec2 cid = floor(cell);
  float sh = hash(cid);
  vec2 off = vec2(hash(cid + 3.1), hash(cid + 7.7)) - 0.5;
  float fwC = max(fwidth(cell.x), 1e-4);
  float sd2 = length(fract(cell) - 0.5 - off * 0.7) / fwC;
  float stars = step(0.982, sh) * (1.0 - smoothstep(0.4, 1.4, sd2))
              * (0.25 + 0.5 * hash(cid + 1.7));

  vec3 voidCol = vec3(0.051, 0.055, 0.067);
  vec3 hot = vec3(1.0, 0.93, 0.84);
  vec3 warm = vec3(0.93, 0.62, 0.40);
  vec3 dark = voidCol;
  dark += vec3(0.80, 0.85, 1.0) * stars * (1.0 - shadowMask) * (1.0 - smoothstep(0.5, 1.4, length(s)) * 0.4);
  dark += vec3(1.0) * reticle * 0.07;
  dark = mix(dark, vec3(0.0), shadowMask);     // horizonte: negro absoluto
  float eD = diskMask * (0.3 + 0.95 * sd) * dop;
  float eL = lensMask * (0.3 + 0.95 * sl) * dopL;
  vec3 emission = mix(warm, hot, clamp(eD, 0.0, 1.0)) * eD * 0.85
                + mix(warm, hot, clamp(eL, 0.0, 1.0)) * eL * 1.1
                + hot * (photon * 0.85 + halo * 0.12);
  dark += 1.0 - exp(-emission * 1.25);

  // ---- Paper Modernist (diagrama técnico) ----------------------------------
  vec3 paper = vec3(0.965, 0.961, 0.949);
  vec3 graphite = vec3(0.102, 0.102, 0.094);
  vec3 terra = vec3(0.788, 0.353, 0.231);
  vec3 light = paper;

  // Papel milimetrado curvado por la lente
  vec2 g = q * 22.0;
  float fwGx = fwidth(g.x);
  float fwGy = fwidth(g.y);
  float grid = max(gridAA(g.x, fwGx, 1.0), gridAA(g.y, fwGy, 1.0));
  float gridFade = (1.0 - smoothstep(0.2, 0.85, length(s)))
                 * (1.0 - smoothstep(0.25, 0.6, max(fwGx, fwGy)))
                 * smoothstep(re * 0.85, re * 1.6, length(s))
                 * (1.0 - shadowMask);
  light = mix(light, graphite, grid * gridFade * 0.09);
  light = mix(light, graphite, reticle * 0.22);

  // Sombra: disco de grafito
  light = mix(light, graphite, shadowMask);

  // Imagen lenteada: aguada terracota + contorno interior
  light = mix(light, terra, clamp(lensMask * (0.25 + 0.9 * sl), 0.0, 1.0) * 0.7);
  float lensArc = lineAA(lt - 0.42, fwidth(lt), 1.0) * smoothstep(0.0, 0.08, lensMask);
  light = mix(light, terra, lensArc * 0.8);

  // Disco: aguada de grafito laminar; sobre la sombra se invierte a papel
  vec3 diskInk = mix(graphite, paper, shadowMask * nearSide);
  light = mix(light, diskInk, clamp(diskMask * (0.15 + 0.85 * sd), 0.0, 1.0) * 0.6);

  // Curvas de nivel del disco (borde interior, órbita media discontinua, borde exterior)
  float fwRd = fwidth(rd);
  float contourFade = 1.0 - smoothstep(0.25, 0.6, fwRd);
  float isoIn = lineAA(rd - R_IN, fwRd, 1.0);
  float isoOut = lineAA(rd - (R_OUT - 0.4), fwRd, 1.0);
  float dashA = thd - uTime * 0.035 * (0.45 + pow(3.4, -1.5));
  float dashes = step(0.5, fract(dashA * 36.0 / TAU));
  float isoMid = lineAA(rd - 3.4, fwRd, 1.0) * dashes;
  float contours = max(max(isoIn, isoOut), isoMid) * contourFade * diskVis;
  light = mix(light, diskInk, contours * 0.75);

  // Anillo de fotones: línea terracota de precisión
  light = mix(light, terra, clamp(photon * 1.3, 0.0, 1.0));

  gl_FragColor = vec4(mix(dark, light, uLight), 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[Andros] BlackHole shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface BlackHoleCanvasProps {
  /** Centro horizontal de la singularidad (0 = izquierda, 1 = derecha). */
  centerX: number;
  /** Centro vertical (0 = arriba, 1 = abajo). */
  centerY: number;
  /** Radio de la sombra como fracción del lado corto de la pantalla. */
  radius: number;
  /** Se llama una vez por segundo con los FPS medidos. */
  onFps?: (fps: number) => void;
  className?: string;
}

export const BlackHoleCanvas: React.FC<BlackHoleCanvasProps> = ({
  centerX,
  centerY,
  radius,
  onFps,
  className = "",
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const theme = useWorkspaceStore((s) => s.theme);
  const reduceMotion = useReducedMotion() ?? false;

  // Valores "vivos" que el bucle de render lee sin reiniciar WebGL.
  const live = useRef({ centerX, centerY, radius, light: theme === "light" ? 1 : 0, reduceMotion, onFps });
  useEffect(() => {
    live.current.centerX = centerX;
    live.current.centerY = centerY;
    live.current.radius = radius;
    live.current.light = theme === "light" ? 1 : 0;
    live.current.reduceMotion = reduceMotion;
    live.current.onFps = onFps;
  }, [centerX, centerY, radius, theme, reduceMotion, onFps]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // El <canvas> se crea aquí (y no en JSX) para que cada montaje tenga un
    // contexto WebGL nuevo, incluso con el doble montaje de React en desarrollo.
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });

    const removeCanvas = () => {
      if (canvas.parentNode === host) host.removeChild(canvas);
    };

    if (!gl || !gl.getExtension("OES_standard_derivatives")) {
      // Sin WebGL: queda el fondo CSS del tema (degradación elegante).
      removeCanvas();
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      removeCanvas();
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[Andros] BlackHole program:", gl.getProgramInfoLog(program));
      removeCanvas();
      return;
    }
    gl.useProgram(program);

    // Triángulo que cubre toda la pantalla.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uCenter = gl.getUniformLocation(program, "uCenter");
    const uRadius = gl.getUniformLocation(program, "uRadius");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uLight = gl.getUniformLocation(program, "uLight");

    // ---- Tamaño (DPR limitado a 2) ----------------------------------------
    let sizeDirty = true;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      sizeDirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // ---- Bucle de render ----------------------------------------------------
    let frameId = 0;
    let lost = false;
    let simTime = 37.0; // arranca con el flujo ya "asentado"
    let lastNow = performance.now();
    let lightMix = live.current.light; // sin transición en el primer cuadro
    let fpsFrames = 0;
    let fpsStart = lastNow;
    let lastDrawn = { cx: -1, cy: -1, r: -1, mix: -1 };

    const render = (now: number) => {
      frameId = requestAnimationFrame(render);
      if (lost) return;

      const dt = Math.min((now - lastNow) / 1000, 0.1);
      lastNow = now;
      const state = live.current;

      // Transición suave entre temas (~0.4 s)
      lightMix += (state.light - lightMix) * (1 - Math.exp(-dt * 9));
      if (Math.abs(state.light - lightMix) < 0.002) lightMix = state.light;

      // Movimiento reducido: solo se redibuja cuando algo cambia.
      if (state.reduceMotion) {
        const unchanged =
          !sizeDirty &&
          lastDrawn.cx === state.centerX &&
          lastDrawn.cy === state.centerY &&
          lastDrawn.r === state.radius &&
          lastDrawn.mix === lightMix;
        if (unchanged) return;
      } else {
        simTime += dt;
      }

      const w = canvas.width;
      const h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform2f(uCenter, state.centerX * w, (1 - state.centerY) * h);
      gl.uniform1f(uRadius, Math.max(4, state.radius * Math.min(w, h)));
      gl.uniform1f(uTime, simTime);
      gl.uniform1f(uLight, lightMix);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      sizeDirty = false;
      lastDrawn = { cx: state.centerX, cy: state.centerY, r: state.radius, mix: lightMix };

      fpsFrames += 1;
      if (now - fpsStart >= 1000) {
        state.onFps?.(Math.round((fpsFrames * 1000) / (now - fpsStart)));
        fpsFrames = 0;
        fpsStart = now;
      }
    };
    frameId = requestAnimationFrame(render);

    const handleLost = (e: Event) => {
      e.preventDefault();
      lost = true;
    };
    canvas.addEventListener("webglcontextlost", handleLost);

    // ---- Limpieza -------------------------------------------------------------
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", handleLost);
      if (!gl.isContextLost()) {
        gl.deleteBuffer(buffer);
        gl.detachShader(program, vs);
        gl.detachShader(program, fs);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteProgram(program);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      removeCanvas();
    };
  }, []);

  return <div ref={hostRef} aria-hidden="true" className={`absolute inset-0 ${className}`} />;
};
