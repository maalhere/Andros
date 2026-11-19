"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Cable,
  ChevronDown,
  ChevronUp,
  Download,
  FileUp,
  KeyRound,
  Link2,
  Loader2,
  Maximize2,
  RefreshCw,
  Send,
} from "lucide-react";
import type { AiChatEngineeringNode, AiProvider } from "@/types/workspace";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { useOracleStudioStore } from "@/store/useOracleStudioStore";
import { collectUpstreamContext } from "@/lib/canvas/contextGraph";
import {
  AI_PROVIDER_DOT,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_MODELS,
  AI_PROVIDERS,
} from "@/lib/ai/providers";
import { PLATFORM_LABELS, parseChatImport, type ImportedConversation, type ParsedImport } from "@/lib/ai/chatImport";
import {
  aiNodeTranscript,
  importIntoAiNode,
  RESYNC_PROMPT,
  sendAiNodeTurn,
  clearPendingImportPanel,
  hasPendingImportPanel,
} from "@/lib/ai/nodeChatClient";
import { markdownToNoteText } from "@/lib/oracle/markdownDocument";
import type { ImportChatResponse } from "@/app/api/ai/import-chat/route";

// ============================================================================
// NODO TIPO 6 — CONVERSACIÓN IA (Gemini · Claude · ChatGPT)
//   · Cabecera: proveedor, modelo y cuántos nodos le dan contexto por cable.
//   · Cuerpo: última respuesta (o la conversación completa) y entrada rápida.
//   · "Contexto actualizado · Resincronizar" cuando cambia un nodo de aguas
//     arriba: la IA solo se vuelve a llamar con un clic (no gasta cuota sola).
//   · Importar / Actualizar una conversación externa sin tocar los cables.
// ============================================================================

interface AiChatNodeProps {
  node: AiChatEngineeringNode;
  variant: "canvas" | "stack";
}

type ImportTab = "link" | "paste";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const smallBtn =
  "h-7 px-2 rounded-lg text-[11px] font-medium flex items-center gap-1 text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro disabled:opacity-40";

