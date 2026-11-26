import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { ContactForm } from "@/components/legal/ContactForm";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Reembolsos y Contacto",
  description:
    "Condiciones de reembolso y cancelación de la suscripción a Andros Pro y cómo contactar con el equipo.",
  alternates: { canonical: "/reembolsos" },
};

export default function ReembolsosPage() {
  return (
    <LegalPage
      title="Política de Reembolsos y Contacto"
      summary="El Plan Básico es gratis. Andros Pro ($5.99 USD/mes o $49.99 USD/año) se cancela cuando quieras y tiene reembolso completo en los primeros 14 días."
    >
      <h2>1. Cómo se cobra</h2>
      <p>
        El único plan de pago es Andros Pro, que se contrata dentro de la app y lo cobra nuestro
        proveedor de pagos, Lemon Squeezy, como <em>Merchant of Record</em> (vendedor
        registrado). Andros nunca te pedirá datos de tarjeta por correo, mensaje ni teléfono: si
        alguien te pide dinero en nombre de Andros fuera de la app, no somos nosotros; avísanos en{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>2. Cancelación y reembolsos de Andros Pro</h2>
      <ul>
        <li>
          <strong>Cancelar</strong>: desde «Planes → Gestionar suscripción», en cualquier momento y
          sin penalización. No se vuelve a cobrar y conservas Pro hasta el final del mes o del año
          ya pagado.
        </li>
        <li>
          <strong>Primera compra</strong>: si no te convence, te devolvemos el 100 % si lo pides
          en los 14 días siguientes al cobro.
        </li>
        <li>
          <strong>Renovaciones</strong>: puedes cancelar cuando quieras desde tu cuenta; no se
          vuelve a cobrar y conservas el plan hasta el final del periodo ya pagado.
        </li>
        <li>
          <strong>Cobros por error</strong> (cobro duplicado, fallo técnico o cargo tras cancelar):
          se reembolsan siempre, sin plazo límite.
        </li>
        <li>
          El reembolso se hace al mismo medio de pago en un plazo de 5 a 10 días hábiles, según
          tu banco.
        </li>
      </ul>
      <p>
        Estas condiciones no limitan los derechos que te reconozca la ley de protección al
        consumidor de tu país.
      </p>

      <h2>3. Cómo pedir un reembolso</h2>
      <p>
        Escríbenos desde el correo de tu cuenta con el asunto «Reembolso» e indica la fecha del
        cobro. Respondemos en un máximo de 3 días hábiles.
      </p>

      <h2 id="contacto">4. Contacto</h2>
      <p>
        Para soporte, reembolsos o solicitudes sobre tus datos: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>,
        o usa este formulario.
      </p>
      <ContactForm />
    </LegalPage>
  );
}
