"use client";

import React, { useEffect, useRef, useState } from "react";
import { CircleAlert, Crosshair, LoaderCircle, Rotate3d } from "lucide-react";
import type { Material, Object3D } from "three";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { IDENTITY_SCALE, isIdentityScale, scaleDimensions, type ModelScale } from "@/lib/3d/modelScale";
import { formatMm, type ModelDimensions } from "@/lib/3d/fileKinds";
import {
  AutoSupportsToggle,
  ModelScalePanel,
  PreparedStlButton,
  type SupportStatus,
} from "@/components/nodes/ModelPrepControls";

// ============================================================================
// VISOR 3D DEL NODO
// Muestra piezas .stl, .obj y .3mf dentro de la tarjeta del nodo.
// - Girar: arrastrar con el mouse o el dedo. Zoom: rueda o pellizco.
// - Escala en tiempo real (% o mm por eje) sobre una cama de 150 × 150 mm.
// - Soportes automáticos (45°) en verde translúcido y descarga del .stl
//   preparado (escala aplicada + pilares fusionados).
// - El archivo original nunca se modifica: la escala vive en el nodo.
// - Three.js se descarga únicamente cuando hay una pieza 3D que mostrar.
// ============================================================================

/**
 * Carga bajo demanda. La pieza se descarga y se dibuja sola únicamente si:
 *   - su tarjeta está a la vista en la pantalla, y
 *   - pesa menos que estos límites (archivo recién adjuntado / guardado en la nube).
 * Las piezas más pesadas esperan a que el usuario pulse "Ver pieza en 3D".
 * Además se procesan de una en una, para no saturar la memoria al recargar.
 */
const AUTO_LOAD_LOCAL_LIMIT_BYTES = 50 * 1024 * 1024;
const AUTO_LOAD_CLOUD_LIMIT_BYTES = 15 * 1024 * 1024;

/** Cama de la FlashForge Adventurer 3 (referencia visual en el visor). */
const BED_MM = 150;

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
  /** Avisa las medidas ORIGINALES (al 100 %) cuando la pieza termina de cargar. */
  onDimensions?: (dimensions: ModelDimensions) => void;
  /** Escala guardada en el nodo. */
  scale?: ModelScale;
  /** Sin esta función el visor es de solo lectura (sin controles de escala). */
  onScaleChange?: (scale: ModelScale) => void;
  supportsEnabled?: boolean;
  onSupportsChange?: (enabled: boolean) => void;
  /** Nombre de la pieza para el .stl preparado. */
  pieceName?: string;
}

type LoadResult =
  | { key: string; phase: "ready"; dimensions: ModelDimensions }
  | { key: string; phase: "error"; message: string };

type SupportResultState =
  | { key: string; phase: "ready"; soup: Float32Array; count: number; capped: boolean }
  | { key: string; phase: "error" };

/** Lo que el componente puede pedirle a la escena Three.js ya montada. */
interface ViewerApi {
  applyScale: (scale: ModelScale) => void;
  setSupports: (soup: Float32Array | null) => void;
  /** Triángulos de la pieza original (sin escalar), calculados una sola vez. */
  getSoup: () => Promise<Float32Array>;
}

/** Libera el material y TODAS sus texturas (map, normalMap, roughnessMap…). */
function disposeMaterial(material: Material | Material[]) {
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    for (const value of Object.values(m)) {
      const texture = value as { isTexture?: boolean; dispose?: () => void } | null;
      if (texture && typeof texture === "object" && texture.isTexture && typeof texture.dispose === "function") {
        texture.dispose();
      }
    }
    m.dispose();
  }
}

