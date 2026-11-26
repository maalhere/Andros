import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { CONTACT_EMAIL, INTEGRATIONS_NOTICE, TRADEMARK_NOTICE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Términos y Condiciones",
  description:
    "Reglas de uso de Andros: planes y suscripción a Andros Pro, tu contenido, Andros Arena, normas técnicas con derechos de autor, resultados de IA, colaboración, integraciones con servicios externos, marcas de terceros y limitación de responsabilidad.",
  alternates: { canonical: "/terminos" },
};

export default function TerminosPage() {
  return (
    <LegalPage
      title="Términos y Condiciones"
      summary="Al usar Andros aceptas estas reglas. Están escritas para leerse en cinco minutos."
    >
      <h2>1. El servicio</h2>
      <p>
        Andros es un lienzo de trabajo para ingeniería e investigación: visualizar piezas 3D,
        tomar notas, enlazar cálculos y fuentes, y redactar documentos con ayuda de IA. Puedes
        usarlo sin cuenta (modo local) o con tu cuenta de Google para guardar en la nube.
      </p>

      <h2>2. Tu cuenta</h2>
      <p>
        Eres responsable de lo que ocurra en tu cuenta. Si detectas un acceso no autorizado,
        escríbenos a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>3. Tu contenido</h2>
      <p>
        Lo que creas o subes a Andros sigue siendo tuyo. Nos das únicamente el permiso necesario
        para almacenarlo, procesarlo y mostrártelo. Si publicas algo en Andros Arena como
        público, nos permites mostrarlo a otras personas mientras siga publicado; puedes
        retirarlo cuando quieras.
      </p>

      <h2>4. Contenido no permitido</h2>
      <ul>
        <li>
          <strong>Normas técnicas y documentos con derechos de autor sin licencia</strong> (por
          ejemplo, normas ISO, ASTM, ASME o IEC compradas por otra persona), software pirata o
          modelos 3D de terceros sin permiso de su autor.
        </li>
        <li>Diseños de armas, piezas para eludir medidas de seguridad o contenido ilegal.</li>
        <li>Datos personales de terceros sin su consentimiento.</li>
        <li>Spam, ofertas engañosas o publicaciones que suplanten a una persona u organización.</li>
      </ul>
      <p>
        Podemos retirar contenido que incumpla estas reglas y, en casos graves o repetidos,
        suspender la cuenta.
      </p>

      <h2>5. Andros Arena</h2>
      <p>
        Los retos, actividades, prácticas y empleos de Arena los publican sus autores, no Andros.
        No verificamos la identidad de quien publica ni garantizamos las condiciones, pagos o
        premios ofrecidos. Las publicaciones marcadas como <em>ejemplo</em> son ilustrativas y
        no corresponden a organizaciones reales. El escáner automático de Arena ayuda a filtrar
        contenido inadecuado, pero puede equivocarse: revisa cada oferta antes de compartir
        datos o trabajo, y nunca pagues por postular.
      </p>

      <h2>6. Resultados de IA y cálculos</h2>
      <p>
        El Oráculo, los nodos IA y los cálculos automáticos son herramientas de apoyo. Pueden
        contener errores. <strong>Verifica cualquier resultado de ingeniería</strong> (cargas,
        factores de seguridad, parámetros de impresión) con criterio profesional y con la
        normativa aplicable antes de fabricar, construir o usar una pieza.
      </p>

      <h2>7. Impresión 3D</h2>
      <p>
        Los perfiles de laminado y el envío a impresora se ofrecen tal cual. Supervisa siempre
        tu impresora: Andros no se responsabiliza de daños en equipos, materiales o piezas.
      </p>

      <h2>8. Espacios compartidos y colaboración</h2>
      <p>
        Quien es dueño de un espacio decide a quién lo comparte y con qué permiso (Editor,
        Comentarista o Lector), y si activa un enlace público «Vista Invitado» de solo lectura,
        que puede revocar en cualquier momento. Las personas invitadas deben respetar ese
        permiso. Al usar el chat, los comentarios, la sala de voz, la cámara o la pantalla
        compartida, respeta a las demás personas y no grabes ni difundas lo que compartan sin
        su consentimiento.
      </p>

      <h2>9. Integraciones opcionales y marcas de terceros</h2>
      <p>
        Algunas funciones se conectan, solo si tú lo decides, con servicios de otras empresas:
        el inicio de sesión, los calendarios externos (Google Calendar y Microsoft 365 /
        Outlook), los modelos de IA con tu propia clave, las fuentes de la Biblioteca y, en
        Modo Experto, las impresoras 3D de tu red local. También exportamos a formatos
        estándar (.ics, .docx, .pptx, .stl, .3mf) que otras aplicaciones pueden abrir. Puedes
        desconectar estas integraciones cuando quieras, y el uso y los posibles costes de una
        cuenta o clave tuya se rigen por tu acuerdo con ese proveedor.
      </p>
      <p>
        {INTEGRATIONS_NOTICE} {TRADEMARK_NOTICE}
      </p>

      <h2>10. Disponibilidad</h2>
      <p>
        Trabajamos para que Andros esté disponible y tus datos seguros, pero el servicio se
        ofrece «tal cual», sin garantía de funcionamiento ininterrumpido. Te recomendamos
        descargar copias .zip de los espacios importantes.
      </p>

      <h2>11. Limitación de responsabilidad</h2>
      <p>
        En la medida en que lo permita la ley, Andros no será responsable de daños indirectos,
        pérdida de datos, lucro cesante ni de decisiones tomadas a partir de resultados de la
        app. Si pagas Andros Pro, nuestra responsabilidad total se limitará a lo que hayas pagado
        en los 12 meses anteriores. Nada de esto limita los derechos que te
        reconozca la legislación de protección al consumidor de tu país.
      </p>

      <h2>12. Planes y suscripción a Andros Pro</h2>
      <ul>
        <li>
          <strong>Plan Básico (gratis)</strong>: hasta 2 espacios activos, hasta 3 participantes en
          vivo por espacio, 1 plantilla personalizada y 15 consultas IA al día con la IA de Andros
          (ilimitadas con tu propia clave), además del chat del espacio, las fichas Rojo / Verde y
          los calendarios externos. No caduca.
        </li>
        <li>
          <strong>Andros Pro</strong>: $5.99 USD al mes o $49.99 USD al año. Incluye espacios y
          plantillas ilimitados, hasta 6 participantes en vivo por espacio (5 a la vez en el canal
          de voz), 150 consultas IA al día con la IA de Andros y el Modo Experto completo (visor
          3D, fórmulas, CodeLab e impresoras). El tope de personas en vivo de un espacio depende
          del plan de su dueño.
        </li>
        <li>
          <strong>Quién vende y cobra</strong>: la suscripción la vende y la cobra Lemon Squeezy
          como <em>Merchant of Record</em> (vendedor registrado), que emite la factura y añade los
          impuestos que correspondan en tu país; el precio final se muestra antes de pagar. Andros
          no recibe ni guarda los datos de tu tarjeta.
        </li>
        <li>
          <strong>Renovación</strong>: la suscripción se renueva automáticamente al final de cada
          periodo (mensual o anual) con el mismo precio, salvo que la canceles antes. Si cambiamos
          el precio, lo avisaremos con al menos 30 días de antelación y se aplicará desde la
          siguiente renovación.
        </li>
        <li>
          <strong>Cancelación</strong>: puedes cancelar en cualquier momento desde «Planes →
          Gestionar suscripción». No se vuelve a cobrar y conservas Andros Pro hasta el final del
          periodo ya pagado (mes o año en curso); después tu cuenta vuelve al Plan Básico.
        </li>
        <li>
          <strong>Al volver al Plan Básico</strong> no se borra nada: tus espacios, plantillas y
          tarjetas siguen ahí. Solo dejas de poder crear más de 2 espacios o más de 1 plantilla, el
          tope de personas en vivo de tus espacios vuelve a 3 y las herramientas del Modo Experto
          se ocultan hasta que vuelvas a Pro.
        </li>
        <li>
          <strong>Pagos fallidos</strong>: si un cobro de renovación falla, el proveedor lo
          reintenta durante unos días y mantienes Pro mientras tanto; si no se completa, la
          suscripción vence y la cuenta vuelve al Plan Básico.
        </li>
        <li>
          <strong>Reembolsos</strong>: se rigen por la{" "}
          <Link href="/reembolsos">Política de Reembolsos</Link>.
        </li>
      </ul>

      <h2>13. Cambios y contacto</h2>
      <p>
        Si cambiamos estos términos de forma importante, lo avisaremos dentro de la app. Dudas:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
