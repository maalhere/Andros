import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { CookiePreferencesLink } from "@/components/legal/CookiePreferencesLink";

export const metadata: Metadata = {
  title: "Política de Cookies",
  description:
    "Qué cookies y almacenamiento local usa Andros: solo las necesarias para la sesión y tus preferencias; la analítica opcional requiere tu permiso.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Política de Cookies"
      summary="Andros funciona con cookies estrictamente necesarias. Nada opcional se activa sin que pulses «Aceptar todas»."
    >
      <h2>1. Estrictamente necesarias (siempre activas)</h2>
      <p>Sin ellas no podrías iniciar sesión ni conservar tu trabajo. No requieren consentimiento.</p>
      <div className="legal-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Qué</th>
              <th scope="col">Para qué</th>
              <th scope="col">Duración</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cookies de sesión de Supabase (<code>sb-…-auth-token</code>)</td>
              <td>Mantener tu sesión de Google iniciada</td>
              <td>Hasta cerrar sesión</td>
            </tr>
            <tr>
              <td>Almacenamiento local: preferencias, tutorial y último espacio abierto</td>
              <td>Recordar tema, ajustes del lienzo y dónde te quedaste</td>
              <td>Hasta que lo borres</td>
            </tr>
            <tr>
              <td>Almacenamiento local: claves IA (BYOK)</td>
              <td>Usar tus propias claves sin guardarlas en nuestros servidores</td>
              <td>Hasta que las borres</td>
            </tr>
            <tr>
              <td>
                Almacenamiento local: plantillas de tablero propias (<code>andros_custom_templates</code>)
              </td>
              <td>Reutilizar la estructura de un evento anterior sin gastar consultas de IA</td>
              <td>Hasta que las borres</td>
            </tr>
            <tr>
              <td>
                Almacenamiento local: librería de fichas (<code>andros_form_library</code>)
              </td>
              <td>Guardar tus formatos de ficha replicables (sin valores ni fotos)</td>
              <td>Hasta que los borres</td>
            </tr>
            <tr>
              <td>Almacenamiento local: fuentes guardadas, caché de búsqueda y Arena sin cuenta</td>
              <td>Funcionar sin conexión y sin cuenta</td>
              <td>Hasta que lo borres</td>
            </tr>
            <tr>
              <td>
                Almacenamiento local: <code>andros-cookie-consent</code>
              </td>
              <td>Recordar tu elección en este aviso</td>
              <td>Hasta que la cambies</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>2. Analítica (opcional)</h2>
      <p>
        Hoy Andros <strong>no usa ninguna herramienta de analítica</strong>. Si en el futuro
        añadimos una para medir de forma agregada qué funciones se usan, solo se cargará si
        pulsas «Aceptar todas», y la nombraremos en esta página.
      </p>

      <h2>3. Publicidad</h2>
      <p>Andros no usa cookies de publicidad ni de seguimiento entre sitios.</p>

      <h2>4. Cambiar tu elección</h2>
      <p>
        Puedes cambiarla cuando quieras:{" "}
        <CookiePreferencesLink className="underline underline-offset-2 text-andros-accent-ink" />.
        También puedes borrar las cookies y el almacenamiento local desde los ajustes de tu
        navegador; al hacerlo se cerrará tu sesión y se perderá el trabajo guardado solo en
        local.
      </p>
    </LegalPage>
  );
}