function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export const Model3DPreview: React.FC<Model3DPreviewProps> = ({
  url,
  extension,
  fileSizeBytes,
  variant,
  onDimensions,
  scale = IDENTITY_SCALE,
  onScaleChange,
  supportsEnabled = false,
  onSupportsChange,
  pieceName = "pieza",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const recenterRef = useRef<() => void>(() => {});
  const viewerRef = useRef<ViewerApi | null>(null);
  const onDimensionsRef = useRef(onDimensions);
  useEffect(() => {
    onDimensionsRef.current = onDimensions;
  }, [onDimensions]);

  const [sx, sy, sz] = scale;
  const scaleRef = useRef<ModelScale>([sx, sy, sz]);
  useEffect(() => {
    scaleRef.current = [sx, sy, sz];
  }, [sx, sy, sz]);

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
  const isReady = current?.phase === "ready";

  // --- Montaje de la escena ---------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!shouldLoad || !container || !url) return;

    let cancelled = false;
    let cleanup: () => void = () => {};
    // Al desmontar o cambiar de archivo, la descarga en curso se cancela.
    const download = new AbortController();

    const load = async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { createSupportMesh } = await import("@/lib/3d/autoSupports");

      const response = await fetch(url, { signal: download.signal });
      if (!response.ok) throw new Error("download");

      const partMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(cssColor("--accent-primary", "#C95A3B")),
        roughness: 0.6,
        metalness: 0.08,
        side: THREE.DoubleSide,
      });

      // --- 1. Leer la geometría (el archivo nunca se modifica) --------------
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

      // --- 2. Medidas envolventes reales (exactas, vértice a vértice) -------
      const box = new THREE.Box3().setFromObject(model, true);
      const baseSize = box.getSize(new THREE.Vector3());
      if (box.isEmpty() || !Number.isFinite(baseSize.length()) || baseSize.length() === 0) {
        disposeModel();
        throw new Error("empty");
      }
      const baseCenter = box.getCenter(new THREE.Vector3());
      const baseMinZ = box.min.z;

      // --- 3. Escena (eje Z hacia arriba, como en las impresoras 3D) --------
      //   stage ─┬─ partGroup (escala + apoyo en Z = 0) ── model
      //          ├─ soportes (ya calculados en el sistema de la escena)
      //          └─ cama de 150 × 150 mm
      const scene = new THREE.Scene();
      const stage = new THREE.Group();
      const partGroup = new THREE.Group();
      partGroup.add(model);
      stage.add(partGroup);
      scene.add(stage);

      const grid = new THREE.GridHelper(BED_MM, 15, 0x8a8a8a, 0x8a8a8a);
      grid.rotation.x = Math.PI / 2;
      grid.material.transparent = true;
      grid.material.opacity = 0.3;
      stage.add(grid);

      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);

      const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 10000);
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

      let needsRender = true;
      let radius = baseSize.length() / 2;
      const scaledSize = new THREE.Vector3();

      /** Aplica la escala sin mover la cámara: se ve crecer la pieza sobre la cama. */
      const applyScale = (next: ModelScale) => {
        partGroup.scale.set(next[0], next[1], next[2]);
        partGroup.position.set(-baseCenter.x * next[0], -baseCenter.y * next[1], -baseMinZ * next[2]);
        scaledSize.set(baseSize.x * next[0], baseSize.y * next[1], baseSize.z * next[2]);
        radius = scaledSize.length() / 2 || 1;

        const target = new THREE.Vector3(0, 0, scaledSize.z / 2);
        camera.position.add(target.clone().sub(controls.target));
        controls.target.copy(target);
        const reach = Math.max(radius, BED_MM / 2);
        camera.near = Math.max(radius / 200, 0.01);
        camera.far = reach * 400;
        camera.updateProjectionMatrix();
        controls.minDistance = radius * 0.4;
        controls.maxDistance = reach * 12;
        controls.update();
        needsRender = true;
      };

      /** Coloca la cámara para que la pieza completa quede centrada. */
      const recenter = () => {
        const verticalFov = (camera.fov * Math.PI) / 180;
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.1;
        controls.target.set(0, 0, scaledSize.z / 2);
        camera.position
          .set(1, -1.25, 0.85)
          .normalize()
          .multiplyScalar(distance)
          .add(controls.target);
        controls.update();
        needsRender = true;
      };

      applyScale(scaleRef.current);
      recenter();
      recenterRef.current = recenter;

      // --- 4. Soportes ------------------------------------------------------
      const supportColor = cssColor("--accent-success", "#4F6B58");
      let supportMesh: ReturnType<typeof createSupportMesh> | null = null;
      const setSupports = (soup: Float32Array | null) => {
        if (supportMesh) {
          stage.remove(supportMesh);
          supportMesh.geometry.dispose();
          supportMesh.material.dispose();
          supportMesh = null;
        }
        if (soup && soup.length > 0) {
          supportMesh = createSupportMesh(THREE, soup, supportColor);
          stage.add(supportMesh);
        }
        needsRender = true;
      };

      let soupPromise: Promise<Float32Array> | null = null;
      const getSoup = () => {
        soupPromise ??= import("@/lib/slicer/meshLoader").then(({ extractTriangleSoup }) =>
          extractTriangleSoup(model, THREE, { relativeTo: partGroup })
        );
        return soupPromise;
      };

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

      viewerRef.current = { applyScale, setSupports, getSoup };

      cleanup = () => {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        controls.dispose();
        recenterRef.current = () => {};
        viewerRef.current = null;
        setSupports(null);
        disposeModel();
        grid.geometry.dispose();
        grid.material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };

      const dimensions: ModelDimensions = {
        widthMm: baseSize.x,
        depthMm: baseSize.y,
        heightMm: baseSize.z,
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
      download.abort();
      cleanup();
    };
  }, [key, url, ext, shouldLoad]);

  // --- Escala en vivo ---------------------------------------------------------
  useEffect(() => {
    if (isReady) viewerRef.current?.applyScale([sx, sy, sz]);
  }, [isReady, sx, sy, sz]);

  // --- Soportes automáticos (se recalculan al cambiar la escala) -------------
  const [supportResult, setSupportResult] = useState<SupportResultState | null>(null);
  const supportKey = isReady && supportsEnabled ? `${key}|${sx},${sy},${sz}` : null;
  const supportView = supportKey && supportResult?.key === supportKey ? supportResult : null;

  useEffect(() => {
    const api = viewerRef.current;
    // Mientras se recalcula no se muestran pilares de otra escala.
    api?.setSupports(null);
    if (!supportKey || !api) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { generateAutoSupports, scaleAndGroundSoup } = await import("@/lib/3d/autoSupports");
          const grounded = scaleAndGroundSoup(await api.getSoup(), [sx, sy, sz]);
          const supports = await generateAutoSupports(grounded, { signal: controller.signal });
          if (controller.signal.aborted) return;
          api.setSupports(supports.soup);
          setSupportResult({
            key: supportKey,
            phase: "ready",
            soup: supports.soup,
            count: supports.pillars.length,
            capped: supports.capped,
          });
        } catch {
          if (!controller.signal.aborted) setSupportResult({ key: supportKey, phase: "error" });
        }
      })();
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [supportKey, sx, sy, sz]);

  const supportStatus: SupportStatus = !supportsEnabled
    ? { phase: "off" }
    : !supportView
      ? { phase: "computing" }
      : supportView.phase === "error"
        ? { phase: "error" }
        : { phase: "ready", count: supportView.count, capped: supportView.capped };

  // --- Descarga del .stl preparado ---------------------------------------------
  const { pending: exporting, run: runExport } = useSubmitGuard();
  const exportStl = () =>
    void runExport(async () => {
      const api = viewerRef.current;
      if (!api) return;
      const currentScale: ModelScale = [sx, sy, sz];
      const soup = await api.getSoup();
      let supportsSoup: Float32Array | null = null;
      if (supportsEnabled) {
        if (supportView?.phase === "ready") {
          supportsSoup = supportView.soup;
        } else {
          const { generateAutoSupports, scaleAndGroundSoup } = await import("@/lib/3d/autoSupports");
          supportsSoup = (await generateAutoSupports(scaleAndGroundSoup(soup, currentScale))).soup;
        }
      }
      const { downloadPreparedStl } = await import("@/lib/3d/exportStl");
      await downloadPreparedStl({ soup, scale: currentScale, supportsSoup, pieceName });
    });

  const baseDimensions = current?.phase === "ready" ? current.dimensions : null;
  const shownDimensions = baseDimensions ? scaleDimensions(baseDimensions, scale) : null;
  const scaled = !isIdentityScale(scale);
  const viewerHeight = variant === "stack" ? "h-56" : "h-44";
  const touch = variant === "stack" ? "min-h-[44px]" : "min-h-[34px]";

  if (!wantsLoad) {
    return (
      <div ref={wrapperRef}>
        <button
          type="button"
          onClick={() => setManualKey(key)}
          className="w-full min-h-[44px] px-3 py-3 rounded-xl border border-dashed border-andros-border-active bg-andros-canvas text-xs font-medium text-andros-primary flex items-center justify-center gap-2 hover:border-andros-accent active:scale-98 spring-micro"
        >
          <Rotate3d className="w-4 h-4 text-andros-accent-ink" />
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
            <LoaderCircle className="w-5 h-5 animate-spin text-andros-accent-ink" />
            <span className="text-[11px]">Preparando vista 3D…</span>
          </div>
        )}

        {current?.phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 px-4 text-center text-[11px] leading-relaxed text-andros-muted">
            <CircleAlert className="w-4 h-4 shrink-0 text-andros-accent-ink" />
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
              <Crosshair className="w-3.5 h-3.5 text-andros-accent-ink" />
              <span>Centrar</span>
            </button>
          </>
        )}
      </div>

      {shownDimensions && (
        <div
          className="rounded-xl bg-andros-canvas border border-andros-border px-3 py-2"
          title={
            scaled
              ? "Medidas con la escala aplicada. El archivo original no se modifica."
              : "Medidas reales del archivo."
          }
        >
          <div className="flex items-center justify-between text-[10px] text-andros-muted">
            <span>{scaled ? "Medidas a escala" : "Medidas reales de la pieza"}</span>
            <span>Cama 150 × 150 mm</span>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-center font-mono tabular-nums">
            {[
              { label: "Ancho", value: shownDimensions.widthMm },
              { label: "Profundidad", value: shownDimensions.depthMm },
              { label: "Alto", value: shownDimensions.heightMm },
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

      {baseDimensions && onScaleChange && (
        <ModelScalePanel baseDims={baseDimensions} scale={scale} onChange={onScaleChange} variant={variant} />
      )}

      {baseDimensions && onSupportsChange && (
        <AutoSupportsToggle
          enabled={supportsEnabled}
          onChange={onSupportsChange}
          status={supportStatus}
          variant={variant}
        />
      )}

      {baseDimensions && onScaleChange && (
        <PreparedStlButton
          onClick={exportStl}
          pending={exporting}
          className={`w-full ${touch} px-3 rounded-xl border border-andros-border-active bg-andros-card text-xs font-semibold text-andros-primary flex items-center justify-center gap-2 hover:border-andros-accent active:scale-[0.98] spring-micro disabled:opacity-60`}
        />
      )}
    </div>
  );
};
