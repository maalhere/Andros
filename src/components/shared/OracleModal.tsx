"use client";

import React, { useState } from "react";
import { Sparkles, Send, PlusCircle, X, Cpu } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

interface OracleModalProps {
  embeddedInSheet?: boolean;
}

export const OracleModal: React.FC<OracleModalProps> = ({
  embeddedInSheet = false,
}) => {
  const isOracleModalOpen = useWorkspaceStore((s) => s.isOracleModalOpen);
  const setOracleModalOpen = useWorkspaceStore((s) => s.setOracleModalOpen);
  const spawnNode = useWorkspaceStore((s) => s.spawnNode);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);

  const [prompt, setPrompt] = useState("");
  const [lastSynthesis, setLastSynthesis] = useState<string>(
    "Puedo auditar factores de seguridad, sintetizar normativas ASTM/ISO o generar nuevos nodos de cálculo directamente en tu espacio de trabajo."
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!embeddedInSheet && !isOracleModalOpen) return null;

  const handleSynthesize = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    const generatedText = `Análisis para "${prompt}": Se recomienda rigidez torsional incrementada en un 14% empleando perfil tubular cerrado y verificación de pandeo lateral.`;
    setLastSynthesis(generatedText);
    setPrompt("");
  };

  const handleSendSynthesisToWorkspace = () => {
    spawnNode({
      type: "oracle",
      title: "Oráculo IA • Dictamen",
      codeTag: "AI-SYNTH",
      summary: lastSynthesis,
      actionLabel: "Consultar ⌘K",
    });
    setOracleModalOpen(false);
  };

  const content = (
    <div className="w-full flex flex-col gap-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between pb-3 border-b border-andros-border">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-andros-accent/15 text-andros-accent">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-andros-primary">
              Oráculo IA • Consola de Ingeniería
            </h3>
            <p className="text-[11px] font-mono text-andros-muted">
              {selectedNode
                ? `Contexto activo: ${selectedNode.title} (${selectedNode.codeTag})`
                : "Contexto global del proyecto"}
            </p>
          </div>
        </div>

        {!embeddedInSheet && (
          <button
            onClick={() => setOracleModalOpen(false)}
            className="p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Respuesta Sintetizada */}
      <div className="p-3.5 rounded-xl bg-andros-canvas border border-andros-border space-y-2.5">
        <div className="flex items-center justify-between text-[10px] font-mono text-andros-muted">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-andros-accent" />
            MOTOR DE SÍNTESIS TÉCNICA
          </span>
          <span className="text-andros-success">● LISTO</span>
        </div>
        <p className="text-xs leading-relaxed text-andros-primary">
          {lastSynthesis}
        </p>
        <div className="pt-1 flex justify-end">
          <button
            type="button"
            onClick={handleSendSynthesisToWorkspace}
            className="px-3 py-1.5 rounded-lg bg-andros-accent/15 hover:bg-andros-accent/25 text-andros-accent text-[11px] font-medium flex items-center gap-1.5 spring-micro active:scale-95"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Insertar como Nodo en el Espacio</span>
          </button>
        </div>
      </div>

      {/* Input de Comando */}
      <form onSubmit={handleSynthesize} className="flex items-center gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Pregunta sobre cargas, materiales o pide un cálculo..."
          className="flex-1 bg-andros-canvas border border-andros-border focus:border-andros-accent rounded-xl px-3.5 py-2.5 text-xs text-andros-primary placeholder:text-andros-muted outline-none spring-micro"
        />
        <button
          type="submit"
          className="px-4 py-2.5 rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 active:scale-95 spring-micro"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Ejecutar</span>
        </button>
      </form>
    </div>
  );

  if (embeddedInSheet) return content;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/45 backdrop-blur-sm"
      onClick={() => setOracleModalOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 spring-micro"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
};