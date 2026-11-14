"use client";

import React, { useEffect, useRef, useState } from "react";
import { CircleAlert, Crosshair, LoaderCircle, Rotate3d } from "lucide-react";
import type { Material, Object3D } from "three";

// ============================================================================
// VISOR 3D RÁPIDO (SOLO LECTURA)
// Muestra piezas .stl, .obj y .3mf dentro de la tarjeta del nodo.
// - Girar: arrastrar con el mouse o el dedo. Zoom: rueda o pellizco.
// - El usuario NO puede escalar ni modificar la pieza: las medidas que se
//   muestran son las reales del archivo y son solo informativas.
// - Three.js se descarga únicamente cuando hay una pieza 3D que mostrar.
// ============================================================================

/** Dimensiones envolventes reales de la pieza, en milímetros. */
export interface ModelDimensions {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

const PREVIEWABLE_EXTENSIONS = ["stl", "obj", "3mf"];

export function isPreviewable3D(extension: string): boolean {
  return PREVIEWABLE_EXTENSIONS.includes(extension.toLowerCase());
}

/** 120 → "120.0" · 35.2 → "35.20" (más decimales en piezas pequeñas). */
export function formatMm(value: number): string {
  return value >= 100 ? value.toFixed(1) : value.toFixed(2);
}

/**
 * Carga bajo demanda. La pieza se descarga y se dibuja sola únicamente si:
 *   - su tarjeta está a la vista en la pantalla, y
 *   - pesa menos que estos límites (archivo recién adjuntado / guardado en la nube).
 * Las piezas más pesadas esperan a que el usuario pulse "Ver pieza en 3D".
 * Además se procesan de una en una, para no saturar la memoria al recargar.
 */
const AUTO_LOAD_LOCAL_LIMIT_BYTES = 50 * 1024 * 1024;
const AUTO_LOAD_CLOUD_LIMIT_BYTES = 15 * 1024 * 1024;

/** Cola global: una sola pieza se descarga y procesa a la vez. */
let loadChain: Promise<void> = Promise.resolve();

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Model3DPreviewProps {
  url: string;
  extension: string;
  fileSizeBytes: number;
  variant: "canvas" | "stack";
  /** Avisa las medidas reales cuando la pieza termina de cargar. */
  onDimensions?: (dimensions: ModelDimensions) => void;
}

type LoadResult =
  | { key: string; phase: "ready"; dimensions: ModelDimensions }
  | { key: string; phase: "error"; message: string };

function disposeMaterial(material: Material | Material[]) {
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material.dispose();
}

export const Model3DPreview: React.FC<Model3DPreviewProps> = ({
  url,
  extension,
  fileSizeBytes,
  variant,
  onDimensions,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const recenterRef = useRef<() => void>(() => {});
  const onDimensionsRef = useRef(onDimensions);
  useEffect(() => {
    onDimensionsRef.current = onDimensions;
  }, [onDimensions]);

  const ext = extension.toLowerCase();
  const key = `${ext}|${url}`;

  const [result, setResult] = useState<LoadResult | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);

  // --- ¿La tarjeta está a la vista? (una vez vista, se queda cargada) --------
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || hasBeenVisible) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setHasBeenVisible(true), 0);
      return () => window.clearTimeout(id);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setHasBeenVisible(true);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [hasBeenVisible]);

  const isCloudFile = /^https?:/.test(url);
  const isHeavy =
    fileSizeBytes > (isCloudFile ? AUTO_LOAD_CLOUD_LIMIT_BYTES : AUTO_LOAD_LOCAL_LIMIT_BYTES);
  const wantsLoad = !isHeavy || manualKey === key;
  const shouldLoad = wantsLoad && hasBeenVisible;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!shouldLoad || !container || !url) return;

    let cancelled = false;
    let cleanup: () => void = () => {};

    const load = async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");

      const response = await fetch(url);
      if (!response.ok) throw new Error("download");

      const accent =
        getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim() ||
        "#C95A3B";
      const partMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(accent),
        roughness: 0.6,
        metalness: 0.08,
        side: THREE.DoubleSide,
      });

      // --- 1. Leer la geometría (nunca se modifica) -------------------------
      let model: Object3D;
      if (ext === "stl") {
        const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
        const geometry = new STLLoader().parse(await response.arrayBuffer());
        if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
        model = new THREE.Mesh(geometry, partMaterial);
      } else if (ext === "obj") {
        const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
        model = new OBJLoader().parse(await response.text());
        model.traverse((child) => {
          const mesh = child as import("three").Mesh;
          if (!mesh.isMesh) return;
          disposeMaterial(mesh.material);
          mesh.material = partMaterial;
          if (!mesh.geometry.hasAttribute("normal")) mesh.geometry.computeVertexNormals();
        });
      } else {
        const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
        model = new ThreeMFLoader().parse(await response.arrayBuffer());
      }

      const disposeModel = () => {
        model.traverse((child) => {
          const mesh = child as import("three").Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          disposeMaterial(mesh.material);
        });
        partMaterial.dispose();
      };

      if (cancelled) {
        disposeModel();
        return;
      }

      // --- 2. Medidas envolventes reales ------------------------------------
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      if (box.isEmpty() || !Number.isFinite(size.length()) || size.length() === 0) {
        disposeModel();
        throw new Error("empty");
      }
      const center = box.getCenter(new THREE.Vector3());
      const radius = size.length() / 2;

      // --- 3. Escena (eje Z hacia arriba, como en las impresoras 3D) --------
      const scene = new THREE.Scene();
      const holder = new THREE.Group();
      holder.position.copy(center).multiplyScalar(-1);
      holder.add(model);
      scene.add(holder);

      const gridSize = Math.max(size.x, size.y) * 1.6 || radius * 2;
      const grid = new THREE.GridHelper(gridSize, 10, 0x8a8a8a, 0x8a8a8a);
      grid.rotation.x = Math.PI / 2;
      grid.position.z = -size.z / 2;
      grid.material.transparent = true;
      grid.material.opacity = 0.3;
      scene.add(grid);

      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);

      const camera = new THREE.PerspectiveCamera(40, width / height, radius / 100, radius * 200);
      camera.up.set(0, 0, 1);
      scene.add(camera);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.3));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.7);
      keyLight.position.set(0.6, 0.8, 1);
      camera.add(keyLight);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.touchAction = "none";
      container.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.zoomSpeed = 0.7;
      controls.minDistance = radius * 0.4;
      controls.maxDistance = radius * 12;

      let needsRender = true;

      /** Coloca la cámara para que la pieza completa quede centrada. */
      const recenter = () => {
        const verticalFov = (camera.fov * Math.PI) / 180;
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.1;
        camera.position.set(1, -1.25, 0.85).normalize().multiplyScalar(distance);
        controls.target.set(0, 0, 0);
        controls.update();
        needsRender = true;
      };
      recenter();
      recenterRef.current = recenter;

      const resizeObserver = new ResizeObserver(() => {
        const w = Math.max(container.clientWidth, 1);
        const h = Math.max(container.clientHeight, 1);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        needsRender = true;
      });
      resizeObserver.observe(container);

      // Solo se redibuja cuando la vista cambia (ahorra batería).
      let frame = 0;
      const tick = () => {
        frame = requestAnimationFrame(tick);
        const moved = controls.update();
        if (moved || needsRender) {
          needsRender = false;
          renderer.render(scene, camera);
        }
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        controls.dispose();
        recenterRef.current = () => {};
        disposeModel();
        grid.geometry.dispose();
        grid.material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };

      const dimensions: ModelDimensions = {
        widthMm: size.x,
        depthMm: size.y,
        heightMm: size.z,
      };
      setResult({ key, phase: "ready", dimensions });
      onDimensionsRef.current?.(dimensions);
    };

    // Espera su turno: nunca hay dos piezas descargándose a la vez.
    const run = loadChain.then(() => (cancelled ? undefined : load()));
    loadChain = run.catch(() => undefined);

    run.catch((error: unknown) => {
      if (cancelled) return;
      const reason = error instanceof Error ? error.message : "";
      setResult({
        key,
        phase: "error",
        message:
          reason === "download"
            ? "No se pudo abrir el archivo para la vista 3D. Puedes descargarlo igualmente."
            : reason === "empty"
              ? "Este archivo no contiene una pieza 3D visible."
              : "No se pudo mostrar esta pieza en 3D. Puedes descargarla igualmente.",
      });
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [key, url, ext, shouldLoad]);

  const dimensions = current?.phase === "ready" ? current.dimensions : null;
  const viewerHeight = variant === "stack" ? "h-56" : "h-44";

  if (!wantsLoad) {
    return (
      <div ref={wrapperRef}>
        <button
          type="button"
          onClick={() => setManualKey(key)}
          className="w-full min-h-[44px] px-3 py-3 rounded-xl border border-dashed border-andros-border-active bg-andros-canvas text-xs font-medium text-andros-primary flex items-center justify-center gap-2 hover:border-andros-accent active:scale-98 spring-micro"
        >
          <Rotate3d className="w-4 h-4 text-andros-accent" />
          <span>Ver pieza en 3D · {formatMegabytes(fileSizeBytes)}</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="space-y-2">
      <div
        data-no-drag
        className={`relative ${viewerHeight} rounded-xl border border-andros-border bg-andros-canvas overflow-hidden cursor-grab active:cursor-grabbing`}
      >
        <div ref={containerRef} className="absolute inset-0" />

        {!current && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-andros-muted pointer-events-none">
            <LoaderCircle className="w-5 h-5 animate-spin text-andros-accent" />
            <span className="text-[11px]">Preparando vista 3D…</span>
          </div>
        )}

        {current?.phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 px-4 text-center text-[11px] leading-relaxed text-andros-muted">
            <CircleAlert className="w-4 h-4 shrink-0 text-andros-accent" />
            <span>{current.message}</span>
          </div>
        )}

        {current?.phase === "ready" && (
          <>
            <span className="absolute left-2 bottom-2 text-[10px] text-andros-muted pointer-events-none select-none">
              Arrastra para girar · rueda o pellizco para acercar
            </span>
            <button
              type="button"
              onClick={() => recenterRef.current()}
              title="Centrar la pieza"
              aria-label="Centrar la pieza"
              className="absolute right-2 top-2 min-h-[32px] px-2.5 rounded-lg bg-andros-card/90 border border-andros-border text-[11px] font-medium text-andros-primary flex items-center gap-1.5 hover:border-andros-accent active:scale-95 spring-micro"
            >
              <Crosshair className="w-3.5 h-3.5 text-andros-accent" />
              <span>Centrar</span>
            </button>
          </>
        )}
      </div>

      {dimensions && (
        <div
          className="rounded-xl bg-andros-canvas border border-andros-border px-3 py-2"
          title="Medidas reales del archivo. No se pueden modificar aquí."
        >
          <div className="flex items-center justify-between text-[10px] text-andros-muted">
            <span>Medidas reales de la pieza</span>
            <span>Solo lectura</span>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-center font-mono tabular-nums">
            {[
              { label: "Ancho", value: dimensions.widthMm },
              { label: "Profundidad", value: dimensions.depthMm },
              { label: "Alto", value: dimensions.heightMm },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs font-semibold text-andros-primary">
                  {formatMm(item.value)} <span className="font-normal text-andros-muted">mm</span>
                </p>
                <p className="text-[10px] font-sans text-andros-muted">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
