// ============================================================================
// ANDROS — UTILIDADES DEL DOCUMENTO DEL ESTUDIO DEL ORÁCULO
//   · countWords: recuento de palabras sin la sintaxis Markdown.
//   · markdownToNoteText: convierte el Markdown del Estudio al formato de
//     líneas de los cuadernos del lienzo ("# título", "- viñeta", "- [ ] tarea",
//     párrafos), que entiende `parseAiTextContent` del store.
// ============================================================================

/** Palabras "legibles" del documento (sin #, |, $, *, etc.). */
export function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|~\-[\]()$\\]/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

/**
 * Markdown → líneas del cuaderno. Las tablas pasan a viñetas "Columna: valor",
 * los bloques de código y de LaTeX se conservan como texto legible.
 */
export function markdownToNoteText(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let header: string[] | null = null;
  let inCode = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();

    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      if (line) out.push(line);
      continue;
    }

    // Tablas GFM: la primera fila es el encabezado si la sigue un separador.
    if (line.startsWith("|") && line.endsWith("|")) {
      if (TABLE_SEPARATOR.test(line)) continue;
      const cells = splitTableRow(line);
      const next = lines[i + 1]?.trim() ?? "";
      if (!header && TABLE_SEPARATOR.test(next)) {
        header = cells;
        out.push(cells.join(" · "));
        continue;
      }
      const pairs = cells.map((cell, idx) =>
        header && header[idx] && idx > 0 ? `${header[idx]}: ${cell}` : cell
      );
      out.push(`- ${pairs.join(" · ")}`);
      continue;
    }
    header = null;

    if (line === "$$") continue;
    const text = line
      .replace(/^>\s?/, "")
      .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/^\$\$(.+)\$\$$/, "$1")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2");
    out.push(text);
  }
  return out.join("\n");
}
