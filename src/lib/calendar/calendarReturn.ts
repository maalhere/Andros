"use client";

// ============================================================================
// ANDROS — VUELTA DE «CONECTAR» (Google Calendar o Microsoft) — Sprint 19
// Montar UNA vez (page.tsx). Al volver de Google o de Microsoft (web o app de
// Windows) recoge el `provider_token` efímero de la sesión, lo asigna al
// proveedor que se pidió (marcador de calendarPending) y abre el panel de
// Calendarios externos. El token solo vive en sessionStorage de la pestaña.
// ============================================================================

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCalendarStore } from "@/store/useCalendarStore";
import { toast } from "@/store/useToastStore";
import {
  CALENDAR_RETURN_PARAM,
  isPlausibleProviderToken,
  takeCalendarPending,
  type CalendarProvider,
} from "./calendarPending";
import { ISSUE_MESSAGES, restoreGoogleConnection, saveGoogleToken } from "./googleCalendarClient";
import { MICROSOFT_ISSUE_MESSAGES, restoreMicrosoftConnection, saveMicrosoftToken } from "./microsoftCalendarClient";

const CONNECTED_MESSAGES: Record<CalendarProvider, string> = {
  google: "Google Calendar conectado en esta pestaña.",
  microsoft: "Calendario de Microsoft conectado en esta pestaña.",
};

function accept(provider: CalendarProvider, token: string | null | undefined): boolean {
  if (!isPlausibleProviderToken(token)) return false;
  if (provider === "microsoft") saveMicrosoftToken(token);
  else saveGoogleToken(token);
  return true;
}

export function useExternalCalendarReturn(): void {
  useEffect(() => {
    restoreGoogleConnection();
    restoreMicrosoftConnection();

    const url = new URL(window.location.href);
    const returned = url.searchParams.has(CALENDAR_RETURN_PARAM);
    if (returned) {
      url.searchParams.delete(CALENDAR_RETURN_PARAM);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !returned) return;
      const provider = takeCalendarPending();
      if (provider && accept(provider, data.session?.provider_token)) {
        toast({ message: CONNECTED_MESSAGES[provider], tone: "success" });
      } else if (provider) {
        toast({
          message: provider === "microsoft" ? MICROSOFT_ISSUE_MESSAGES.scope_missing : ISSUE_MESSAGES.scope_missing,
          tone: "error",
        });
      }
      useCalendarStore.getState().openModal(null);
    });

    // App de Windows: la sesión llega por exchangeCodeForSession en esta ventana.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event !== "SIGNED_IN" && event !== "USER_UPDATED") || !session?.provider_token) return;
      const provider = takeCalendarPending();
      if (!provider) return;
      if (accept(provider, session.provider_token)) {
        toast({ message: CONNECTED_MESSAGES[provider].replace("pestaña", "ventana"), tone: "success" });
        useCalendarStore.getState().openModal(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
}
