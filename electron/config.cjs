// ANDROS — Configuración de la app de Windows.
// ANDROS_URL (variable de entorno) tiene prioridad sobre ambos valores.
module.exports = {
  /** App instalada (.exe): la web de producción en Vercel. */
  productionUrl: "https://andros-workspace.vercel.app",
  /** npm run desktop:dev: el servidor local de Next.js. */
  devUrl: "http://localhost:3000",
  appId: "com.andros.desktop",
  productName: "Andros",
  colors: {
    dark: { background: "#0D0E11", text: "#EDEDEF", muted: "#8B8D94", border: "#1E2027" },
    light: { background: "#F6F5F2", text: "#1A1A18", muted: "#6B6A66", border: "#E6E4DF" },
  },
  titleBarHeight: 36,
};
