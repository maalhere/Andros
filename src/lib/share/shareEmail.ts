// ============================================================================
// ANDROS — CORREO «TE COMPARTIERON UN ESPACIO» (función pura, sin red)
// Lo usa /api/workspaces/share-notify. HTML sobrio con estilos en línea (los
// clientes de correo ignoran <style>), versión de texto plano y todo el
// contenido variable escapado (nombres y títulos los escribe el usuario).
// ============================================================================

import { ROLE_DESCRIPTIONS, ROLE_LABELS, type MemberRole } from "@/lib/access/permissions";

export interface ShareEmailInput {
  ownerName: string;
  recipientName: string;
  workspaceName: string;
  role: MemberRole;
  /** Enlace absoluto al espacio: `<origen>/?espacio=<id>`. */
  link: string;
  /** `role_changed` cuando el dueño solo cambió el permiso. */
  reason: "added" | "role_changed";
}

export interface ShareEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Recorta y quita saltos de línea (evita cabeceras rotas en el asunto). */
function clean(value: string, max: number, fallback: string): string {
  const text = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return text || fallback;
}

/** Enlace directo al espacio a partir del origen público del sitio. */
export function buildWorkspaceShareLink(origin: string, workspaceId: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("espacio", workspaceId);
  return url.toString();
}

export function buildShareEmail(input: ShareEmailInput): ShareEmail {
  const owner = clean(input.ownerName, 80, "Alguien");
  const recipient = clean(input.recipientName, 80, "");
  const board = clean(input.workspaceName, 100, "Sin nombre");
  const roleLabel = ROLE_LABELS[input.role];
  const roleHelp = ROLE_DESCRIPTIONS[input.role];
  const changed = input.reason === "role_changed";

  const subject = changed
    ? `${owner} cambió tu permiso en «${board}»: ${roleLabel}`
    : `${owner} compartió contigo «${board}» en Andros`;

  const greeting = recipient ? `Hola, ${recipient}:` : "Hola:";
  const lead = changed
    ? `${owner} cambió tu permiso en el tablero «${board}».`
    : `${owner} compartió contigo el tablero «${board}» en Andros.`;

  const text = [
    greeting,
    "",
    lead,
    `Permiso: ${roleLabel}. ${roleHelp}`,
    "",
    `Abrir el espacio: ${input.link}`,
    "",
    "Recibes este aviso porque te añadieron a un espacio compartido de Andros.",
    "Si no conoces a esta persona, puedes salir del espacio desde «Compartir».",
  ].join("\n");

  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#F6F5F2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F5F2;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E4E2DC;border-radius:16px;">
        <tr><td style="padding:28px 28px 8px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1A1A18;">
          <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#9C4127;">Andros</p>
          <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.35;font-weight:600;color:#1A1A18;">${e(changed ? "Tu permiso cambió" : "Te compartieron un espacio")}</h1>
          <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">${e(greeting)}</p>
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">${e(lead)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px 0;border:1px solid #E4E2DC;border-radius:12px;">
            <tr><td style="padding:12px 14px;font-size:14px;line-height:1.5;">
              <span style="display:block;color:#5F5E58;font-size:12px;">Tablero</span>
              <strong style="color:#1A1A18;">${e(board)}</strong>
            </td></tr>
            <tr><td style="padding:0 14px 12px 14px;font-size:14px;line-height:1.5;">
              <span style="display:block;color:#5F5E58;font-size:12px;">Permiso</span>
              <strong style="color:#1A1A18;">${e(roleLabel)}</strong>
              <span style="display:block;color:#5F5E58;">${e(roleHelp)}</span>
            </td></tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
            <tr><td style="border-radius:10px;background:#B04A2D;">
              <a href="${e(input.link)}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;">Abrir el espacio</a>
            </td></tr>
          </table>
          <p style="margin:0 0 20px 0;font-size:12px;line-height:1.6;color:#5F5E58;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${e(input.link)}" style="color:#9C4127;word-break:break-all;">${e(input.link)}</a></p>
        </td></tr>
        <tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #E4E2DC;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#5F5E58;">
          Recibes este aviso porque te añadieron a un espacio compartido de Andros. Si no conoces a esta persona, puedes salir del espacio desde «Compartir».
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
