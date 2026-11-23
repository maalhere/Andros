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
        <li>
          <strong>Tu @usuario</strong> (opcional), que eliges tú. Junto con tu nombre y tu foto de
          perfil es lo que ven otras personas cuando te buscan o te añaden.
        </li>
      </ul>
      <h3>Amistades y espacios compartidos</h3>
      <ul>
        <li>
          <strong>Búsqueda</strong>: alguien puede encontrarte solo escribiendo tu @usuario exacto o
          tu correo exacto. La búsqueda nunca muestra tu correo, no lista cuentas de forma masiva y
          devuelve como mucho unos pocos resultados.
        </li>
        <li>
          <strong>Amistades</strong>: guardamos quién envió la solicitud, a quién y si está
          pendiente, aceptada o rechazada. Solo las dos personas de la pareja pueden verla, y
          cualquiera de las dos puede borrarla.
        </li>
        <li>
          <strong>Espacios compartidos</strong>: si el dueño de un espacio te añade como miembro,
          guardamos esa relación. Los miembros pueden ver y editar ese lienzo (nodos, cables,
          dibujos y archivos adjuntos) y ver los nombres de los demás miembros. El dueño puede
          quitar a cualquier miembro y cada miembro puede salir cuando quiera.
        </li>
        <li>
          <strong>Enlace del espacio</strong>: el enlace que copias solo contiene el identificador
          del espacio; únicamente lo abren las personas que son miembros.
        </li>
      </ul>
      <h3>Si abres un espacio en la nube o entras a su canal de voz</h3>
      <ul>
        <li>
          <strong>Presencia</strong>: al abrir un espacio en la nube, las demás personas de ese
          espacio (o de su carpeta) ven tu nombre, un color, qué espacio tienes abierto y si estás
          dentro del canal de voz, con el micrófono silenciado, la cámara encendida o compartiendo
          pantalla. Abrir un espacio NO enciende tu micrófono ni tu cámara. La presencia no se
          guarda en la base de datos.
        </li>
        <li>
          <strong>Voz, cámara y pantalla compartida</strong>: solo al pulsar «Unirse a voz» se pide
          el micrófono; la cámara y la pantalla solo se encienden si tú las activas. Viajan
          directamente entre los navegadores de quienes están en la voz (WebRTC). No pasan por
          nuestros servidores ni se graban, y se apagan al pulsar «Salir de voz».
        </li>
        <li>
          <strong>Dispositivos</strong>: el micrófono, la salida de audio y la cámara que elijas se
          recuerdan solo en el almacenamiento local de este dispositivo; nunca se envían a nuestros
          servidores.
        </li>
        <li>
          <strong>Cursor y cambios del lienzo</strong>: la posición de tu puntero y los nodos que
          editas se envían en tiempo real a las personas del espacio y se guardan en la nube del
          espacio, al que solo acceden su dueño y sus miembros.
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
          <strong>Supabase</strong>: autenticación, base de datos, almacenamiento de archivos y el
          canal en tiempo real (Realtime) que reparte la presencia, los cursores y los cambios de
          las salas en vivo.
        </li>
        <li>
          <strong>Participantes del canal de voz</strong>: para conectar la voz, la cámara y la
          pantalla directamente, los navegadores de quienes están en la voz intercambian sus
          direcciones IP de red. Para descubrirlas se consulta un servidor STUN público de Google,
          que solo ve tu dirección IP.
        </li>
        <li>
          <strong>Tus amistades y los miembros de tus espacios compartidos</strong>: ven tu nombre,
          tu @usuario y tu foto de perfil, y el contenido de los espacios que compartes con ellos.
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
        <li>
          Quitar amistades, cancelar solicitudes, quitar miembros de tus espacios o salir de un
          espacio compartido desde ⋯ → Amigos y ⋯ → Compartir espacio.
        </li>
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
