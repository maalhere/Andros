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
      aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={
        theme === "dark"
          ? "Cambiar a Paper Modernist (Claro)"
          : "Cambiar a Obsidian Monolith (Oscuro)"
      }
      className="w-11 h-11 md:w-9 md:h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro flex items-center justify-center"
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4 text-andros-primary" aria-hidden="true" />
      )}
    </button>
  );
};
