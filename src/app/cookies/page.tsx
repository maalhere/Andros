import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { CookiePreferencesLink } from "@/components/legal/CookiePreferencesLink";

export const metadata: Metadata = {
  title: "Política de Cookies",
  description:
    "Qué cookies y almacenamiento local usa Andros: las necesarias para la sesión y tus preferencias; la analítica opcional (Microsoft Clarity y PostHog) requiere tu permiso.",
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
                Almacenamiento local: impresora 3D elegida y su IP privada (
                <code>andros-printer-model</code>, <code>andros-klipper-targets</code>,{" "}
                <code>andros-adv3-ip</code>)
              </td>
              <td>Recordar tu impresora y conectarla por tu Wi-Fi sin volver a escribir la IP</td>
              <td>Hasta que lo borres</td>
            </tr>
            <tr>
              <td>
                Almacenamiento de sesión: permiso de Google Calendar (<code>andros.calendar.token</code>)
                y almacenamiento local: aviso de conexión pendiente (<code>andros.calendar.pending</code>)
              </td>
              <td>
                Solo si pulsas «Conectar Google Calendar»: enviar hitos a tu calendario o importar tu
                agenda sin volver a pedir permiso en esa pestaña
              </td>
              <td>Menos de 1 hora (token) · 10 minutos (aviso)</td>
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
        Solo se activa si pulsas «Aceptar todas» y si la versión de Andros que usas la tiene
        configurada. Con «Solo necesarias» no se carga ni se envía nada. Sirve para saber de
        forma agregada qué funciones se usan y dónde se atasca la interfaz; el contenido de tus
        tarjetas, fichas, fórmulas y chats IA se enmascara y nunca se envía.
      </p>
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
              <td>
                Microsoft Clarity: cookies <code>_clck</code> y <code>_clsk</code>
              </td>
              <td>Mapas de calor y grabación de sesión con el contenido enmascarado</td>
              <td>
                <code>_clck</code> 1 año · <code>_clsk</code> 1 día
              </td>
            </tr>
            <tr>
              <td>
                PostHog: almacenamiento local <code>andros-telemetry-id</code> (sin cookies)
              </td>
              <td>
                Identificador aleatorio para contar eventos de uso (sin contenido, sin perfil de
                persona y sin geolocalización)
              </td>
              <td>Hasta que retires el consentimiento</td>
            </tr>
          </tbody>
        </table>
      </div>

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
