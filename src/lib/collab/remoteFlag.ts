// ============================================================================
// ANDROS — MARCA DE "CAMBIO REMOTO" (sin dependencias, para evitar ciclos)
//
// Cuando la sala en vivo aplica al lienzo un cambio que llegó por Broadcast,
// lo envuelve en `runAsRemoteCollab`. Mientras dura:
//   · `canvasSync` NO lo vuelve a emitir (sin bucles de red).
//   · `useCloudSync` NO programa un autoguardado si el cambio vino de otro
//     equipo del MISMO usuario (ese equipo ya lo guarda). Si vino de un
//     invitado (otra cuenta), el dueño sí lo guarda: solo él tiene permiso.
// Zustand notifica a sus suscriptores de forma síncrona dentro de `set`, así
// que la marca cubre exactamente ese cambio.
// ============================================================================

let depth = 0;
let persist = false;

export function runAsRemoteCollab(apply: () => void, options: { persist: boolean }): void {
  const previousPersist = persist;
  depth += 1;
  persist = options.persist;
  try {
    apply();
  } finally {
    depth -= 1;
    persist = previousPersist;
  }
}

/** `true` mientras se aplica un cambio recibido de la sala. */
export function isApplyingRemoteCollab(): boolean {
  return depth > 0;
}

/** `true` si el cambio remoto actual NO debe disparar el autoguardado local. */
export function shouldSkipAutosaveForRemote(): boolean {
  return depth > 0 && !persist;
}
