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
          <strong>Espacios compartidos y permisos</strong>: si el dueño de un espacio te añade como
          miembro, guardamos esa relación y el permiso que te asignó. Hay tres permisos:{" "}
          <strong>Editor</strong> (ve y edita el lienzo: nodos, cables, dibujos y archivos
          adjuntos), <strong>Comentarista</strong> (ve el lienzo y escribe comentarios, sin
          editarlo) y <strong>Lector</strong> («Solo lectura»: ve el lienzo y lee los comentarios).
          La base de datos impone estos permisos, no solo la app. Todos los miembros ven los
          nombres de los demás. El dueño puede cambiar el permiso o quitar a cualquier miembro, y
          cada miembro puede salir cuando quiera.
        </li>
        <li>
          <strong>Comentarios del tablero</strong>: guardamos el texto de cada comentario, la
          tarjeta a la que está anclado (si la hay), tu identificador, el nombre visible con el que
          lo firmaste, la fecha y si está resuelto. Solo los ven el dueño y los miembros de ese
          espacio, y se envían en tiempo real a quienes lo tienen abierto. El dueño, los editores y
          la propia persona autora pueden marcarlo como resuelto o borrarlo; se borran también al
          eliminar el espacio. No se incluyen en la Vista Invitado.
        </li>
        <li>
          <strong>Áreas de trabajo y chat del lienzo</strong>: el dueño puede asignar a cada persona
          un área nominal (por ejemplo, Logística o Presupuesto) que ven los miembros del espacio.
          En el chat guardamos el texto de cada mensaje, las menciones (@Área o @usuario), la
          tarjeta enlazada (si la hay), tu identificador, tu nombre visible y tu área (tomados de tu
          perfil por la base de datos) y la fecha. Solo los leen el dueño y los miembros de ese
          espacio; lo borran su autor o el dueño, y se borran al eliminar el espacio. No se incluyen
          en la Vista Invitado. Al escribir <strong>@IA</strong>, el mensaje y un resumen de las
          tarjetas del tablero se envían a nuestro proveedor de IA (Google Gemini) para evaluar qué
          tarjetas y áreas afecta; el resultado se guarda en el chat como alerta del espacio.
        </li>
        <li>
          <strong>Aviso por correo al compartir</strong>: cuando el dueño te añade a un espacio o
          cambia tu permiso, podemos enviarte un correo transaccional con el nombre de quien lo
          compartió, el nombre del tablero, tu permiso y el enlace al espacio. Tu correo se lee
          solo en nuestro servidor para hacer el envío y <strong>nunca se muestra</strong> al dueño
          ni a otros miembros. El envío lo hace nuestro proveedor de correo (Resend). No es
          publicidad: solo se envía por una acción de compartir.
        </li>
        <li>
          <strong>Enlace del espacio</strong>: el enlace que copias solo contiene el identificador
          del espacio; únicamente lo abren las personas que son miembros.
        </li>
        <li>
          <strong>Enlace público «Vista Invitado»</strong> (opcional, solo lo activa el dueño del
          espacio): genera una dirección <code>/ver/…</code> con un código aleatorio prácticamente imposible de
          adivinar (<code>public_share_token</code>). Cualquier persona que tenga ese enlace puede
          ver el tablero en <strong>solo lectura y sin cuenta</strong>: el nombre del espacio, el
          texto de las tarjetas, las tablas, los enlaces, los nombres de los archivos adjuntos y
          los campos y <strong>fotos de las fichas</strong>.
          Nunca muestra correos, perfiles, quién es el dueño, los archivos en sí ni el historial
          de los chats IA (solo su resumen). La página no se indexa en buscadores y no abre voz,
          cámara ni el canal en tiempo real. Puedes <strong>revocarlo en cualquier momento</strong>{" "}
          desde ⋯ → Compartir espacio: al desactivarlo deja de funcionar al instante, y «Generar
          enlace nuevo» invalida el anterior para siempre. Borrar el espacio también lo elimina.
        </li>
      </ul>
      <h3>Librería de fichas y fotos adjuntas</h3>
      <ul>
        <li>
          <strong>Librería de fichas</strong>: los formatos que creas (título, categoría y nombres
          de los campos, sin valores) se guardan en el almacenamiento local de tu navegador
          (<code>andros_form_library</code>) y, si inicias sesión, en tu perfil de la nube
          (<code>form_library</code>) para usarlos en tus otros dispositivos. Solo tú los ves.
        </li>
        <li>
          <strong>Fichas del lienzo</strong>: los valores que escribes y las fotos que adjuntas se
          guardan como parte del espacio (igual que el resto de tarjetas): en tu navegador en modo
          local, o en la nube del espacio, a la que solo acceden su dueño y sus miembros, y en una
          Vista Invitado si la activas.
        </li>
        <li>
          <strong>Fotos</strong>: se comprimen en tu propio dispositivo (máximo 1280 px, WebP o
          JPEG) antes de guardarse. No se envían a ningún servicio de IA ni se analizan.
        </li>
        <li>
          <strong>«Llenar fichas con IA»</strong>: solo al pulsar el botón se envían a Google Gemini
          el texto que pegas y los nombres de los campos de las fichas elegidas (nunca las fotos).
          El servidor de Andros no guarda ese texto. Con la clave compartida del servidor se aplica
          el límite diario de consultas gratis; con tu propia clave (BYOK) la petición se hace a tu
          cuenta de Google.
        </li>
        <li>
          <strong>Fichas de Fórmula</strong>: el cálculo con los datos de tus fichas conectadas se
          hace por completo en tu navegador, sin IA. Solo si pulsas «Generar fórmula con IA» se
          envían a Google Gemini la descripción que escribes y los nombres, claves y unidades de los
          campos numéricos del tablero (nunca sus valores ni las fotos). El servidor de Andros no
          guarda esa descripción; se aplican las mismas reglas de cuota y de clave propia (BYOK).
        </li>
      </ul>
      <p>
        <strong>Aviso de responsabilidad sobre datos sensibles.</strong> Andros es una herramienta
        de organización general y no es un sistema certificado de historia clínica. Si usas la
        clave compartida del servidor, evita escribir datos clínicos o personales identificables
        (nombres completos, documentos, diagnósticos de personas reales): usa iniciales o datos de
        ejemplo, o configura tu propia clave en Claves IA. Para un uso médico regulado, consulta
        antes la normativa de protección de datos de salud de tu país y obtén asesoría legal; eres
        responsable de contar con el consentimiento de las personas cuyos datos registres.
      </p>
      <h3>Estudio de exportación (PDF, .docx, .pptx y resumen para mensajería) y aviso de pagos Pro</h3>
      <ul>
        <li>
          <strong>Directo del tablero (sin IA)</strong>: el PDF imprimible, el documento .docx, la
          presentación .pptx y el resumen de texto para pegar en tu app de mensajería se generan por
          completo en tu navegador e incluyen los campos de las fichas, las tablas, las fórmulas y
          sus fotos. No se envía nada a nuestros servidores; tú decides dónde guardas o compartes el
          archivo, y si lo subes a un servicio de terceros (almacenamiento en la nube, editores en
          línea o mensajería) se aplica la política de ese servicio.
        </li>
        <li>
          <strong>«Sintetizar y ordenar con IA»</strong>: solo si eliges esta opción, se envían a
          Google Gemini el texto de las tarjetas del espacio (notas, campos de las fichas, tablas con
          sus totales y fórmulas con sus valores y resultados), el nombre del espacio, la
          instrucción opcional que escribas y, de cada foto, solo una referencia interna y su
          etiqueta. <strong>Las imágenes nunca se envían a Gemini ni a nuestros servidores</strong>:
          se incrustan en el .docx, el .pptx o el PDF dentro de tu propio dispositivo. El servidor de
          Andros no guarda ese contenido ni la estructura que devuelve la IA; se aplican la misma
          cuota diaria gratuita y las mismas reglas de clave propia (BYOK) que en el resto de
          funciones de IA. Funciona también en espacios compartidos en solo lectura, con el
          contenido que ya puedes ver.
        </li>
        <li>
          <strong>Aviso de apertura de pagos de Andros Pro</strong>: si los pagos aún no están
          activos, el formulario no guarda nada; abre tu app de correo con la solicitud lista para
          que la envíes tú a nuestro buzón de contacto. Solo recibimos el correo que decidas enviar.
        </li>
      </ul>
      <h3>Suscripción a Andros Pro (pagos)</h3>
      <ul>
        <li>
          <strong>Quién cobra</strong>: el pago de Andros Pro ($5.99 USD al mes o $65.99 USD al año)
          lo procesa Lemon Squeezy, que actúa como <em>Merchant of Record</em> (vendedor
          registrado): emite la factura, calcula y liquida los impuestos de tu país y custodia los
          datos de pago. Escribes tu tarjeta (u otro medio de pago) en su página, nunca en Andros.
        </li>
        <li>
          <strong>Andros no recibe ni guarda datos de tarjeta</strong>. Al crear el cobro le
          enviamos tu identificador interno de cuenta, el ciclo elegido (mensual o anual) y, para
          precargar el formulario, tu correo. De vuelta, el proveedor nos envía un aviso firmado
          con el estado de la suscripción.
        </li>
        <li>
          <strong>Qué guardamos</strong> en la tabla de suscripciones: tu plan (Básico o Pro), el
          estado (activa, cancelada, vencida…), el ciclo, el fin del periodo pagado y los
          identificadores de cliente y de suscripción del proveedor. Solo tú puedes leer tu fila;
          únicamente nuestro servidor la modifica al recibir un aviso firmado del proveedor.
        </li>
        <li>
          <strong>Para qué</strong>: aplicar los límites de tu plan (espacios, personas en vivo,
          plantillas, consultas IA y Modo Experto) y abrir el portal donde gestionas o cancelas tu
          suscripción. El tratamiento del pago en sí se rige además por la política de privacidad
          de Lemon Squeezy.
        </li>
      </ul>
      <h3>Google Calendar (opcional)</h3>
      <ul>
        <li>
          <strong>Detección de fechas</strong>: las fechas y horas de tus fichas y cronogramas se
          reconocen por completo en tu navegador, sin IA y sin enviar nada a nuestros servidores.
        </li>
        <li>
          <strong>«Abrir en Google Calendar» y «Descargar .ics»</strong>: no necesitan ningún
          permiso. El enlace abre Google Calendar con el título, la fecha, la descripción y el
          enlace al tablero ya escritos (Google lo trata según su política); el archivo .ics se
          genera en tu dispositivo y se descarga solo si lo permites.
        </li>
        <li>
          <strong>Conexión directa</strong>: solo si pulsas «Conectar Google Calendar», Google te
          pide el permiso adicional <code>calendar.events</code> (crear y leer eventos). El token
          que Google devuelve se guarda temporalmente en el almacenamiento de sesión de esa pestaña
          (<code>andros.calendar.token</code>, menos de una hora) y se borra al cerrarla o al pulsar
          «Desconectar». Para enviar hitos o importar tus próximos 14 días, nuestro servidor
          reenvía la petición a Google con ese token y te devuelve el resultado:{" "}
          <strong>no guardamos tu calendario, tus eventos ni el token</strong> en nuestra base de
          datos. Los eventos que importes pasan a ser una tarjeta del espacio, como cualquier otra.
          Puedes retirar el permiso en cualquier momento desde la configuración de tu cuenta de
          Google (Seguridad → Apps de terceros con acceso a tu cuenta).
        </li>
      </ul>
      <h3>Calendario de Microsoft 365 / Outlook (opcional)</h3>
      <ul>
        <li>
          <strong>«Abrir en Calendario de Microsoft»</strong>: no necesita ningún permiso. El enlace
          abre Outlook en la web (cuenta de trabajo o escuela, o personal, según elijas) con el
          título, la fecha, la hora con tu zona horaria, la descripción y el enlace al tablero ya
          escritos (Microsoft lo trata según su política). Tu elección de tipo de cuenta se recuerda
          en el almacenamiento local de tu navegador.
        </li>
        <li>
          <strong>Conexión directa (acceso incremental)</strong>: solo si pulsas «Conectar cuenta
          de Microsoft», Microsoft te pide los permisos <code>email</code>, <code>User.Read</code>{" "}
          (tu nombre y correo) y <code>Calendars.ReadWrite</code> (crear y leer eventos de tu
          calendario). Es opcional y se pide aparte del inicio de sesión: no cambia tu cuenta de
          Andros. El token que Microsoft devuelve se guarda temporalmente en el almacenamiento de
          sesión de esa pestaña (<code>andros.calendar.ms-token</code>, menos de una hora) y se
          borra al cerrarla o al pulsar «Desconectar». Para enviar hitos o importar tus próximos 14
          días, nuestro servidor reenvía la petición a Microsoft Graph con ese token y te devuelve
          el resultado: <strong>no guardamos tu calendario, tus eventos ni el token</strong> en
          nuestra base de datos.
        </li>
        <li>
          <strong>Cuenta vinculada</strong>: para conceder el permiso sin cambiar de sesión, nuestro
          proveedor de autenticación (Supabase) registra la cuenta de Microsoft vinculada a la tuya
          (identificador de Microsoft, correo y nombre), igual que hace con Google al iniciar
          sesión. Puedes pedirnos desvincularla por correo, y retirar el permiso en cualquier
          momento desde tu cuenta de Microsoft (account.microsoft.com → Privacidad → Aplicaciones
          y servicios) o, en cuentas de trabajo o escuela, desde myapps.microsoft.com.
        </li>
      </ul>
      <h3>Impresión 3D multi-impresora (Modo Experto)</h3>
      <ul>
        <li>
          <strong>Impresora elegida y su IP local</strong>: el modelo que eliges (por ejemplo,
          Creality K2 SE o FlashForge Adventurer 3) y, si la conectas por Wi-Fi, su dirección IP
          privada y su puerto se guardan solo en el almacenamiento local de tu dispositivo
          (<code>andros-printer-model</code>, <code>andros-klipper-targets</code> y{" "}
          <code>andros-adv3-ip</code>). Nunca se envían a nuestra base de datos.
        </li>
        <li>
          <strong>Conexión directa en tu red</strong>: Andros solo habla con la impresora desde la
          app de Windows o desde un servidor de Andros que corre en tu propia red. Solo acepta
          direcciones de redes privadas (10.x.x.x, 172.16–31.x.x y 192.168.x.x) y los puertos
          estándar de cada impresora (8899 en FlashForge; 7125, 4408 u 80 en Moonraker/Fluidd de
          Klipper). La web pública nunca contacta con tu impresora ni con tu red.
        </li>
        <li>
          <strong>Archivos de impresión</strong>: el .gx, .gcode o .stl preparado viaja de tu
          dispositivo directamente a tu impresora o a tu laminador; no pasa por nuestros
          servidores. Para Bambu Lab, Prusa, Anycubic y otras, el archivo se descarga (con tu
          permiso) o se abre en el programa que elijas.
        </li>
        <li>
          <strong>Laminadores instalados (app de Windows)</strong>: para abrir el archivo en 1
          clic, la app comprueba si Creality Print, OrcaSlicer, Bambu Studio, PrusaSlicer o
          FlashPrint están en las carpetas de instalación estándar de Windows. El resultado se
          queda en tu equipo; el archivo se guarda en una carpeta temporal de Windows antes de
          abrirse.
        </li>
      </ul>
      <h3>Medición de uso opcional (Microsoft Clarity y PostHog)</h3>
      <ul>
        <li>
          <strong>Solo con tu permiso</strong>: estas herramientas se cargan únicamente si pulsas
          «Aceptar todas» en el aviso de cookies y si la versión de Andros que usas las tiene
          activadas. Con «Solo necesarias» no se carga nada ni se hace ninguna petición a ellas.
        </li>
        <li>
          <strong>PostHog (eventos de producto)</strong>: registramos acciones sueltas, sin su
          contenido: que se creó un espacio, se generó un tablero, se llenaron fichas con IA (solo
          cuántas), se creó una fórmula, se exportó un entregable (pdf, docx, pptx o resumen de texto), se
          activó un enlace de invitado, alguien entró a voz o se eligió una impresora (su modelo).
          Cada evento lleva un identificador aleatorio guardado en tu navegador
          (<code>andros-telemetry-id</code>), sin perfil de persona y sin geolocalización.
          Nunca enviamos texto de notas, fichas, fórmulas o chats IA, nombres de espacios o de
          personas, enlaces con códigos de invitado ni tus claves de IA.
        </li>
        <li>
          <strong>Microsoft Clarity (mapas de calor y grabación de sesión)</strong>: registra
          movimientos, clics y desplazamientos para detectar problemas de uso. El contenido de las
          tarjetas (notas, fichas, fórmulas y chats IA), los diálogos con datos y los campos de
          texto se <strong>enmascaran</strong>: Clarity ve recuadros vacíos, no tu contenido.
        </li>
        <li>
          Ambos servicios reciben tu dirección IP como parte de la conexión. Si retiras el
          consentimiento, Clarity deja de grabar y se borra el identificador anónimo.
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
          espacio, al que solo acceden su dueño y sus miembros. Con permiso de Comentarista o
          Lector no se envían cambios del lienzo; los comentarios sí viajan en tiempo real.
        </li>
      </ul>
      <p>
        No pedimos teléfono, dirección ni documentos de identidad, y Andros nunca recibe datos de
        tarjeta: si pasas a Pro, el pago lo gestiona el proveedor descrito arriba.
      </p>

      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Mantener tu sesión y guardar tu trabajo en la nube.</li>
        <li>Mostrar tus publicaciones de Arena a otras personas cuando tú las publicas.</li>
        <li>Responder a tus mensajes de soporte.</li>
        <li>Si pasas a Andros Pro: aplicar tu plan y gestionar tu suscripción.</li>
        <li>
          Solo si aceptas la analítica opcional: medir de forma agregada qué funciones se usan y
          dónde falla la interfaz, para mejorarla.
        </li>
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
          <strong>Lemon Squeezy</strong> (Merchant of Record): cobro de la suscripción a Andros Pro,
          facturación e impuestos. Recibe tu identificador interno de cuenta, el ciclo elegido y tu
          correo, además de los datos de pago que escribes directamente en su página.
        </li>
        <li>
          <strong>Resend</strong>: envío de los correos transaccionales «te compartieron un
          espacio» o «tu permiso cambió». Recibe tu correo, tu nombre, el nombre de quien compartió,
          el nombre del tablero, el permiso y el enlace al espacio, solo para entregar ese mensaje.
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
          <strong>Quien tenga un enlace de Vista Invitado que tú activaste</strong>: ve el contenido
          de ese tablero en solo lectura, sin tus datos de cuenta, hasta que lo desactives.
        </li>
        <li>
          <strong>Google</strong>: inicio de sesión (OAuth) y, si usas el Oráculo, los nodos IA o el
          generador de tableros («¿Qué evento o proyecto vas a organizar?») con Gemini, el texto de
          tu petición y, en el Oráculo y los nodos IA, el contexto del lienzo que la acompaña. Si
          usas «Revisar impacto» o las «Alertas automáticas» de descuadre, se envía el contenido de
          la tarjeta editada (antes y después del cambio) y el de sus tarjetas conectadas; las
          alertas resultantes solo se comparten por el canal en vivo con quienes están en tu
          espacio y no se guardan en la nube. Si usas «Llenar fichas con IA», se envían el texto
          que pegas y el esquema de las fichas elegidas (sin fotos). Si usas «Generar fórmula con
          IA», se envían tu descripción y los nombres de los campos numéricos del tablero (sin sus
          valores). Si exportas con «Sintetizar y ordenar con IA», se envían el texto y los datos de
          las tarjetas del espacio y tu instrucción opcional, nunca las fotos. Si conectas Google
          Calendar, se envían los hitos que eliges enviar (título, fecha, hora, descripción y enlace
          al tablero) y se leen tus eventos de los próximos 14 días cuando pulsas «Importar». Las
          plantillas que guardas desde «Guardar como plantilla» se quedan solo en el
          almacenamiento local de tu navegador.
        </li>
        <li>
          <strong>Microsoft (Microsoft Graph / Outlook)</strong>: solo si conectas tu cuenta de
          Microsoft, se envían los hitos que eliges enviar (título, fecha, hora, zona horaria,
          descripción y enlace al tablero) y se leen tus eventos de los próximos 14 días cuando
          pulsas «Importar». Si usas «Abrir en Calendario de Microsoft», esos mismos datos del hito
          viajan en el enlace que abre Outlook en tu navegador.
        </li>
        <li>
          <strong>Microsoft (Clarity) y PostHog</strong>: solo si aceptas la analítica opcional y
          está activada; reciben los eventos y las sesiones con el contenido enmascarado descritos
          en el punto 2.
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
        Las claves de Google Gemini, Anthropic (Claude) u OpenAI que añades en <em>Claves IA</em> se guardan
        únicamente en el almacenamiento local de tu navegador. Nunca se guardan en nuestra base
        de datos. Viajan a nuestro servidor solo dentro de la petición que las usa, y el servidor
        no las almacena ni las registra. Puedes borrarlas en cualquier momento desde el mismo
        panel.
      </p>

      <h2>6. Cuánto tiempo los conservamos</h2>
      <p>
        Mientras tengas cuenta. Si eliminas un espacio, sus nodos y archivos se borran de la nube.
        Si pides la eliminación de tu cuenta, borramos tus datos en un plazo máximo de 30 días,
        salvo lo que la ley nos obligue a conservar. La fila de tu suscripción se borra con tu
        cuenta; las facturas y los registros de pago los conserva el proveedor de pagos durante el
        plazo que exige la ley fiscal.
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
          Quitar amistades, cancelar solicitudes, quitar miembros de tus espacios, cambiar su
          permiso o salir de un espacio compartido desde ⋯ → Amigos y ⋯ → Compartir espacio.
        </li>
        <li>Borrar tus comentarios desde ⋯ → Comentarios.</li>
        <li>
          Desconectar Google Calendar o el calendario de Microsoft en la pestaña desde el botón
          Calendarios (o ⋯ → Calendarios), y retirar el permiso desde tu cuenta de Google o de
          Microsoft.
        </li>
        <li>
          Desactivar un enlace público «Vista Invitado» o generar uno nuevo (el anterior deja de
          funcionar) desde ⋯ → Compartir espacio → Enlace público.
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
        Usamos cookies estrictamente necesarias para mantener la sesión, y analítica opcional
        (Microsoft Clarity y PostHog) solo si la aceptas. Los detalles están en la{" "}
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
