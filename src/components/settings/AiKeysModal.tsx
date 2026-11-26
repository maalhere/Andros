"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDER_DOT,
  AI_PROVIDER_KEY_URLS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_MODELS,
  AI_PROVIDERS,
  type NodeChatResponse,
} from "@/lib/ai/providers";
import type { AiProvider } from "@/types/workspace";
import { sessionAuthHeader } from "@/lib/supabase/authHeader";

// ============================================================================
// ANDROS — CLAVES IA (BYOK)
// Guarda, prueba y borra las claves propias de Gemini, Claude y ChatGPT.
// Solo viven en este navegador (localStorage).
// ============================================================================

type TestState = { status: "idle" | "testing" | "ok" | "error"; message?: string };

const ProviderRow: React.FC<{ provider: AiProvider }> = ({ provider }) => {
  const savedKey = useAiProvidersStore((s) => s.keys[provider] ?? "");
  const defaultModel = useAiProvidersStore((s) => s.defaultModels[provider]);
  const setKey = useAiProvidersStore((s) => s.setKey);
  const clearKey = useAiProvidersStore((s) => s.clearKey);
  const setDefaultModel = useAiProvidersStore((s) => s.setDefaultModel);

  const [value, setValue] = useState(savedKey);
  const [visible, setVisible] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const dirty = value.trim() !== savedKey;
  const listId = `andros-models-${provider}`;

  const runTest = async () => {
    const key = value.trim();
    if (key && dirty) setKey(provider, key);
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/ai/node-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sessionAuthHeader()) },
        body: JSON.stringify({
          provider,
          model: defaultModel,
          ...(key ? { apiKey: key } : {}),
          test: true,
          messages: [],
        }),
      });
      const data = (await res.json()) as NodeChatResponse;
      setTest(
        "error" in data
          ? { status: "error", message: data.error.message }
          : { status: "ok", message: `Conectado · ${data.modelUsed}` }
      );
    } catch {
      setTest({ status: "error", message: "No se pudo contactar con el servidor." });
    }
  };

  return (
    <div className="p-3.5 rounded-xl border border-andros-border bg-andros-canvas space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-andros-primary">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: AI_PROVIDER_DOT[provider] }} />
          {AI_PROVIDER_LABELS[provider]}
        </span>
        <span className={`text-[10px] font-mono ${savedKey ? "text-andros-success" : "text-andros-muted"}`}>
          {savedKey
            ? "● Clave propia guardada"
            : provider === "gemini"
              ? "Sin clave: usa el Gemini del servidor"
              : "Sin clave"}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <input
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTest({ status: "idle" });
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder={provider === "anthropic" ? "sk-ant-…" : provider === "openai" ? "sk-…" : "AIza…"}
            aria-label={`Clave de ${AI_PROVIDER_LABELS[provider]}`}
            className="w-full h-9 pl-3 pr-9 rounded-lg bg-andros-card border border-andros-border focus:border-andros-accent outline-none text-[12px] font-mono text-andros-primary placeholder:text-andros-muted"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar clave" : "Mostrar clave"}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-andros-muted hover:text-andros-primary"
          >
            {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setKey(provider, value)}
          disabled={!dirty || !value.trim()}
          className="h-9 px-3 rounded-lg bg-andros-primary text-andros-canvas text-[11px] font-semibold disabled:opacity-40"
        >
          Guardar
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <label className="flex-1 min-w-0 flex items-center gap-2 text-[11px] text-andros-muted">
          <span className="shrink-0">Modelo por defecto</span>
          <input
            list={listId}
            value={defaultModel}
            onChange={(e) => setDefaultModel(provider, e.target.value)}
            onBlur={(e) => !e.target.value.trim() && setDefaultModel(provider, AI_DEFAULT_MODELS[provider])}
            className="min-w-0 flex-1 h-8 px-2 rounded-lg bg-andros-card border border-andros-border focus:border-andros-accent outline-none text-[11px] font-mono text-andros-primary"
          />
          <datalist id={listId}>
            {AI_PROVIDER_MODELS[provider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={test.status === "testing" || (provider !== "gemini" && !value.trim())}
          className="h-8 px-3 rounded-lg border border-andros-border text-[11px] font-medium text-andros-primary hover:border-andros-border-active flex items-center gap-1.5 disabled:opacity-40"
        >
          {test.status === "testing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
          Probar
        </button>
        <button
          type="button"
          onClick={() => {
            clearKey(provider);
            setValue("");
            setTest({ status: "idle" });
          }}
          disabled={!savedKey}
          className="h-8 px-3 rounded-lg text-[11px] font-medium text-andros-muted hover:text-andros-accent-ink flex items-center gap-1.5 disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Borrar clave
        </button>
        <a
          href={AI_PROVIDER_KEY_URLS[provider]}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-[11px] text-andros-accent-ink hover:underline"
        >
          Conseguir clave
        </a>
      </div>

      {test.status === "ok" && (
        <p className="flex items-center gap-1.5 text-[11px] text-andros-success">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {test.message}
        </p>
      )}
      {test.status === "error" && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-andros-accent-ink">
          <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" />
          {test.message}
        </p>
      )}
    </div>
  );
};

export const AiKeysModal: React.FC = () => {
  const open = useAiProvidersStore((s) => s.isKeysModalOpen);
  const setOpen = useAiProvidersStore((s) => s.setKeysModalOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-end md:items-center justify-center p-3 bg-black/40 backdrop-blur-sm"
      onPointerDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Claves IA"
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-andros-primary">
            <KeyRound className="w-4 h-4 text-andros-accent-ink" />
            <h2 className="text-sm font-semibold">Claves IA</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="flex items-start gap-2 p-3 rounded-xl bg-andros-success/10 border border-andros-success/25 text-[11px] leading-relaxed text-andros-primary">
          <ShieldCheck className="w-4 h-4 shrink-0 text-andros-success" />
          <span>
            Tus claves se guardan solo en este navegador, nunca en la nube ni en tu cuenta. Se envían al servidor de Andros
            únicamente en cada petición a la IA, que no las guarda ni las registra. Sin clave propia, los Nodos IA usan el
            Gemini del servidor.
          </span>
        </p>

        {AI_PROVIDERS.map((provider) => (
          <ProviderRow key={provider} provider={provider} />
        ))}
      </div>
    </div>,
    document.body
  );
};
