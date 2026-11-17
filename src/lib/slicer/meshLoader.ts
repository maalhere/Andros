// ============================================================================
// ANDROS — CARGA DE PIEZAS 3D COMO "SOPA DE TRIÁNGULOS"
// Lee .stl / .obj / .3mf con los cargadores de Three.js (los mismos que usa el
// visor 3D) y devuelve todos los triángulos en coordenadas del mundo:
//   [x0,y0,z0, x1,y1,z1, x2,y2,z2,  ...]  (9 números por triángulo, en mm)
// Se respeta la orientación del visor: el eje Z es "arriba".
// ============================================================================

const SLICEABLE_EXTENSIONS = ["stl", "obj", "3mf"];

/** ¿Andros puede laminar este archivo automáticamente? */
export function isSliceable(extension: string): boolean {
  return SLICEABLE_EXTENSIONS.includes(extension.toLowerCase());
}

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function triangleBounds(positions: Float32Array): MeshBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/** Descarga el archivo y lo convierte en triángulos (sin modificar la pieza). */
export async function loadTriangleSoup(url: string, extension: string): Promise<Float32Array> {
  const ext = extension.toLowerCase();
  if (!isSliceable(ext)) throw new Error("unsupported");

  const response = await fetch(url);
  if (!response.ok) throw new Error("download");

  const THREE = await import("three");
  let root: import("three").Object3D;

  if (ext === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geometry = new STLLoader().parse(await response.arrayBuffer());
    root = new THREE.Mesh(geometry);
  } else if (ext === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    root = new OBJLoader().parse(await response.text());
  } else {
    const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
    root = new ThreeMFLoader().parse(await response.arrayBuffer());
  }

  root.updateMatrixWorld(true);

  const chunks: Float32Array[] = [];
  let total = 0;
  const v = new THREE.Vector3();

  root.traverse((child) => {
    const mesh = child as import("three").Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    const triCount = Math.floor(count / 3);
    const out = new Float32Array(triCount * 9);
    for (let i = 0; i < triCount * 3; i += 1) {
      const vi = index ? index.getX(i) : i;
      v.fromBufferAttribute(position, vi).applyMatrix4(mesh.matrixWorld);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
    chunks.push(out);
    total += out.length;
    mesh.geometry.dispose();
  });

  if (total === 0) throw new Error("empty");

  const soup = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    soup.set(chunk, offset);
    offset += chunk.length;
  }
  return soup;
}