export const AiChatNodeView: React.FC<AiChatNodeProps> = ({ node }) => {
  const data = node.aiChatData;
  const updateNodePayload = useWorkspaceStore((s) => s.updateNodePayload);
  const defaultModels = useAiProvidersStore((s) => s.defaultModels);
  const hasUserKey = useAiProvidersStore((s) => Boolean(s.keys[data.provider]));

  // Contexto aguas arriba (texto primitivo para no re-renderizar en bucle).
  const contextKey = useWorkspaceStore((s) => {
    const ctx = collectUpstreamContext(s.nodes, s.connections, node.id);
    return `${ctx.fingerprint}|${ctx.directCount}|${ctx.entries.length}`;
  });
  const [fingerprint, directCountRaw, totalCountRaw] = contextKey.split("|");
  const directCount = Number(directCountRaw);
  const totalCount = Number(totalCountRaw);

  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  // "Importar chat" desde el menú + Agregar: el panel nace abierto.
  const [importOpen, setImportOpen] = useState(() => hasPendingImportPanel(node.id));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => clearPendingImportPanel(node.id), [node.id]);

  const thinking = data.status === "thinking";
  const messages = data.messages;
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant");
  const isStale =
    messages.length > 0 && !thinking && fingerprint !== (data.contextFingerprint ?? "");
  const needsKey = data.provider !== "gemini" && !hasUserKey;

  const models = useMemo(() => {
    const list = AI_PROVIDER_MODELS[data.provider];
    const extra = [data.model, defaultModels[data.provider]].filter(
      (m, i, arr) => m && !list.some((x) => x.id === m) && arr.indexOf(m) === i
    );
    return [...list, ...extra.map((id) => ({ id, label: id }))];
  }, [data.provider, data.model, defaultModels]);

  const send = (text: string, resync = false) => {
    if (!text.trim() || thinking) return;
    setDraft("");
    setNotice(null);
    void sendAiNodeTurn(node.id, text, { resync });
  };

  const changeProvider = (provider: AiProvider) => {
    updateNodePayload(node.id, {
      provider,
      model: defaultModels[provider],
      status: "idle",
      errorMessage: undefined,
    });
  };

  const pushToCanvas = () => {
    if (!lastReply) return;
    useWorkspaceStore.getState().aiCreateTextBlock({
      title: `${node.title} · respuesta`,
      content: markdownToNoteText(lastReply.text),
      linkedNodeId: node.id,
      connectionLabel: "Respuesta IA",
      codeTag: "AI-OUT",
    });
    setNotice("Respuesta añadida al lienzo como bloque de texto conectado.");
  };

  const openInStudio = () => {
    const studio = useOracleStudioStore.getState();
    studio.applyAiDocument({ title: node.title, markdown: aiNodeTranscript(node) });
    studio.setChatMode("document");
    useWorkspaceStore.getState().setOracleModalOpen(true);
  };

  return (
    <div className="py-3 space-y-2.5">
      {/* Proveedor + modelo + claves */}
      <div className="flex items-center gap-1.5" data-no-drag>
        <label className="relative flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-lg bg-andros-canvas border border-andros-border text-[11px] font-semibold text-andros-primary">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: AI_PROVIDER_DOT[data.provider] }} />
          <select
            value={data.provider}
            onChange={(e) => changeProvider(e.target.value as AiProvider)}
            disabled={thinking}
            aria-label="Proveedor de IA"
            className="bg-transparent outline-none cursor-pointer pr-0.5"
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {AI_PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <select
          value={data.model}
          onChange={(e) => updateNodePayload(node.id, { model: e.target.value })}
          disabled={thinking}
          aria-label="Modelo"
          className="min-w-0 flex-1 h-7 px-1.5 rounded-lg bg-andros-canvas border border-andros-border text-[11px] font-mono text-andros-muted outline-none focus:border-andros-accent"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => useAiProvidersStore.getState().setKeysModalOpen(true)}
          title={hasUserKey ? "Usando tu clave propia" : data.provider === "gemini" ? "Usando el Gemini del servidor" : "Añade tu clave"}
          aria-label="Claves IA"
          className={`h-7 w-7 shrink-0 rounded-lg border flex items-center justify-center spring-micro ${
            hasUserKey
              ? "border-andros-success/40 text-andros-success"
              : needsKey
                ? "border-andros-accent/50 text-andros-accent"
                : "border-andros-border text-andros-muted hover:text-andros-primary"
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Contexto conectado */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
        <span
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border ${
            directCount > 0 ? "border-andros-accent/30 text-andros-accent bg-andros-accent/5" : "border-andros-border text-andros-muted"
          }`}
          title="Nodos cuyos cables entran en este nodo: su contenido vivo se envía como contexto"
        >
          <Cable className="w-3 h-3" />
          {directCount === 0
            ? "Sin contexto conectado"
            : `${directCount} ${directCount === 1 ? "nodo conectado" : "nodos conectados"}${
                totalCount > directCount ? ` (+${totalCount - directCount} aguas arriba)` : ""
              }`}
        </span>
        {isStale && (
          <button
            type="button"
            data-no-drag
            onClick={() => send(RESYNC_PROMPT, true)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-andros-accent text-white font-semibold hover:opacity-90 spring-micro"
            title="Un nodo conectado cambió. Pulsa para volver a evaluar con el contexto nuevo (usa una llamada a la IA)."
          >
            <RefreshCw className="w-3 h-3" />
            Contexto actualizado · Resincronizar
          </button>
        )}
      </div>

      {/* Conversación externa vinculada */}
      {data.source && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-andros-muted" data-no-drag>
          <Link2 className="w-3 h-3 shrink-0" />
          <span className="truncate">
            {PLATFORM_LABELS[data.source.platform]} · {data.source.importedCount} mensajes · {data.source.importedAt}
          </span>
          {data.source.url && (
            <a href={data.source.url} target="_blank" rel="noreferrer" className="shrink-0 hover:text-andros-accent" title="Abrir el chat original">
              <ArrowUpRight className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Cuerpo: última respuesta o conversación completa */}
      <div data-no-drag className="rounded-xl bg-andros-canvas border border-andros-border">
        {messages.length === 0 && !thinking ? (
          <p className="px-3 py-3 text-[12px] leading-relaxed text-andros-muted">
            Pregunta algo: la IA leerá el contenido de los nodos que conectes a este (notas, piezas 3D, código, enlaces u
            otras IA). También puedes importar un chat de ChatGPT, Claude o Gemini.
          </p>
        ) : expanded ? (
          <div className="max-h-80 overflow-y-auto px-3 py-2.5 space-y-2.5">
            {messages.map((m) =>
              m.resync ? (
                <p key={m.id} className="text-center text-[10px] font-mono text-andros-muted">
                  ↻ Resincronizado con el contexto nuevo
                </p>
              ) : (
                <div key={m.id} className={m.role === "user" ? "pl-6" : "pr-2"}>
                  <p className="text-[9px] font-mono uppercase tracking-wider text-andros-muted mb-0.5">
                    {m.role === "user" ? "Tú" : m.model ?? AI_PROVIDER_LABELS[data.provider]}
                    {m.imported ? " · importado" : ""}
                  </p>
                  <p
                    className={`text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
                      m.role === "user" ? "text-andros-muted" : "text-andros-primary"
                    }`}
                  >
                    {m.text}
                  </p>
                </div>
              )
            )}
          </div>
        ) : (
          <div className="max-h-44 overflow-y-auto px-3 py-2.5">
            {lastReply ? (
              <p className="text-[12px] leading-relaxed text-andros-primary whitespace-pre-wrap break-words">
                {lastReply.text}
              </p>
            ) : (
              <p className="text-[12px] text-andros-muted">{data.summary ?? "Esperando la primera respuesta…"}</p>
            )}
          </div>
        )}
        {thinking && (
          <p className="flex items-center gap-1.5 px-3 pb-2.5 text-[11px] text-andros-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-andros-accent" />
            {AI_PROVIDER_LABELS[data.provider]} está pensando…
          </p>
        )}
      </div>

      {data.status === "error" && data.errorMessage && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-andros-accent/10 border border-andros-accent/30" data-no-drag>
          <AlertCircle className="w-3.5 h-3.5 text-andros-accent shrink-0 mt-0.5" />
          <p className="flex-1 text-[11px] leading-relaxed text-andros-primary">{data.errorMessage}</p>
          {needsKey && (
            <button
              type="button"
              onClick={() => useAiProvidersStore.getState().setKeysModalOpen(true)}
              className="shrink-0 text-[11px] font-semibold text-andros-accent hover:underline"
            >
              Añadir clave
            </button>
          )}
        </div>
      )}
      {notice && <p className="text-[10px] font-mono text-andros-success">{notice}</p>}

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-0.5 -mx-1" data-no-drag>
        {messages.length > 0 && (
          <button type="button" className={smallBtn} onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? "Última respuesta" : `Conversación (${messages.filter((m) => !m.resync).length})`}
          </button>
        )}
        {messages.length > 0 && (
          <button type="button" className={smallBtn} onClick={openInStudio} title="Abrir la conversación en el Estudio del Oráculo">
            <Maximize2 className="w-3.5 h-3.5" />
            Estudio
          </button>
        )}
        {lastReply && (
          <button
            type="button"
            className={smallBtn}
            onClick={pushToCanvas}
            title="Crear un bloque de texto con la última respuesta, conectado a este nodo"
          >
            <Download className="w-3.5 h-3.5 -rotate-90" />
            Empujar al lienzo
          </button>
        )}
        <button
          type="button"
          className={smallBtn}
          onClick={() => setImportOpen((v) => !v)}
          title={data.source ? "Actualizar o añadir mensajes de la conversación externa" : "Importar un chat de ChatGPT, Claude o Gemini"}
        >
          {data.source ? <RefreshCw className="w-3.5 h-3.5" /> : <FileUp className="w-3.5 h-3.5" />}
          {data.source ? "Actualizar" : "Importar"}
        </button>
      </div>

      {importOpen && <ImportPanel node={node} onClose={() => setImportOpen(false)} onDone={setNotice} />}

      {/* Entrada rápida */}
      <form
        data-no-drag
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex items-end gap-1.5 p-1 pl-2.5 rounded-xl bg-andros-canvas border border-andros-border focus-within:border-andros-accent spring-micro"
      >
        <textarea
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder={needsKey ? `Añade tu clave de ${AI_PROVIDER_LABELS[data.provider]}…` : "Escribe un turno…"}
          disabled={thinking}
          className="flex-1 min-w-0 resize-none bg-transparent py-1.5 text-[12px] leading-relaxed text-andros-primary placeholder:text-andros-muted outline-none max-h-28 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={thinking || !draft.trim()}
          aria-label="Enviar"
          className="h-7 w-7 shrink-0 rounded-lg bg-andros-primary text-andros-canvas flex items-center justify-center active:scale-95 spring-micro disabled:opacity-40"
        >
          {thinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </form>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Panel de importación (enlace público o texto / archivo exportado)
// ----------------------------------------------------------------------------

const ImportPanel: React.FC<{
  node: AiChatEngineeringNode;
  onClose: () => void;
  onDone: (message: string) => void;
}> = ({ node, onClose, onDone }) => {
  const source = node.aiChatData.source;
  const [tab, setTab] = useState<ImportTab>(source && !source.url ? "paste" : "link");
  const [url, setUrl] = useState(source?.url ?? "");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [pick, setPick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const finish = (count: number, platform: string) => {
    onDone(
      count > 0
        ? `${count} mensaje(s) de ${platform} añadidos. Los cables del nodo siguen intactos.`
        : `Sin mensajes nuevos: la conversación de ${platform} ya estaba al día.`
    );
    onClose();
  };

  const importLink = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/import-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as ImportChatResponse;
      if (data.ok) {
        const count = importIntoAiNode(
          node.id,
          data.messages,
          { platform: data.platform, url: data.sourceUrl, title: data.title },
          data.title
        );
        finish(count, PLATFORM_LABELS[data.platform]);
        return;
      }
      setMessage(data.message);
      // Enlace válido pero ilegible: se sigue con "Pegar" y el enlace se guarda igual.
      if (data.code === "blocked") setTab("paste");
    } catch {
      setMessage("No se pudo contactar con el servidor. Revisa tu conexión.");
    } finally {
      setBusy(false);
    }
  };

  const analyze = (raw: string, name: string) => {
    const result = parseChatImport(raw, name);
    if (!result) {
      setParsed(null);
      setMessage("No encontré mensajes. Pega la conversación con sus turnos (por ejemplo «You said:» / «ChatGPT said:») o sube el JSON exportado.");
      return null;
    }
    setParsed(result);
    setPick(0);
    setMessage(
      result.conversations.length > 1
        ? `El archivo tiene ${result.conversations.length} conversaciones: elige una.`
        : `${result.conversations[0].messages.length} mensajes detectados de ${PLATFORM_LABELS[result.platform]}.`
    );
    return result;
  };

  const importText = () => {
    let parsedNow = parsed;
    if (!parsedNow) {
      parsedNow = analyze(text, fileName);
      // Varias conversaciones: primero se elige cuál.
      if (!parsedNow || parsedNow.conversations.length > 1) return;
    }
    const conv: ImportedConversation = parsedNow.conversations[Math.min(pick, parsedNow.conversations.length - 1)];
    const linkedUrl = url.trim() || source?.url;
    const count = importIntoAiNode(
      node.id,
      conv.messages,
      {
        platform: parsedNow.platform === "other" && source ? source.platform : parsedNow.platform,
        ...(linkedUrl ? { url: linkedUrl } : {}),
        title: conv.title,
      },
      conv.title
    );
    finish(count, PLATFORM_LABELS[parsedNow.platform]);
  };

  const handleFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setMessage("El archivo supera 50 MB. Exporta o copia solo la conversación que necesitas.");
      return;
    }
    const raw = await file.text();
    setFileName(file.name);
    setText(raw);
    analyze(raw, file.name);
  };

  const tabBtn = (active: boolean) =>
    `flex-1 h-7 rounded-lg text-[11px] font-medium spring-micro ${
      active ? "bg-andros-card text-andros-primary shadow-sm" : "text-andros-muted hover:text-andros-primary"
    }`;

  return (
    <div data-no-drag className="p-2.5 rounded-xl border border-andros-border bg-andros-canvas space-y-2">
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-andros-border/40">
        <button type="button" className={tabBtn(tab === "link")} onClick={() => setTab("link")}>
          Enlace compartido
        </button>
        <button type="button" className={tabBtn(tab === "paste")} onClick={() => setTab("paste")}>
          Pegar / archivo
        </button>
      </div>

      {tab === "link" ? (
        <div className="space-y-1.5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void importLink()}
            placeholder="https://chatgpt.com/share/… · claude.ai/share/… · gemini.google.com/share/…"
            className="w-full h-8 px-2.5 rounded-lg bg-andros-card border border-andros-border focus:border-andros-accent outline-none text-[11px] font-mono text-andros-primary placeholder:text-andros-muted"
          />
          <button
            type="button"
            onClick={() => void importLink()}
            disabled={busy || !url.trim()}
            className="w-full h-8 rounded-lg bg-andros-primary text-andros-canvas text-[11px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            {source?.url ? "Actualizar desde el enlace" : "Importar enlace público"}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <textarea
            value={text.length > 200_000 ? `(${fileName}: ${Math.round(text.length / 1024)} KB cargados)` : text}
            readOnly={text.length > 200_000}
            onChange={(e) => {
              setText(e.target.value);
              setParsed(null);
            }}
            rows={4}
            placeholder={"Pega aquí la conversación (texto o Markdown)…\n\nYou said: …\nChatGPT said: …"}
            className="w-full resize-none rounded-lg bg-andros-card border border-andros-border focus:border-andros-accent outline-none px-2.5 py-2 text-[11px] font-mono text-andros-primary placeholder:text-andros-muted"
          />
          {parsed && parsed.conversations.length > 1 && (
            <select
              value={pick}
              onChange={(e) => setPick(Number(e.target.value))}
              className="w-full h-8 px-2 rounded-lg bg-andros-card border border-andros-border text-[11px] text-andros-primary outline-none"
            >
              {parsed.conversations.slice(0, 300).map((c, i) => (
                <option key={i} value={i}>
                  {c.title} ({c.messages.length})
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-8 px-2.5 rounded-lg border border-andros-border text-[11px] text-andros-primary flex items-center gap-1.5 hover:border-andros-border-active"
            >
              <FileUp className="w-3.5 h-3.5" />
              Archivo
            </button>
            <button
              type="button"
              onClick={() => importText()}
              disabled={!text.trim()}
              className="flex-1 h-8 rounded-lg bg-andros-primary text-andros-canvas text-[11px] font-semibold disabled:opacity-40"
            >
              Importar conversación
            </button>
          </div>
          <p className="text-[10px] leading-snug text-andros-muted">
            Acepta texto copiado, Markdown o el JSON exportado de ChatGPT, Claude o Gemini (Google Takeout).
          </p>
        </div>
      )}

      {message && <p className="text-[11px] leading-snug text-andros-primary">{message}</p>}
    </div>
  );
};
