// ============================================================================
// ANDROS — TABLERO INICIAL ORGANIZADO POR ÁREAS (arranque en 3 pasos)
// Construye, sin tocar el store, las tarjetas y cables del tablero inicial:
//   · «Coordinación del proyecto» (equipo, áreas y cómo usar el chat/@IA).
//   · Una columna por área: nota «Área: X» con sus personas + sus fichas.
//   · Los formatos generados (para guardarlos en la Librería de fichas).
// Se usa igual con la IA o con el respaldo local (`buildLocalSetupPlan`).
// ============================================================================

import {
  createEmptySketchNotePayload,
  estimateNodeHeight,
  nextUniqueId,
  parseAiTextContent,
  resolveAutoPorts,
  textBlocksToHtml,
} from "@/store/useWorkspaceStore";
import { FORM_SHEET_CODE_TAG, fieldFromDef, newFormId, toFieldKey, uniqueFieldKeys } from "@/lib/forms/formSchema";
import { ROLE_LABELS, type WorkspaceRole } from "@/lib/access/permissions";
import type { FormFieldDef, FormTemplate } from "@/types/forms";
import type { EngineeringNodeData, NodeConnection } from "@/types/workspace";
import { areaKey } from "./areas";
import type { SetupPlan, SetupTemplateSeed } from "./setup";

const NODE_WIDTH = 320;
const COLUMN_GAP = 90;
const ROW_GAP = 64;

export interface SetupPerson {
  name: string;
  username: string | null;
  role: WorkspaceRole;
  area: string;
}

export interface SetupBoard {
  nodes: EngineeringNodeData[];
  connections: NodeConnection[];
  templates: FormTemplate[];
}

export function templateFromSeed(seed: SetupTemplateSeed): FormTemplate {
  const fields: FormFieldDef[] = uniqueFieldKeys(
    seed.fields.map((f) => ({
      id: newFormId("def"),
      fieldKey: toFieldKey(f.label),
      label: f.label,
      type: f.type,
      ...(f.unit ? { unit: f.unit } : {}),
      ...(f.type === "select" ? { options: f.options ?? [] } : {}),
    }))
  );
  return {
    id: newFormId("tpl"),
    title: seed.title,
    category: seed.area || "General",
    ...(seed.description ? { description: seed.description } : {}),
    fields,
    updatedAt: Date.now(),
  };
}

function noteNode(title: string, tag: string, text: string): EngineeringNodeData {
  const { textBlocks, checklistItems } = parseAiTextContent(text);
  return {
    id: nextUniqueId("node"),
    type: "sketch-note-node",
    title: title.slice(0, 120),
    codeTag: tag.slice(0, 20),
    position: { x: 0, y: 0 },
    updatedAt: "Ahora mismo",
    sketchNoteData: {
      ...createEmptySketchNotePayload(),
      canvasMode: "text",
      textBlocks,
      checklistItems,
      richTextHtml: textBlocksToHtml(textBlocks),
    },
  };
}

const personLine = (p: SetupPerson) =>
  `- ${p.name}${p.username ? ` (@${p.username})` : ""} · ${ROLE_LABELS[p.role]}${p.area ? ` · @${p.area}` : ""}`;

/** Tablero inicial: coordinación + una columna por área con sus fichas. */
export function buildSetupBoard(
  plan: SetupPlan,
  areas: readonly string[],
  people: readonly SetupPerson[],
  origin: { x: number; y: number },
  projectName: string
): SetupBoard {
  const templates = plan.templates.map(templateFromSeed);
  const columns: { area: string; seeds: { seed: SetupTemplateSeed; template: FormTemplate }[] }[] = areas.map((area) => ({
    area,
    seeds: [],
  }));
  plan.templates.forEach((seed, i) => {
    const key = areaKey(seed.area);
    let col = columns.find((c) => key && areaKey(c.area) === key);
    if (!col) {
      col = columns.find((c) => c.area === "") ?? { area: "", seeds: [] };
      if (!columns.includes(col)) columns.push(col);
    }
    col.seeds.push({ seed, template: templates[i] });
  });

  const nodes: EngineeringNodeData[] = [];
  const connections: NodeConnection[] = [];
  const link = (from: EngineeringNodeData, to: EngineeringNodeData, label: string) => {
    const ports = resolveAutoPorts(from, to);
    connections.push({ id: nextUniqueId("conn"), fromNodeId: from.id, toNodeId: to.id, ...ports, label });
  };

  // 1. Coordinación (columna 0).
  const coordLines = [
    "# Equipo",
    ...(people.length > 0 ? people.map(personLine) : ["- Proyecto personal (puedes compartirlo cuando quieras)"]),
    "# Áreas de trabajo",
    areas.length > 0 ? `- ${areas.map((a) => `@${a}`).join(" · ")}` : "- Sin áreas: todas las fichas van juntas",
    "# Cómo trabajamos",
    "- [ ] Escribir en el chat del lienzo mencionando @Área o @usuario",
    "- [ ] Reportar cambios o problemas con @IA: quedan en la alerta unificada",
    "- [ ] Cada problema pendiente se sigue en una Ficha de Resolución (Rojo → Verde)",
  ];
  const coord = noteNode(`Coordinación: ${projectName || "Proyecto"}`, "CDE", coordLines.join("\n"));
  coord.position = { x: Math.round(origin.x), y: Math.round(origin.y) };
  nodes.push(coord);

  // 2. Una columna por área.
  columns
    .filter((c) => c.area || c.seeds.length > 0)
    .forEach((col, index) => {
      const x = Math.round(origin.x + (index + 1) * (NODE_WIDTH + COLUMN_GAP));
      let y = Math.round(origin.y);
      const members = people.filter((p) => p.area && areaKey(p.area) === areaKey(col.area));
      const header = noteNode(
        col.area ? `Área: ${col.area}` : "Fichas generales",
        col.area ? "ÁREA" : "FICHAS",
        [
          "# Personas",
          ...(members.length > 0 ? members.map(personLine) : ["- Sin personas asignadas todavía"]),
          "# Fichas del área",
          ...(col.seeds.length > 0 ? col.seeds.map((s) => `- ${s.seed.title}`) : ["- Ninguna por ahora"]),
        ].join("\n")
      );
      header.position = { x, y };
      nodes.push(header);
      link(coord, header, col.area ? `@${col.area}` : "Fichas");
      y += estimateNodeHeight(header) + ROW_GAP;

      for (const { seed, template } of col.seeds) {
        const sheet: EngineeringNodeData = {
          id: nextUniqueId("node"),
          type: "form-sheet-node",
          title: seed.title.slice(0, 120),
          codeTag: FORM_SHEET_CODE_TAG,
          position: { x, y },
          updatedAt: "Ahora mismo",
          formSheetData: {
            templateId: template.id,
            category: col.area || "General",
            fields: template.fields.map(fieldFromDef),
            attachments: [],
            ...(col.area ? { area: col.area } : {}),
          },
        };
        nodes.push(sheet);
        link(header, sheet, "Ficha");
        y += estimateNodeHeight(sheet) + ROW_GAP;
      }
    });

  return { nodes, connections, templates };
}
