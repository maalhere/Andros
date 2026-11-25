// ============================================================================
// ANDROS — AVISO POR CORREO AL COMPARTIR UN ESPACIO (Sprint 16)
// POST { workspaceId, memberId, reason: "added" | "role_changed" }
//
//   1. Identifica a quien llama con SU sesión de Supabase (Bearer o cookies).
//   2. Con esa misma sesión (RLS) comprueba que es el DUEÑO del espacio y que
//      el destinatario está en `workspace_members`; el rol sale de la base,
//      nunca del navegador.
//   3. Lee el correo del destinatario SOLO aquí (clave de servicio, variable
//      de servidor) y lo usa para enviar: jamás se devuelve al navegador.
//   4. Envía con la API REST de Resend (sin SDK).
//
// Resiliencia: compartir YA ocurrió en la base antes de llamar aquí. Cualquier
// fallo responde 200 con `{ sent: false, reason }` para que la interfaz muestre
// una nota discreta, nunca un error que deshaga la acción.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser, getServiceClient, UUID_PATTERN } from "@/lib/supabase/server";
import { buildShareEmail, buildWorkspaceShareLink } from "@/lib/share/shareEmail";
import { normalizeMemberRole } from "@/lib/access/permissions";
import { SITE_URL } from "@/lib/site";

type ShareNotifyReason =
  | "not_configured"
  | "no_email"
  | "throttled"
  | "send_failed";

interface ShareNotifyResponse {
  sent: boolean;
  reason?: ShareNotifyReason;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Andros <onboarding@resend.dev>";
const SEND_TIMEOUT_MS = 8_000;

/** Un mismo aviso (espacio + persona + permiso) como máximo cada 60 s. */
const THROTTLE_MS = 60_000;
/** Tope por dueño y hora: frena el envío masivo si alguien abusa del botón. */
const HOURLY_LIMIT_PER_OWNER = 40;
const recentKeys = new Map<string, number>();
const ownerCounts = new Map<string, { hour: number; n: number }>();

function throttled(ownerId: string, key: string): boolean {
  const now = Date.now();
  if (recentKeys.size > 5_000) recentKeys.clear();
  const last = recentKeys.get(key);
  if (last && now - last < THROTTLE_MS) return true;
  const hour = Math.floor(now / 3_600_000);
  const entry = ownerCounts.get(ownerId);
  if (entry && entry.hour === hour && entry.n >= HOURLY_LIMIT_PER_OWNER) return true;
  recentKeys.set(key, now);
  if (!entry || entry.hour !== hour) ownerCounts.set(ownerId, { hour, n: 1 });
  else entry.n += 1;
  return false;
}

const ok = (body: ShareNotifyResponse) =>
  NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, message: string) =>
  NextResponse.json({ sent: false, error: message }, { status, headers: { "Cache-Control": "no-store" } });

function displayName(profile: Record<string, unknown> | null, fallback: string): string {
  if (!profile) return fallback;
  const full = typeof profile.full_name === "string" ? profile.full_name.trim() : "";
  const username = typeof profile.username === "string" && profile.username ? `@${profile.username}` : "";
  return full || username || fallback;
}

/** Origen público para el enlace del correo (nunca `localhost` en producción). */
function publicOrigin(request: NextRequest): string {
  try {
    const site = new URL(SITE_URL);
    if (process.env.NODE_ENV === "production") return site.origin;
  } catch {
    /* SITE_URL inválida: se usa el origen de la petición */
  }
  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Petición inválida.");
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const memberId = typeof body.memberId === "string" ? body.memberId : "";
  const reason = body.reason === "role_changed" ? "role_changed" : "added";
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(memberId)) {
    return fail(400, "Faltan el espacio o la persona.");
  }

  const caller = await getRequestUser(request);
  if (!caller) return fail(401, "Inicia sesión para compartir.");
  if (caller.userId === memberId) return fail(400, "No puedes avisarte a ti mismo.");

  // 2. Permisos con la sesión de quien llama (RLS): dueño + miembro real.
  const { data: workspace, error: wsError } = await caller.supabase
    .from("workspaces")
    .select("id, name, owner_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (wsError || !workspace || workspace.owner_id !== caller.userId) {
    return fail(403, "Solo el dueño del espacio puede enviar este aviso.");
  }
  const { data: membership, error: memberError } = await caller.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", memberId)
    .maybeSingle();
  if (memberError || !membership) return fail(404, "Esa persona no es miembro del espacio.");
  const role = normalizeMemberRole(membership.role);

  // 3. Sin proveedor de correo configurado: no pasa nada, se avisa con calma.
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const service = getServiceClient();
  if (!apiKey || !service) return ok({ sent: false, reason: "not_configured" });

  if (throttled(caller.userId, `${workspaceId}:${memberId}:${role}`)) {
    return ok({ sent: false, reason: "throttled" });
  }

  const [{ data: recipient }, { data: owner }] = await Promise.all([
    service.from("profiles").select("email, full_name, username").eq("id", memberId).maybeSingle(),
    service.from("profiles").select("full_name, username").eq("id", caller.userId).maybeSingle(),
  ]);
  const email = typeof recipient?.email === "string" ? recipient.email.trim() : "";
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254) {
    return ok({ sent: false, reason: "no_email" });
  }

  const message = buildShareEmail({
    ownerName: displayName(owner as Record<string, unknown> | null, "Alguien"),
    recipientName: displayName(recipient as Record<string, unknown> | null, ""),
    workspaceName: typeof workspace.name === "string" ? workspace.name : "",
    role,
    link: buildWorkspaceShareLink(publicOrigin(request), workspaceId),
    reason,
  });

  // 4. Resend (REST). Cualquier fallo → `send_failed`, sin exponer detalles.
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM,
        to: [email],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[Andros · share-notify] Resend respondió ${response.status}.`);
      return ok({ sent: false, reason: "send_failed" });
    }
  } catch {
    console.warn("[Andros · share-notify] No se pudo contactar con Resend.");
    return ok({ sent: false, reason: "send_failed" });
  }

  return ok({ sent: true });
}
