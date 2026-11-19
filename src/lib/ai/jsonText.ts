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

/** Quita ```json … ``` si el modelo envolvió la respuesta en un bloque de código. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // LaTeX sin escapar ("\alpha") rompe el JSON: se duplican las barras
    // que no forman un escape válido y se reintenta una vez.
    const repaired = trimmed.replace(/\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (m) =>
      m.length > 1 ? m : "\\\\"
    );
    if (repaired === trimmed) throw error;
    return JSON.parse(repaired);
  }
}
