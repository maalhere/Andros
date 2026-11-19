"use client";

import React from "react";
import { openCookiePreferences } from "@/lib/consent";

/** Vuelve a abrir el banner de cookies para cambiar la elección. */
export const CookiePreferencesLink: React.FC<{ className?: string }> = ({ className }) => (
  <button type="button" onClick={openCookiePreferences} className={className}>
    Preferencias de cookies
  </button>
);
