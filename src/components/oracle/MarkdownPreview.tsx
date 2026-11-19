"use client";

import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// ============================================================================
// ANDROS — VISTA PREVIA MARKDOWN DEL ESTUDIO DEL ORÁCULO
// GFM (tablas, tareas, tachado) + LaTeX con KaTeX ($…$ y $$…$$), con la
// tipografía Dual-Engine (Paper Modernist / Obsidian Monolith).
// ============================================================================

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-2 mb-4 text-2xl md:text-[28px] font-semibold tracking-tight text-andros-primary">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 pb-1.5 text-lg font-semibold tracking-tight text-andros-primary border-b border-andros-border">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-base font-semibold text-andros-primary">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wider text-andros-muted">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="my-3 leading-7 text-andros-primary">{children}</p>,
  ul: ({ children, className }) => (
    <ul
      className={`my-3 space-y-1.5 ${
        className?.includes("contains-task-list") ? "list-none pl-1" : "list-disc pl-6"
      } marker:text-andros-accent-ink`}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 space-y-1.5 list-decimal pl-6 marker:text-andros-muted marker:font-mono">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-7 text-andros-primary pl-1">{children}</li>,
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        readOnly
        className="mr-2 align-middle accent-[var(--accent-primary)]"
      />
    ) : null,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-andros-accent-ink underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-andros-primary">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 pl-4 border-l-2 border-andros-accent text-andros-muted italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-andros-border" />,
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-xl border border-andros-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-andros-canvas">{children}</thead>,
  th: ({ children, style }) => (
    <th
      style={style}
      className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-andros-muted border-b border-andros-border"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="px-3 py-2 text-andros-primary border-b border-andros-border/60 align-top">
      {children}
    </td>
  ),
  pre: ({ children }) => (
    <pre className="my-4 p-4 rounded-xl bg-andros-canvas border border-andros-border overflow-x-auto text-[13px] leading-6 font-mono">
      {children}
    </pre>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={`${className} font-mono`}>{children}</code>
    ) : (
      <code className="px-1.5 py-0.5 rounded-md bg-andros-canvas border border-andros-border text-[0.9em] font-mono">
        {children}
      </code>
    ),
};

export const MarkdownPreview: React.FC<{ markdown: string }> = ({ markdown }) => (
  <div className="andros-markdown text-[15px] break-words">
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  </div>
);
