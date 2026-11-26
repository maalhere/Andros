"use client";

// ============================================================================
// ANDROS — PUERTAS DE ACCESO POR PLAN EN LA INTERFAZ (Sprint 21)
//
// Cada acción limitada pasa por aquí: si el Plan Básico no la permite, se
// bloquea y se abre el modal de planes con el motivo exacto. El servidor
// aplica además sus propios topes (cuota IA por plan, trigger de espacios y
// `workspace_live_cap()` en Supabase), así que esto es la cara amable, no la
// única barrera.
// ============================================================================

import { useEffect } from "react";
import { useMarketStore } from "@/store/useMarketStore";
import { useSettingsStore, type ExperienceMode } from "@/store/useSettingsStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { toast } from "@/store/useToastStore";
import { ensurePlan } from "./subscriptionClient";
import { PLAN_LIMITS, PRO_PRICING, canCreateSpace, canSaveCustomTemplate, limitsFor } from "./planLimits";

const PRO_SUFFIX = `Pasa a Andros Pro (${PRO_PRICING.monthly.label} ${PRO_PRICING.monthly.period}) para quitar el límite.`;

export const LIMIT_REASONS = {
  spaces: `El Plan Básico permite hasta ${PLAN_LIMITS.free.maxSpaces} espacios activos. ${PRO_SUFFIX}`,
  templates: `El Plan Básico permite ${PLAN_LIMITS.free.maxCustomTemplates} plantilla propia guardada. Borra la que tienes o pasa a Andros Pro para guardar plantillas ilimitadas.`,
  expert: "El Modo Experto (visor 3D, fórmulas, CodeLab e impresoras) es parte de Andros Pro.",
} as const;

export function requestUpgrade(reason: string): void {
  useMarketStore.getState().openUpgrade(reason);
}

/** ¿Puede crear o duplicar un espacio? Si no, abre el modal y devuelve `false`. */
export async function guardSpaceCreation(ownedCount: number): Promise<boolean> {
  const plan = await ensurePlan();
  if (canCreateSpace(plan, ownedCount)) return true;
  requestUpgrade(LIMIT_REASONS.spaces);
  return false;
}

/** ¿Puede guardar otra plantilla propia? (reemplazar una del mismo nombre siempre se puede). */
export async function guardTemplateSave(savedCount: number, replacesExisting: boolean): Promise<boolean> {
  const plan = await ensurePlan();
  if (canSaveCustomTemplate(plan, savedCount, replacesExisting)) return true;
  requestUpgrade(LIMIT_REASONS.templates);
  return false;
}

/** Cambia de modo respetando el plan: Experto solo con Andros Pro. */
export async function chooseExperienceMode(mode: ExperienceMode): Promise<boolean> {
  if (mode === "expert") {
    const plan = await ensurePlan();
    if (!limitsFor(plan).expertMode) {
      requestUpgrade(LIMIT_REASONS.expert);
      return false;
    }
  }
  useSettingsStore.getState().setExperienceMode(mode);
  return true;
}

/**
 * Montado una vez (page.tsx): si el plan ya se sabe y no incluye el Modo
 * Experto (p. ej. terminó la suscripción o llegó una preferencia guardada en
 * otro equipo), vuelve a Simple. No se borra nada del lienzo: solo se ocultan
 * las herramientas expertas.
 */
export function usePlanEnforcement(): void {
  useEffect(() => {
    const enforce = () => {
      const sub = useSubscriptionStore.getState();
      const settings = useSettingsStore.getState();
      if (!sub.loaded || limitsFor(sub.plan).expertMode || settings.experienceMode !== "expert") return;
      settings.setExperienceMode("simple");
      toast({ message: "Modo Simple activo: el Modo Experto es parte de Andros Pro. Tus tarjetas siguen intactas." });
    };
    enforce();
    const offSub = useSubscriptionStore.subscribe(enforce);
    const offSettings = useSettingsStore.subscribe((s, prev) => {
      if (s.experienceMode !== prev.experienceMode) enforce();
    });
    return () => {
      offSub();
      offSettings();
    };
  }, []);
}
