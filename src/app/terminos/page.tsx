import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Términos y Condiciones",
  description:
    "Reglas de uso de Andros: tu contenido, Andros Arena, normas técnicas con derechos de autor, resultados de IA y limitación de responsabilidad.",
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

      <h2>8. Disponibilidad</h2>
      <p>
        Trabajamos para que Andros esté disponible y tus datos seguros, pero el servicio se
        ofrece «tal cual», sin garantía de funcionamiento ininterrumpido. Te recomendamos
        descargar copias .zip de los espacios importantes.
      </p>

      <h2>9. Limitación de responsabilidad</h2>
      <p>
        En la medida en que lo permita la ley, Andros no será responsable de daños indirectos,
        pérdida de datos, lucro cesante ni de decisiones tomadas a partir de resultados de la
        app. Si en el futuro pagas por un plan, nuestra responsabilidad total se limitará a lo
        que hayas pagado en los 12 meses anteriores. Nada de esto limita los derechos que te
        reconozca la legislación de protección al consumidor de tu país.
      </p>

      <h2>10. Planes de pago</h2>
      <p>
        Hoy Andros es gratuito. Si se lanzan planes de pago, sus condiciones y la{" "}
        <Link href="/reembolsos">Política de Reembolsos</Link> se mostrarán antes de cualquier
        cobro.
      </p>

      <h2>11. Cambios y contacto</h2>
      <p>
        Si cambiamos estos términos de forma importante, lo avisaremos dentro de la app. Dudas:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
