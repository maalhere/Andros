// ============================================================================
// ANDROS — LECTURA ROBUSTA DEL JSON QUE DEVUELVEN LOS MODELOS DE IA
// (bloques de código json, LaTeX sin escapar). Solo servidor.
// ============================================================================

/**
 * Si el modelo escribió "\frac" sin duplicar la barra, JSON lo convierte en un
 * salto de página + "rac". Se recuperan los casos típicos de LaTeX.
 */
export function repairLatexControlChars(text: string): string {
  return text
    .replace(/\f/g, "\\f")
    .replace(/\x08/g, "\\b")
    .replace(/\x0b/g, "\\v")
    .replace(/\t(?=[a-zA-Z]{2})/g, "\\t")
    .replace(/\r(?=[a-zA-Z]{2})/g, "\\r");
}

/**
 * Lee el JSON de la respuesta de un modelo, tolerando: bloques de código
 * (```json … ```) con o sin texto alrededor, texto antes/después del objeto y
 * LaTeX sin escapar.
 */
export function parseJsonText(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced ? fenced[1] : "", text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/, "")];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  let lastError: unknown = new Error("Respuesta sin JSON");
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      lastError = error;
      // LaTeX sin escapar ("\alpha") rompe el JSON: se duplican las barras
      // que no forman un escape válido y se reintenta una vez.
      const repaired = trimmed.replace(/\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (m) => (m.length > 1 ? m : "\\\\"));
      if (repaired !== trimmed) {
        try {
          return JSON.parse(repaired);
        } catch (error2) {
          lastError = error2;
        }
      }
    }
  }
  throw lastError;
}

/**
 * Lee, de un JSON que aún se está recibiendo (stream), el valor de texto de un
 * campo de primer nivel como `"reply": "…"`, decodificando los escapes. Sirve
 * para mostrar la respuesta mientras el modelo escribe, sin esperar al JSON
 * completo. Devuelve lo decodificado hasta ahora y si el campo ya se cerró.
 */
export function extractStreamingStringField(raw: string, field: string): { text: string; done: boolean } {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw);
  if (!match) return { text: "", done: false };
  let out = "";
  let i = match.index + match[0].length;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') return { text: out, done: true };
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break; // Escape cortado: se completa con el siguiente fragmento.
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : "";
      i += 6;
      continue;
    }
    const map: Record<string, string> = { n: "\n", t: "\t", r: "", b: "", f: "", '"': '"', "\\": "\\", "/": "/" };
    out += next in map ? map[next] : next;
    i += 2;
  }
  return { text: out, done: false };
}
