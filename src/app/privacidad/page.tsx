import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Política de Privacidad",
  description:
    "Qué datos recoge Andros, para qué, con quién se comparten y cómo ejercer tus derechos de acceso, rectificación y eliminación.",
  alternates: { canonical: "/privacidad" },
};

export default function PrivacidadPage() {
  return (
    <LegalPage
      title="Política de Privacidad"
      summary="Recogemos lo mínimo para que Andros funcione. Puedes usarlo sin cuenta, y tus claves de IA nunca salen de tu navegador salvo en la petición que las usa."
    >
      <h2>1. Quién es responsable</h2>
      <p>
        Andros es el responsable del tratamiento de los datos descritos aquí. Para cualquier
        consulta sobre privacidad escribe a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>2. Qué datos recogemos</h2>
      <h3>Si usas Andros sin cuenta (modo local)</h3>
      <p>
        No recogemos datos personales. Tu lienzo, preferencias y fuentes guardadas se quedan en
        el almacenamiento local de tu navegador y no se envían a nuestros servidores.
      </p>
      <h3>Si inicias sesión con Google</h3>
      <ul>
        <li>
          <strong>Datos de tu cuenta de Google</strong> que Google nos entrega al iniciar sesión:
          identificador, correo electrónico, nombre y foto de perfil.
        </li>
        <li>
          <strong>Tu contenido</strong>: espacios de trabajo, nodos, conexiones, dibujos,
          preferencias y los archivos 3D que subas, para sincronizarlos entre dispositivos.
        </li>
        <li>
          <strong>Publicaciones y postulaciones en Andros Arena</strong> que decidas enviar, junto
          con el nombre que se muestra en ellas.
        </li>
      </ul>
      <p>No pedimos teléfono, dirección, datos de pago ni documentos de identidad.</p>

      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Mantener tu sesión y guardar tu trabajo en la nube.</li>
        <li>Mostrar tus publicaciones de Arena a otras personas cuando tú las publicas.</li>
        <li>Responder a tus mensajes de soporte.</li>
      </ul>
      <p>
        No vendemos tus datos, no los usamos para publicidad y no creamos perfiles comerciales.
      </p>

      <h2>4. Con quién se comparten (encargados del tratamiento)</h2>
      <ul>
        <li>
          <strong>Supabase</strong>: autenticación, base de datos y almacenamiento de archivos.
        </li>
        <li>
          <strong>Google</strong>: inicio de sesión (OAuth) y, si usas el Oráculo o los nodos IA
          con Gemini, el texto de tu petición y el contexto del lienzo que la acompaña.
        </li>
        <li>
          <strong>OpenAI y Anthropic</strong>: solo si eliges esos modelos en un nodo IA con tu
          propia clave; reciben el texto de esa conversación.
        </li>
        <li>
          <strong>Fuentes de la Biblioteca</strong> (OpenAlex, arXiv, eCFR, Crossref, YouTube):
          reciben el término que buscas, sin datos de tu cuenta.
        </li>
        <li>
          <strong>Proveedor de alojamiento</strong> (Vercel): procesa las peticiones a la web,
          incluidas direcciones IP en registros técnicos de corta duración.
        </li>
      </ul>

      <h2>5. Tus claves de IA (BYOK)</h2>
      <p>
        Las claves de Gemini, Claude o ChatGPT que añades en <em>Claves IA</em> se guardan
        únicamente en el almacenamiento local de tu navegador. Nunca se guardan en nuestra base
        de datos. Viajan a nuestro servidor solo dentro de la petición que las usa, y el servidor
        no las almacena ni las registra. Puedes borrarlas en cualquier momento desde el mismo
        panel.
      </p>

      <h2>6. Cuánto tiempo los conservamos</h2>
      <p>
        Mientras tengas cuenta. Si eliminas un espacio, sus nodos y archivos se borran de la nube.
        Si pides la eliminación de tu cuenta, borramos tus datos en un plazo máximo de 30 días,
        salvo lo que la ley nos obligue a conservar.
      </p>

      <h2>7. Tus derechos</h2>
      <p>
        Puedes pedir acceso, rectificación, eliminación, oposición o portabilidad de tus datos.
        Escribe a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> desde el correo de tu
        cuenta; respondemos en un máximo de 30 días. También puedes:
      </p>
      <ul>
        <li>Descargar cualquier espacio como archivo .zip (menú ⋯ → Descargar / Importar .zip).</li>
        <li>Eliminar espacios y publicaciones desde la propia app.</li>
        <li>Cerrar sesión y seguir usando Andros en modo local.</li>
      </ul>
      <p>
        Si crees que no hemos atendido bien tu solicitud, puedes acudir a la autoridad de
        protección de datos de tu país.
      </p>

      <h2>8. Menores de edad</h2>
      <p>
        Andros no está dirigido a menores de 14 años. Si eres menor de edad en tu país, usa
        Andros con permiso de tu madre, padre o tutor.
      </p>

      <h2>9. Cookies</h2>
      <p>
        Usamos cookies estrictamente necesarias para mantener la sesión. Los detalles están en la{" "}
        <Link href="/cookies">Política de Cookies</Link>.
      </p>

      <h2>10. Cambios</h2>
      <p>
        Si cambiamos esta política de forma importante, lo avisaremos dentro de la app antes de
        que el cambio entre en vigor.
      </p>
    </LegalPage>
  );
}
