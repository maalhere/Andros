import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { ContactForm } from "@/components/legal/ContactForm";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Reembolsos y Contacto",
  description:
    "Condiciones de reembolso para los futuros planes de pago de Andros y cómo contactar con el equipo.",
  alternates: { canonical: "/reembolsos" },
};

export default function ReembolsosPage() {
  return (
    <LegalPage
      title="Política de Reembolsos y Contacto"
      summary="Hoy Andros es gratuito y no cobra nada. Estas condiciones se aplicarán cuando existan planes de pago."
    >
      <h2>1. Situación actual</h2>
      <p>
        Andros no tiene ninguna pasarela de pago activa. Si alguien te pide dinero en nombre de
        Andros, no somos nosotros: avísanos en <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>2. Planes de pago (cuando existan)</h2>
      <ul>
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
