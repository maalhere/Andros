"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { MEMBER_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type MemberRole } from "@/lib/access/permissions";

// ============================================================================
// ANDROS — SELECTORES DE PERMISO (Editor · Comentarista · Solo lectura)
//   · RoleSelect: <select> nativo por miembro (1 clic, accesible en móvil).
//   · RolePicker: grupo de opciones para «Añadir con permiso de…».
// ============================================================================

export const RoleSelect: React.FC<{
  value: MemberRole;
  onChange: (role: MemberRole) => void;
  label: string;
  disabled?: boolean;
}> = ({ value, onChange, label, disabled }) => (
  <span className="relative inline-flex">
    <select
      value={value}
      disabled={disabled}
      aria-label={label}
      title={ROLE_DESCRIPTIONS[value]}
      onChange={(e) => onChange(e.currentTarget.value as MemberRole)}
      className="appearance-none h-11 md:h-9 pl-2.5 pr-7 rounded-lg border border-andros-border bg-andros-surface text-xs font-medium text-andros-primary hover:border-andros-border-active focus:outline-none focus-visible:ring-2 focus-visible:ring-andros-accent/50 disabled:opacity-50"
    >
      {MEMBER_ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-andros-muted"
      aria-hidden="true"
    />
  </span>
);

export const RolePicker: React.FC<{
  value: MemberRole;
  onChange: (role: MemberRole) => void;
  labelledBy: string;
}> = ({ value, onChange, labelledBy }) => (
  <div className="space-y-1.5">
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-andros-canvas border border-andros-border"
    >
      {MEMBER_ROLES.map((role) => {
        const active = role === value;
        return (
          <button
            key={role}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(role)}
            className={`min-h-[44px] md:min-h-[32px] px-1.5 rounded-lg text-[11px] font-medium active:scale-[0.96] spring-micro ${
              active
                ? "bg-andros-card text-andros-primary shadow-sm border border-andros-border-active"
                : "text-andros-muted hover:text-andros-primary border border-transparent"
            }`}
          >
            {ROLE_LABELS[role]}
          </button>
        );
      })}
    </div>
    <p className="text-[11px] text-andros-muted">{ROLE_DESCRIPTIONS[value]}</p>
  </div>
);
