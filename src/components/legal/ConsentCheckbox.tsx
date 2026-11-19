"use client";

import React, { useId } from "react";
import Link from "next/link";

// ============================================================================
// ANDROS — CASILLA DE CONSENTIMIENTO EXPLÍCITO (formularios públicos)
// Nunca viene marcada. Los enlaces abren en otra pestaña para no perder el
// formulario a medio llenar.
// ============================================================================

interface ConsentCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Mensaje de error si se intentó enviar sin marcar. */
  error?: string | null;
  /** id fijo para poder enfocar la casilla desde la validación del formulario. */
  id?: string;
}

export const ConsentCheckbox: React.FC<ConsentCheckboxProps> = ({ checked, onChange, error, id: fixedId }) => {
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="flex items-start gap-2.5 min-h-[44px] md:min-h-0 py-1 text-[11px] leading-relaxed text-andros-primary cursor-pointer select-none">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--accent-fill)]"
        />
        <span>
          Acepto los{" "}
          <Link href="/terminos" target="_blank" className="underline underline-offset-2 text-andros-accent-ink">
            Términos
          </Link>{" "}
          y la{" "}
          <Link href="/privacidad" target="_blank" className="underline underline-offset-2 text-andros-accent-ink">
            Política de Privacidad
          </Link>
          .
        </span>
      </label>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-[11px] text-andros-danger">
          {error}
        </p>
      )}
    </div>
  );
};
