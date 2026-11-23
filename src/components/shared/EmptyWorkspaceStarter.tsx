"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Layers, LayoutTemplate, Loader2, Sparkles, X } from "lucide-react";
import { useIsExpert, useSettingsStore } from "@/store/useSettingsStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useLandingStore } from "@/store/useLandingStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useStarterStore } from "@/store/useStarterStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { springOrInstant } from "@/lib/motion";
import { applyBlueprint } from "@/lib/templates/applyBlueprint";
import { BlueprintError, generateBlueprint } from "@/lib/templates/blueprintClient";
import {
  BUILTIN_TEMPLATES,
  baseBlueprintFor,
  deleteCustomTemplate,
  loadCustomTemplates,
  saveCustomTemplate,
  type LocalTemplate,
} from "@/lib/templates/localTemplates";
import { toast } from "@/store/useToastStore";

// ============================================================================
// ANDROS — TARJETA DE ARRANQUE (adiós lienzo en blanco)
//
// Un espacio sin tarjetas ofrece tres caminos:
//   1. Escribir en 1 frase qué se va a organizar → la IA arma un tablero de 5
//      tarjetas conectadas (/api/oracle/blueprint).
//   2. Un chip de ejemplo (1 clic, genera al instante).
//   3. Una plantilla local (0 ms, sin IA, sin cuota): incluidas o propias.
// Si la IA falla o se agotó la cuota, «Usar plantilla base sin IA» deja a la
// persona trabajando igual. «o empezar en blanco» la descarta.
// ============================================================================

const EXAMPLES_SIMPLE = [
  "Feria universitaria para 120 personas el próximo sábado",
  "Taller práctico para 30 estudiantes con presupuesto ajustado",
  "Lanzamiento de producto con equipo de 5 personas",
];
const EXAMPLE_EXPERT = "Prototipo e investigación de proyecto";

interface FailState {
  message: string;
  code: BlueprintError["code"];
}

interface Props {
  /** `canvas`: tarjeta flotante sobre el lienzo (escritorio). `stack`: dentro de la pila del teléfono. */
  variant: "canvas" | "stack";
}

/** `true` mientras la tarjeta debe mostrarse (espacio realmente vacío y sin nada tapándolo). */
export function useStarterVisible(): boolean {
  const isEmpty = useWorkspaceStore((s) => s.nodes.length === 0 && s.canvasStrokes.length === 0);
  const landingDone = useLandingStore((s) => s.phase === "workspace");
  const tourOpen = useOnboardingStore((s) => s.open);
  // Mientras la nube descarga el espacio guardado, «vacío» todavía no es verdad.
  const cloudBusy = useCloudStore((s) => s.status === "loading" || (s.status === "connecting" && s.user !== null));
  const dismissed = useStarterStore((s) => s.dismissed);
  return isEmpty && landingDone && !tourOpen && !cloudBusy && !dismissed;
}

