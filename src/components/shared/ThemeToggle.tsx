"use client";

import React from "react";
import { Sun, Moon } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

export const ThemeToggle: React.FC = () => {
  const theme = useWorkspaceStore((s) => s.theme);
  const toggleTheme = useWorkspaceStore((s) => s.toggleTheme);

  return (
    <button
      onClick={toggleTheme}
      type="button"
      aria-label="Alternar Modo Oscuro / Claro"
      title={
        theme === "dark"
          ? "Cambiar a Paper Modernist (Claro)"
          : "Cambiar a Obsidian Monolith (Oscuro)"
      }
      className="min-w-[40px] min-h-[40px] md:min-w-0 md:min-h-0 p-2 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm hover:scale-105 active:scale-95 spring-micro flex items-center justify-center"
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4 text-amber-400/90" />
      ) : (
        <Moon className="w-4 h-4 text-andros-primary" />
      )}
    </button>
  );
};
