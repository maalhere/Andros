// ============================================================================
// ANDROS — TELEMETRÍA OPCIONAL Y RESPETUOSA (Microsoft Clarity + PostHog)
//
//   · Apagada por defecto: sin NEXT_PUBLIC_CLARITY_ID ni NEXT_PUBLIC_POSTHOG_KEY
//     no se hace ninguna petición de red ni se escribe nada.
//   · Solo tras «Aceptar todas» en el aviso de cookies (src/lib/consent.ts).
//     Retirar el consentimiento apaga Clarity y borra el identificador anónimo.
//   · PostHog sin librería: cada evento es un POST pequeño a la API de captura,
//     sin autocaptura, sin grabación, sin perfiles de persona y sin GeoIP.
//   · Lista cerrada de eventos y de propiedades: solo identificadores cortos,
//     números y booleanos. Nunca texto de notas, fichas, fórmulas, chats IA,
//     nombres de espacios o personas, URLs con tokens ni claves BYOK.
//   · Clarity graba la sesión con el contenido sensible enmascarado
//     (data-clarity-mask="true" en tarjetas, chats IA, fichas y fórmulas).
// ============================================================================

import { hasAnalyticsConsent } from "@/lib/consent";

// Next.js sustituye estas variables en el build (acceso literal obligatorio).
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID?.trim() ?? "";
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "";
const POSTHOG_HOST_RAW = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ?? "";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const DISTINCT_ID_KEY = "andros-telemetry-id";
const CLARITY_SCRIPT_ID = "andros-clarity";

export const TELEMETRY_EVENTS = [
  "workspace_created",
  "blueprint_generated",
  "form_autofilled",
  "formula_created",
  "deliverable_exported",
  "guest_link_enabled",
  "voice_joined",
  "printer_selected",
] as const;

export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number];

type Primitive = string | number | boolean;

/** Propiedades permitidas por evento (lo demás se descarta). */
export interface TelemetryProps {
  workspace_created: { seeded?: boolean };
  blueprint_generated: { source: "ai" | "template" | "base" };
  form_autofilled: { created?: number; updated?: number; fields?: number };
  formula_created: { source: "preset" | "ai" };
  deliverable_exported: { type: "pdf" | "docx" | "pptx" | "whatsapp"; ai?: boolean };
  guest_link_enabled: { rotated?: boolean };
  voice_joined: { mode: "cloud" | "local" };
  printer_selected: { printer: string; ecosystem: string };
}

const ALLOWED_KEYS: { [E in TelemetryEvent]: readonly (keyof TelemetryProps[E])[] } = {
  workspace_created: ["seeded"],
  blueprint_generated: ["source"],
  form_autofilled: ["created", "updated", "fields"],
  formula_created: ["source"],
  deliverable_exported: ["type", "ai"],
  guest_link_enabled: ["rotated"],
  voice_joined: ["mode"],
  printer_selected: ["printer", "ecosystem"],
};

/** Solo identificadores cortos (sin espacios): nunca texto libre del usuario. */
const SAFE_STRING = /^[a-z0-9][a-z0-9_.-]{0,47}$/i;

/** Filtra las propiedades: claves permitidas y valores primitivos seguros. */
export function sanitizeProps<E extends TelemetryEvent>(event: E, props: unknown): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  if (!props || typeof props !== "object") return out;
  const allowed = ALLOWED_KEYS[event] as readonly string[];
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (!allowed.includes(key)) continue;
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.round(value * 100) / 100;
    else if (typeof value === "string" && SAFE_STRING.test(value)) out[key] = value;
  }
  return out;
}

function posthogHost(): string | null {
  const raw = POSTHOG_HOST_RAW || DEFAULT_POSTHOG_HOST;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export const isClarityConfigured = () => /^[a-z0-9]{6,20}$/i.test(CLARITY_ID);
export const isPosthogConfigured = () => /^phc_[A-Za-z0-9]{16,80}$/.test(POSTHOG_KEY) && posthogHost() !== null;
export const isTelemetryConfigured = () => isClarityConfigured() || isPosthogConfigured();

function distinctId(): string | null {
  try {
    let id = window.localStorage.getItem(DISTINCT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DISTINCT_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * Registra un evento de producto. No hace nada (ni red ni almacenamiento) si
 * PostHog no está configurado, si no hay consentimiento o fuera del navegador.
 */
export function track<E extends TelemetryEvent>(event: E, props?: TelemetryProps[E]): void {
  if (typeof window === "undefined" || !isPosthogConfigured() || !hasAnalyticsConsent()) return;
  if (!(TELEMETRY_EVENTS as readonly string[]).includes(event)) return;
  const host = posthogHost();
  const id = distinctId();
  if (!host || !id) return;
  const body = JSON.stringify({
    api_key: POSTHOG_KEY,
    event,
    distinct_id: id,
    timestamp: new Date().toISOString(),
    properties: {
      ...sanitizeProps(event, props),
      $process_person_profile: false,
      $geoip_disable: true,
      $lib: "andros-lite",
      surface: window.matchMedia?.("(min-width: 768px)").matches ? "desktop" : "mobile",
      app: window.androsDesktop?.isDesktop ? "windows" : "web",
    },
  });
  try {
    // text/plain evita la petición previa CORS; PostHog lee el JSON igual.
    void fetch(`${host}/i/v0/e/`, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "text/plain" },
    }).catch(() => {});
  } catch {
    // La medición nunca rompe la app.
  }
}

// ---------------------------------------------------------------------------
// Microsoft Clarity (solo lo llama TelemetryProvider, tras el consentimiento)
// ---------------------------------------------------------------------------

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

declare global {
  interface Window {
    clarity?: ClarityFn;
  }
}

export function startClarity(): void {
  if (typeof window === "undefined" || !isClarityConfigured() || !hasAnalyticsConsent()) return;
  if (!document.getElementById(CLARITY_SCRIPT_ID)) {
    const queue: ClarityFn =
      window.clarity ??
      Object.assign(
        (...args: unknown[]) => {
          (queue.q = queue.q ?? []).push(args);
        },
        { q: [] as unknown[][] }
      );
    window.clarity = queue;
    const script = document.createElement("script");
    script.id = CLARITY_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_ID)}`;
    document.head.appendChild(script);
  }
  // API de consentimiento de Clarity: permite sus cookies solo con permiso.
  window.clarity?.("consent");
}

/** Retirar el consentimiento: Clarity deja de grabar y se borra el id anónimo. */
export function stopTelemetry(): void {
  if (typeof window === "undefined") return;
  try {
    window.clarity?.("consent", false);
  } catch {
    // Clarity aún no había cargado.
  }
  document.getElementById(CLARITY_SCRIPT_ID)?.remove();
  try {
    window.localStorage.removeItem(DISTINCT_ID_KEY);
  } catch {
    // Sin acceso a localStorage.
  }
}