const StarterCard: React.FC<Props> = ({ variant }) => {
  const expert = useIsExpert();
  const reduced = useSettingsStore((s) => s.animations) === "reduced";
  const dismiss = useStarterStore((s) => s.dismiss);
  const { pending, run } = useSubmitGuard();

  const [text, setText] = useState("");
  const [fail, setFail] = useState<FailState | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  // Se monta solo cuando la tarjeta es visible, así que se leen las plantillas propias al abrirse.
  const [custom, setCustom] = useState<LocalTemplate[]>(() => loadCustomTemplates());
  const abortRef = useRef<AbortController | null>(null);

  // Si se cierra la tarjeta a mitad de una petición, se cancela.
  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = (rawPrompt: string) => {
    const prompt = rawPrompt.replace(/\s+/g, " ").trim();
    if (!prompt) return;
    setText(prompt);
    setLastPrompt(prompt);
    setFail(null);
    void run(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        applyBlueprint(await generateBlueprint(prompt, controller.signal));
      } catch (error) {
        if (error instanceof BlueprintError && error.code === "aborted") return;
        setFail(
          error instanceof BlueprintError
            ? { message: error.message, code: error.code }
            : { message: "No pude generar el tablero ahora mismo. Inténtalo de nuevo.", code: "service" }
        );
      } finally {
        abortRef.current = null;
      }
    });
  };

  const applyBaseTemplate = () => {
    applyBlueprint(baseBlueprintFor(lastPrompt || text), "Plantilla base lista: ajusta lo que necesites.");
  };

  const removeCustom = (template: LocalTemplate) => {
    deleteCustomTemplate(template.id);
    setCustom((list) => list.filter((t) => t.id !== template.id));
    toast({
      message: `Plantilla «${template.name.slice(0, 40)}» eliminada.`,
      action: {
        label: "Deshacer",
        onAction: () => {
          saveCustomTemplate(template.name, template.blueprint);
          setCustom(loadCustomTemplates());
        },
      },
    });
  };

  const examples = expert ? [...EXAMPLES_SIMPLE, EXAMPLE_EXPERT] : EXAMPLES_SIMPLE;
  const stack = variant === "stack";
  const chipClass =
    "min-h-11 md:min-h-9 px-3 py-2 md:py-1.5 rounded-xl border border-andros-border bg-andros-canvas text-left text-xs leading-snug text-andros-primary hover:border-andros-border-active hover:bg-andros-border/30 active:scale-[0.96] spring-micro disabled:opacity-50";

  const body = (
    <>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 shrink-0 rounded-lg bg-andros-accent/10 text-andros-accent-ink flex items-center justify-center">
          <Layers className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`starter-title-${variant}`} className="text-base font-semibold text-andros-primary">
            ¿Qué evento o proyecto vas a organizar?
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-andros-muted">
            Cuéntalo en una frase y te armo un tablero con resumen, cronograma, presupuesto, logística y roles.
          </p>
        </div>
      </div>

      {pending ? (
        <div role="status" aria-live="polite" className="mt-4 flex items-center gap-3 rounded-xl border border-andros-border bg-andros-canvas p-3">
          <Loader2 className="w-4 h-4 shrink-0 text-andros-accent-ink motion-safe:animate-spin" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm text-andros-primary">Organizando cronograma, presupuesto y roles…</span>
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="min-h-11 md:min-h-9 px-3 rounded-lg text-xs font-medium text-andros-muted hover:text-andros-primary active:scale-[0.96] spring-micro"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            generate(text);
          }}
        >
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={400}
            aria-labelledby={`starter-title-${variant}`}
            placeholder="Ej.: Feria universitaria para 120 personas"
            autoComplete="off"
            enterKeyHint="go"
            className="w-full min-w-0 sm:flex-1 h-11 md:h-10 px-3 rounded-xl bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none text-sm text-andros-primary placeholder:text-andros-muted"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="h-11 md:h-10 px-4 rounded-xl bg-andros-accent-fill text-white text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            Generar tablero
          </button>
        </form>
      )}

      {fail && !pending && (
        <div role="alert" className="mt-3 rounded-xl border border-andros-border bg-andros-canvas p-3">
          <p className="text-xs leading-relaxed text-andros-danger">{fail.message}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyBaseTemplate}
              className="min-h-11 md:min-h-9 px-3 rounded-lg bg-andros-accent-fill text-white text-xs font-semibold active:scale-[0.96] spring-micro"
            >
              Usar plantilla base sin IA
            </button>
            {fail.code !== "quota" && (
              <button
                type="button"
                onClick={() => generate(lastPrompt)}
                className="min-h-11 md:min-h-9 px-3 rounded-lg border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
              >
                Reintentar
              </button>
            )}
            {fail.code !== "network" && (
              <button
                type="button"
                onClick={() => useAiProvidersStore.getState().setKeysModalOpen(true)}
                className="min-h-11 md:min-h-9 px-3 rounded-lg border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
              >
                Usar mi propia clave
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-andros-muted">Prueba con un ejemplo</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {examples.map((example) => (
            <button key={example} type="button" disabled={pending} onClick={() => generate(example)} className={chipClass}>
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-andros-muted">
          Plantillas al instante · sin IA
        </p>
        <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {[...BUILTIN_TEMPLATES, ...custom].map((template) => {
            const isCustom = template.id.startsWith("custom-");
            return (
              <li key={template.id} className="flex items-stretch gap-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => applyBlueprint(template.blueprint, `Plantilla «${template.name.slice(0, 40)}» aplicada.`)}
                  className="min-w-0 flex-1 min-h-11 md:min-h-9 px-3 py-2 rounded-xl border border-andros-border bg-andros-canvas text-left hover:border-andros-border-active hover:bg-andros-border/30 active:scale-[0.96] spring-micro disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-andros-primary">
                    <LayoutTemplate className="w-3.5 h-3.5 shrink-0 text-andros-accent-ink" aria-hidden="true" />
                    <span className="truncate">{template.name}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-andros-muted">
                    {isCustom ? `Tuya · ${template.description}` : template.description}
                  </span>
                </button>
                {isCustom && (
                  <button
                    type="button"
                    onClick={() => removeCustom(template)}
                    aria-label={`Eliminar la plantilla «${template.name}»`}
                    className="w-11 md:w-9 shrink-0 rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-danger hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="min-h-11 md:min-h-9 px-3 text-xs text-andros-muted underline underline-offset-2 hover:text-andros-primary active:scale-[0.96] spring-micro disabled:opacity-50"
        >
          o empezar en blanco
        </button>
      </div>
    </>
  );

  if (stack) {
    return (
      <section
        aria-labelledby="starter-title-stack"
        className="rounded-2xl bg-andros-card border border-andros-border shadow-card-light dark:shadow-card-dark p-4"
      >
        {body}
      </section>
    );
  }

  return (
    <motion.section
      aria-labelledby="starter-title-canvas"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springOrInstant(reduced)}
      className="fixed z-30 left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 w-[min(36rem,calc(100vw-2rem))] max-h-[calc(100vh-11rem)] overflow-y-auto p-5 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark"
    >
      {body}
    </motion.section>
  );
};

/** Muestra la tarjeta solo mientras el espacio está de verdad vacío. */
export const EmptyWorkspaceStarter: React.FC<Props> = ({ variant }) => {
  const visible = useStarterVisible();
  return visible ? <StarterCard variant={variant} /> : null;
};
