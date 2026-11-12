import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      colors: {
        andros: {
          canvas: "var(--bg-canvas)",
          surface: "var(--surface-elevated)",
          card: "var(--surface-card)",
          border: "var(--border-subtle)",
          "border-active": "var(--border-active)",
          primary: "var(--text-primary)",
          muted: "var(--text-muted)",
          accent: "var(--accent-primary)",
          success: "var(--accent-success)",
          grid: "var(--grid-dot)",
        },
      },
      boxShadow: {
        "hud-light":
          "0 12px 36px -8px rgba(45, 45, 42, 0.08), 0 0 0 1px rgba(45, 45, 42, 0.06)",
        "hud-dark":
          "0 16px 40px -10px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08)",
        "card-light":
          "0 4px 20px -4px rgba(45, 45, 42, 0.05), 0 0 0 1px rgba(45, 45, 42, 0.05)",
        "card-dark":
          "0 8px 24px -6px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.07)",
        "sheet-dark":
          "0 -12px 40px -8px rgba(0, 0, 0, 0.7), 0 -1px 0 0 rgba(255, 255, 255, 0.08)",
        "sheet-light":
          "0 -12px 36px -8px rgba(45, 45, 42, 0.1), 0 -1px 0 0 rgba(45, 45, 42, 0.08)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.16, 1, 0.3, 1)",
        micro: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
