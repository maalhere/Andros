"use client";

// ============================================================================
// ANDROS — DISPOSITIVOS DE AUDIO Y VÍDEO (micrófono, salida y cámara)
//   · Lista reactiva con `enumerateDevices()` + evento `devicechange`
//     (audífonos Bluetooth/USB que se conectan o desconectan).
//   · La elección se guarda en localStorage (solo en este equipo).
//   · El cambio en caliente (replaceTrack / setSinkId) lo hace useCollabRoom.
// ============================================================================

import { useEffect } from "react";
import { create } from "zustand";

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export type MediaDeviceKind = "mic" | "speaker" | "camera";

const STORAGE_KEYS: Record<MediaDeviceKind, string> = {
  mic: "andros:media:selectedMicId",
  speaker: "andros:media:selectedSpeakerId",
  camera: "andros:media:selectedCameraId",
};

function readStored(kind: MediaDeviceKind): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEYS[kind]) ?? "";
  } catch {
    return "";
  }
}

function writeStored(kind: MediaDeviceKind, id: string): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEYS[kind], id);
    else window.localStorage.removeItem(STORAGE_KEYS[kind]);
  } catch {
    /* sin localStorage: la elección dura solo esta sesión */
  }
}

/** `true` si el navegador deja elegir la salida de audio (`setSinkId`). */
export function supportsSpeakerSelection(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

interface MediaDevicesState {
  mics: MediaDeviceOption[];
  speakers: MediaDeviceOption[];
  cameras: MediaDeviceOption[];
  /** `""` = dispositivo predeterminado del sistema. */
  selectedMicId: string;
  selectedSpeakerId: string;
  selectedCameraId: string;
  /** Se cargó la elección guardada en localStorage. */
  hydrated: boolean;

  setLists: (lists: Pick<MediaDevicesState, "mics" | "speakers" | "cameras">) => void;
  setSelected: (kind: MediaDeviceKind, deviceId: string) => void;
  hydrate: () => void;
}

const SELECTED_KEY: Record<MediaDeviceKind, "selectedMicId" | "selectedSpeakerId" | "selectedCameraId"> = {
  mic: "selectedMicId",
  speaker: "selectedSpeakerId",
  camera: "selectedCameraId",
};

export const useMediaDevicesStore = create<MediaDevicesState>((set, get) => ({
  mics: [],
  speakers: [],
  cameras: [],
  selectedMicId: "",
  selectedSpeakerId: "",
  selectedCameraId: "",
  hydrated: false,

  setLists: (lists) => set(lists),
  setSelected: (kind, deviceId) => {
    writeStored(kind, deviceId);
    set({ [SELECTED_KEY[kind]]: deviceId } as Partial<MediaDevicesState>);
  },
  hydrate: () => {
    if (get().hydrated) return;
    set({
      selectedMicId: readStored("mic"),
      selectedSpeakerId: readStored("speaker"),
      selectedCameraId: readStored("camera"),
      hydrated: true,
    });
  },
}));

/** Lee la elección guardada (por si aún no se montó `useMediaDevices`). */
export function selectedDeviceId(kind: MediaDeviceKind): string {
  const store = useMediaDevicesStore.getState();
  store.hydrate();
  return useMediaDevicesStore.getState()[SELECTED_KEY[kind]];
}

/** Vuelve a listar los dispositivos (las etiquetas aparecen tras dar permiso). */
export async function refreshMediaDevices(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return;
  }
  const build = (kind: MediaDeviceInfo["kind"], fallback: string): MediaDeviceOption[] => {
    const seen = new Set<string>();
    const list: MediaDeviceOption[] = [];
    let index = 0;
    for (const device of devices) {
      if (device.kind !== kind) continue;
      index += 1;
      // "default"/"communications" son alias del sistema: se ofrece «Predeterminado» aparte.
      if (!device.deviceId || device.deviceId === "default" || device.deviceId === "communications") continue;
      if (seen.has(device.deviceId)) continue;
      seen.add(device.deviceId);
      list.push({ deviceId: device.deviceId, label: device.label.trim() || `${fallback} ${index}` });
    }
    return list;
  };
  useMediaDevicesStore.getState().setLists({
    mics: build("audioinput", "Micrófono"),
    speakers: build("audiooutput", "Salida"),
    cameras: build("videoinput", "Cámara"),
  });
}

/** Mantiene la lista al día mientras el componente está montado. */
export function useMediaDevices(): void {
  useEffect(() => {
    useMediaDevicesStore.getState().hydrate();
    void refreshMediaDevices();
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const onChange = () => void refreshMediaDevices();
    media.addEventListener("devicechange", onChange);
    return () => media.removeEventListener("devicechange", onChange);
  }, []);
}
