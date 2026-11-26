// ============================================================================
// ANDROS ARENA — ESCÁNER IA DE PUBLICACIONES (Sprint 3 · Módulo B)
//
//   POST /api/arena/analyze-post  { type, title, organization, description, stipend?, location? }
//   →  { tags, moderation, engine: "gemini" | "keywords", model?, notice? }
//
// 1. Gemini revisa seguridad/calidad y extrae etiquetas normalizadas
//    (disciplina, nivel, tipo, habilidades) de un catálogo cerrado.
// 2. Si Gemini no responde a tiempo (saturado, sin cuota, sin clave), el
//    etiquetador determinista responde igual: publicar SIEMPRE funciona.
// Las reglas duras de fraude se aplican siempre, también sobre la IA.
// (Sprint 17B) Gemini (clave del servidor) solo con sesión iniciada y con el
// mismo tope diario por persona que el resto de la IA gratuita. Sin sesión o
// sin cuota responde el analizador local: publicar sigue funcionando.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { callGemini, ProviderFailure } from "@/lib/ai/gemini";
import { keywordAnalyze, mergeModeration, sanitizeTags } from "@/lib/arena/keywordTagger";
import { quotaForUser, serverQuotaAllows, serverQuotaConsume } from "@/lib/ai/serverQuota";
import { getUserPlan } from "@/lib/billing/serverPlan";
import { getRequestUser } from "@/lib/supabase/server";
import {
  ARENA_DISCIPLINES,
  ARENA_LEVELS,
  ARENA_TYPES,
  type ArenaAnalyzeResponse,
  type ArenaPostDraft,
  type ArenaPostType,
} from "@/types/arena";

export const maxDuration = 30;

/** Para una demo en vivo: si Gemini tarda más de esto, responde el respaldo. */
const GEMINI_BUDGET_MS = 12_000;

const SYSTEM = `Eres el moderador y clasificador de "Andros Arena", una bolsa de retos de ingeniería, actividades académicas, prácticas profesionales y empleos técnicos.

Analiza la publicación y responde SOLO con JSON con esta forma exacta:
{
  "moderation": {
    "status": "approved" | "needs_review" | "rejected",
    "qualityScore": number,            // 0 a 100: claridad, detalle técnico, entregables/requisitos
    "issues": string[],                // problemas concretos, en español (vacío si no hay)
    "suggestions": string[]            // máx. 3 mejoras accionables, en español
  },
  "tags": {
    "discipline": string[],            // 1 a 3, SOLO de: ${ARENA_DISCIPLINES.join(", ")}
    "level": string[],                 // 1 a 2, SOLO de: ${ARENA_LEVELS.join(", ")}
    "skills": string[]                 // 2 a 8 habilidades técnicas cortas y normalizadas (ej. "CAD", "FEA", "Simulación térmica", "Python", "FDM", "GD&T")
  }
}

CRITERIOS DE MODERACIÓN
- "rejected": spam, fraude (cobrar por postular, inversiones, cripto, pedir datos bancarios), contenido sexual, discriminatorio, violento o ilegal, o texto sin sentido.
- "needs_review": legítima pero le faltan datos clave (qué se entrega o cómo se evalúa en retos/actividades; requisitos, ubicación o modalidad en empleos/prácticas) o es demasiado vaga.
- "approved": legítima, clara y con detalle suficiente.
- No inventes datos de la publicación. No incluyas texto fuera del JSON.`;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseDraft(body: unknown): ArenaPostDraft | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const type = ARENA_TYPES.includes(b.type as ArenaPostType) ? (b.type as ArenaPostType) : null;
  const title = str(b.title, 140);
  const description = str(b.description, 4000);
  if (!type || title.length < 3 || description.length < 1) return null;
  return {
    type,
    title,
    organization: str(b.organization, 100),
    description,
    stipend: str(b.stipend, 80) || undefined,
    location: str(b.location, 80) || undefined,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<ArenaAnalyzeResponse | { error: string }>> {
  let draft: ArenaPostDraft | null = null;
  try {
    draft = parseDraft(await request.json());
  } catch {
    draft = null;
  }
  if (!draft) {
    return NextResponse.json(
      { error: "Faltan datos: tipo, título (mín. 3 caracteres) y descripción." },
      { status: 400 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({
      ...keywordAnalyze(draft),
      notice: "Etiquetas generadas con el analizador local (no hay GEMINI_API_KEY en el servidor).",
    });
  }

  const caller = await getRequestUser(request);
  if (!caller) {
    return NextResponse.json({
      ...keywordAnalyze(draft),
      notice: "Etiquetas generadas con el analizador local. Inicia sesión para usar el escáner IA.",
    });
  }
  // (Sprint 21) Tope del plan de la persona (15 o 150 al día), leído de Supabase.
  const quota = quotaForUser(caller.userId, await getUserPlan(caller.supabase, caller.userId));
  const quotaKey = quota.key;
  if (!serverQuotaAllows(quotaKey, quota.limit)) {
    return NextResponse.json({
      ...keywordAnalyze(draft),
      notice: "Etiquetas generadas con el analizador local: alcanzaste el tope diario de IA gratuita. Puedes publicar igual.",
    });
  }

  try {
    const { raw, model } = await callGemini(
      apiKey,
      {
        system: SYSTEM,
        userContent: JSON.stringify({
          tipo: draft.type,
          titulo: draft.title,
          organizacion: draft.organization,
          descripcion: draft.description,
          apoyo_o_salario: draft.stipend ?? null,
          ubicacion: draft.location ?? null,
        }),
        history: [],
        maxOutputTokens: 1200,
      },
      { budgetMs: GEMINI_BUDGET_MS, temperature: 0.1 }
    );
    const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!obj.tags && !obj.moderation) throw new Error("Respuesta sin etiquetas");
    serverQuotaConsume(quotaKey);
    return NextResponse.json({
      tags: sanitizeTags(obj.tags, draft),
      moderation: mergeModeration(obj.moderation, draft),
      engine: "gemini",
      model,
    });
  } catch (error) {
    const reason =
      error instanceof ProviderFailure
        ? error.issue.code === "rate_limited"
          ? "Gemini alcanzó su cuota"
          : error.issue.code === "invalid_key"
            ? "la clave de Gemini no es válida"
            : "Gemini está saturado"
        : "Gemini respondió en un formato inesperado";
    console.warn("[arena/analyze-post] respaldo local:", error instanceof Error ? error.message : error);
    return NextResponse.json({
      ...keywordAnalyze(draft),
      notice: `Etiquetas generadas con el analizador local porque ${reason}. Puedes publicar igual.`,
    });
  }
}
