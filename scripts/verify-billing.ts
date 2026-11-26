// ============================================================================
// ANDROS — VERIFICACIÓN SPRINT 21: MONETIZACIÓN ($5.99/MES) Y LÍMITES REALES
// Ejecuta: npm run verify:billing   (sin navegador, sin red, sin Supabase)
//
//   1. Precios coherentes: $5.99 USD/mes y $49.99 USD/año (ahorra 2 meses)
//      en la fuente única, en los textos de planes y en las páginas legales.
//   2. Límites reales Plan Básico vs. Andros Pro (espacios, personas en vivo,
//      plantillas, cuota IA y Modo Experto) y su aplicación en el código.
//   3. Plan efectivo desde la fila de `user_subscriptions` (estados y margen).
//   4. Cuota IA del servidor por plan (15 / 150) con el mismo contador.
//   5. Firma HMAC-SHA256 del webhook: acepta la válida y rechaza alteradas o
//      ausentes; lectura de eventos de suscripción.
//   6. Respuesta segura (503, mensaje limpio) cuando faltan las variables de
//      la pasarela, ejecutando las rutas reales.
//   7. Esquema SQL §21: RLS de solo lectura y topes iguales a los del código.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  ANNUAL_MONTHS_SAVED,
  PERIOD_GRACE_MS,
  PLAN_LIMITS,
  PRO_PRICING,
  PRO_STATUSES,
  UNLIMITED,
  aiDailyLimit,
  canCreateSpace,
  canSaveCustomTemplate,
  liveParticipantCap,
  planFromSubscription,
} from "@/lib/billing/planLimits";
import {
  BILLING_UNAVAILABLE_MESSAGE,
  HANDLED_EVENTS,
  buildCheckoutBody,
  parseSubscriptionWebhook,
  readBillingConfig,
  readWebhookSecret,
  signWebhookBody,
  verifyWebhookSignature,
} from "@/lib/billing/lemonSqueezy";
import { ANNUAL_SAVINGS_LABEL, FREE_PLAN, PLAN_COMPARISON, PRO_PLAN } from "@/lib/plans";
import { FREE_DAILY_LIMIT, PRO_DAILY_LIMIT, dailyLimitMessage } from "@/lib/ai/freeQuota";
import { IP_FALLBACK_LIMIT, quotaForUser, serverQuotaAllows, serverQuotaConsume } from "@/lib/ai/serverQuota";
import { MAX_SPACE_PARTICIPANTS, MAX_VOICE_PARTICIPANTS } from "@/types/collab";
import { POST as checkoutPOST } from "@/app/api/billing/checkout/route";
import { POST as webhookPOST } from "@/app/api/billing/webhook/route";
import { GET as portalGET } from "@/app/api/billing/portal/route";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail, null, 1).slice(0, 2000)}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const BILLING_ENV = [
  "LEMONSQUEEZY_API_KEY",
  "LEMONSQUEEZY_STORE_ID",
  "LEMONSQUEEZY_VARIANT_MONTHLY",
  "LEMONSQUEEZY_VARIANT_ANNUAL",
  "LEMONSQUEEZY_WEBHOOK_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
];

async function main(): Promise<void> {
  // Este verificador nunca debe tocar la pasarela real.
  for (const name of BILLING_ENV) delete process.env[name];

  // --------------------------------------------------------------------------
  section("1. Precios ($5.99 USD/mes · $49.99 USD/año)");
  check("mensual = 5.99", PRO_PRICING.monthly.amount === 5.99 && PRO_PRICING.monthly.label === "$5.99");
  check("anual = 49.99", PRO_PRICING.annual.amount === 49.99 && PRO_PRICING.annual.label === "$49.99");
  check("periodos en USD", PRO_PRICING.monthly.period === "USD / mes" && PRO_PRICING.annual.period === "USD / año");
  // 12 × $5.99 = $71.88; $49.99 al año ahorra $21.89 ≈ 3,65 mensualidades.
  // La etiqueta se calcula con los precios reales: nunca promete de más.
  const monthsSaved = (PRO_PRICING.monthly.amount * 12 - PRO_PRICING.annual.amount) / PRO_PRICING.monthly.amount;
  check("el anual ahorra al menos 2 meses", monthsSaved >= 2, monthsSaved);
  check("la etiqueta de ahorro es exacta («más de N meses», N = parte entera)",
    ANNUAL_MONTHS_SAVED === Math.floor(monthsSaved) && ANNUAL_SAVINGS_LABEL === `ahorra más de ${ANNUAL_MONTHS_SAVED} meses` && monthsSaved > ANNUAL_MONTHS_SAVED,
    { monthsSaved, ANNUAL_MONTHS_SAVED, ANNUAL_SAVINGS_LABEL });
  check("el anual es más barato que 12 mensualidades", PRO_PRICING.annual.amount < PRO_PRICING.monthly.amount * 12);
  check("tarjeta Pro muestra $5.99 USD / mes", PRO_PLAN.price === "$5.99" && PRO_PLAN.period === "USD / mes", PRO_PLAN);
  check("tarjeta Pro muestra $49.99 USD / año", PRO_PLAN.altPrice?.includes("$49.99 USD / año") === true, PRO_PLAN.altPrice);
  check("Plan Básico $0", FREE_PLAN.price === "$0" && FREE_PLAN.name === "Plan Básico");

  // Ningún texto viejo de precio o de «aún no cobramos» en src/.
  const srcFiles = walk("src");
  const stale: string[] = [];
  for (const f of srcFiles) {
    const text = read(f);
    if (/\$9(?![\d.,])|\b9 USD\b|Pro \$9|\$4\.99|\$12(?![\d.,])/.test(text)) stale.push(`${f}: precio antiguo`);
    if (/Pro todavía no se cobra|Aún no cobramos|Acceso anticipado a Pro|abierta durante el acceso anticipado/.test(text)) stale.push(`${f}: «aún no se cobra»`);
  }
  check("sin precios antiguos ni «aún no se cobra» en src/", stale.length === 0, stale);
  for (const page of ["src/app/terminos/page.tsx", "src/app/reembolsos/page.tsx", "src/app/privacidad/page.tsx"]) {
    const text = read(page);
    check(`${page} documenta $5.99 y $49.99`, text.includes("$5.99") && text.includes("$49.99"));
  }
  const terms = read("src/app/terminos/page.tsx");
  check("términos: Merchant of Record, renovación y cancelación", /Merchant of Record/.test(terms) && /Renovación/.test(terms) && /Cancelación/.test(terms));
  const privacy = read("src/app/privacidad/page.tsx");
  check("privacidad: sin datos de tarjeta en Andros", /no recibe ni guarda datos de tarjeta/i.test(privacy) && /Lemon Squeezy/.test(privacy));
  check("cookies: el pago ocurre en el dominio del proveedor", /propio dominio/.test(read("src/app/cookies/page.tsx")));

  // --------------------------------------------------------------------------
  section("2. Límites reales Plan Básico vs. Andros Pro");
  const free = PLAN_LIMITS.free;
  const pro = PLAN_LIMITS.pro;
  check("Básico: 2 espacios · 3 en vivo · 1 plantilla · 15 IA/día · sin Experto",
    free.maxSpaces === 2 && free.maxLiveParticipants === 3 && free.maxCustomTemplates === 1 && free.aiDailyQueries === 15 && !free.expertMode, free);
  check("Pro: espacios ∞ · 6 en vivo · plantillas ∞ · 150 IA/día · Experto",
    pro.maxSpaces === UNLIMITED && pro.maxLiveParticipants === 6 && pro.maxCustomTemplates === UNLIMITED && pro.aiDailyQueries === 150 && pro.expertMode, pro);
  check("espacios: Básico crea el 2.º, bloquea el 3.º", canCreateSpace("free", 1) && !canCreateSpace("free", 2) && !canCreateSpace("free", 7));
  check("espacios: Pro crea sin tope", canCreateSpace("pro", 2) && canCreateSpace("pro", 10_000));
  check("en vivo: 3 en Básico, 6 en Pro", liveParticipantCap("free") === 3 && liveParticipantCap("pro") === 6);
  check("tope absoluto de la sala = tope Pro", MAX_SPACE_PARTICIPANTS === pro.maxLiveParticipants);
  check("voz nunca supera el tope del espacio Básico (min(5, 3) = 3)", Math.min(MAX_VOICE_PARTICIPANTS, liveParticipantCap("free")) === 3);
  check("plantillas: Básico guarda 1, bloquea la 2.ª", canSaveCustomTemplate("free", 0, false) && !canSaveCustomTemplate("free", 1, false));
  check("plantillas: reemplazar la del mismo nombre sí se permite", canSaveCustomTemplate("free", 1, true));
  check("plantillas: Pro sin tope", canSaveCustomTemplate("pro", 400, false));
  check("cuota IA: 15 y 150", aiDailyLimit("free") === 15 && aiDailyLimit("pro") === 150 && FREE_DAILY_LIMIT === 15 && PRO_DAILY_LIMIT === 150);
  check("avisos de cuota con su número", dailyLimitMessage("free").includes("15") && dailyLimitMessage("pro").includes("150"));

  const featureText = (p: typeof FREE_PLAN) => p.features.join(" · ");
  check("textos Básico = límites", /Hasta 2 espacios/.test(featureText(FREE_PLAN)) && /Hasta 3 participantes en vivo/.test(featureText(FREE_PLAN)) && /1 plantilla/.test(featureText(FREE_PLAN)) && /15 consultas IA/.test(featureText(FREE_PLAN)), FREE_PLAN.features);
  check("textos Básico: chat, fichas Rojo / Verde y calendarios", /Rojo \/ Verde/.test(featureText(FREE_PLAN)) && /Calendarios externos/.test(featureText(FREE_PLAN)));
  check("textos Pro = límites", /Espacios ilimitados/.test(featureText(PRO_PLAN)) && /Hasta 6 participantes en vivo/.test(featureText(PRO_PLAN)) && /ilimitadas/.test(featureText(PRO_PLAN)) && /150 consultas IA/.test(featureText(PRO_PLAN)) && /Modo Experto completo/.test(featureText(PRO_PLAN)), PRO_PLAN.features);
  check("comparación: Modo Experto solo en Pro", PLAN_COMPARISON.some((r) => /Modo Experto/.test(r.label) && r.free === null));
  check("comparación: sin filas «solo Pro» que el código no limita", PLAN_COMPARISON.filter((r) => r.free === null).every((r) => /Modo Experto/.test(r.label)), PLAN_COMPARISON);

  // Aplicación en el código (cero promesas falsas).
  const cloudSync = read("src/hooks/useCloudSync.ts");
  check("crear y duplicar espacio pasan por guardSpaceCreation", (cloudSync.match(/await guardSpaceCreation\(manager\(\)\.workspaces\.length\)/g) ?? []).length === 2);
  const room = read("src/lib/collab/useCollabRoom.ts");
  check("la sala usa el tope del espacio (sin 6 fijo)", room.includes("const cap = spaceCap();") && !/>=\s*MAX_SPACE_PARTICIPANTS/.test(room) && !/slice\(0, MAX_(SPACE|VOICE)_PARTICIPANTS\)/.test(room));
  check("la sala lee workspace_live_cap del plan del dueño", read("src/lib/billing/subscriptionClient.ts").includes('rpc("workspace_live_cap"'));
  check("«Guardar como plantilla» pasa por guardTemplateSave", /await guardTemplateSave\(/.test(read("src/lib/templates/applyBlueprint.ts")));
  const modeSetters = srcFiles.filter((f) => f !== "src/store/useSettingsStore.ts" && f !== "src/lib/billing/entitlements.ts" && /setExperienceMode\(/.test(read(f)));
  check("el Modo Experto solo se activa por chooseExperienceMode", modeSetters.length === 0, modeSetters);
  check("usePlanEnforcement y useSubscriptionSync montados en page.tsx", /usePlanEnforcement\(\);/.test(read("src/app/page.tsx")) && /useSubscriptionSync\(\);/.test(read("src/app/page.tsx")));

  // --------------------------------------------------------------------------
  section("3. Plan efectivo desde user_subscriptions");
  const now = Date.parse("2026-11-26T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  check("sin fila → free", planFromSubscription(null, now) === "free");
  check("pro activo → pro", planFromSubscription({ plan: "pro", status: "active", current_period_end: iso(now + 20 * day) }, now) === "pro");
  check("pro en prueba → pro", planFromSubscription({ plan: "pro", status: "on_trial", current_period_end: null }, now) === "pro");
  check("cancelado con periodo vigente → pro hasta el final", planFromSubscription({ plan: "pro", status: "cancelled", current_period_end: iso(now + 5 * day) }, now) === "pro");
  check("cancelado y vencido (más allá del margen) → free", planFromSubscription({ plan: "pro", status: "cancelled", current_period_end: iso(now - PERIOD_GRACE_MS - 1000) }, now) === "free");
  check("renovación con aviso tardío dentro del margen → pro", planFromSubscription({ plan: "pro", status: "active", current_period_end: iso(now - day) }, now) === "pro");
  check("expired / unpaid / paused → free", ["expired", "unpaid", "paused"].every((status) => planFromSubscription({ plan: "pro", status, current_period_end: null }, now) === "free"));
  check("plan free con estado activo → free", planFromSubscription({ plan: "free", status: "active" }, now) === "free");
  check("estados con acceso Pro", [...PRO_STATUSES].sort().join(",") === "active,cancelled,on_trial,past_due");

  // --------------------------------------------------------------------------
  section("4. Cuota IA del servidor por plan");
  const freeQuota = quotaForUser("00000000-0000-4000-8000-000000000001", "free");
  const proQuota = quotaForUser("00000000-0000-4000-8000-000000000002", "pro");
  check("clave por persona y tope del plan", freeQuota.key.startsWith("user:") && freeQuota.limit === 15 && proQuota.limit === 150);
  for (let i = 0; i < 15; i += 1) serverQuotaConsume(freeQuota.key);
  check("Básico: la 16.ª consulta del día se rechaza", !serverQuotaAllows(freeQuota.key, freeQuota.limit));
  for (let i = 0; i < 15; i += 1) serverQuotaConsume(proQuota.key);
  check("Pro: sigue tras 15", serverQuotaAllows(proQuota.key, proQuota.limit));
  for (let i = 15; i < 150; i += 1) serverQuotaConsume(proQuota.key);
  check("Pro: la 151.ª se rechaza", !serverQuotaAllows(proQuota.key, proQuota.limit));
  check("sin sesión: respaldo por IP = Básico × 2", IP_FALLBACK_LIMIT === 30);
  const aiRoutes = walk("src/app/api").filter((f) => /serverQuotaAllows\(/.test(read(f)));
  const singleArg = aiRoutes.filter((f) => /serverQuotaAllows\([^,()]+\)/.test(read(f)));
  check(`las ${aiRoutes.length} rutas de IA pasan el tope del plan`, aiRoutes.length >= 10 && singleArg.length === 0, singleArg);
  const ipRoutes = aiRoutes.filter((f) => /clientIp\(/.test(read(f)));
  check("ninguna ruta de IA cuenta solo por IP", ipRoutes.length === 0, ipRoutes);

  // --------------------------------------------------------------------------
  section("5. Firma HMAC del webhook");
  const secret = "whsec_verificacion_andros_2026";
  const body = JSON.stringify({ meta: { event_name: "subscription_created" }, data: { id: "1" } });
  const signature = signWebhookBody(body, secret);
  check("firma válida → aceptada", verifyWebhookSignature(body, signature, secret));
  check("firma en mayúsculas → aceptada", verifyWebhookSignature(body, signature.toUpperCase(), secret));
  check("cuerpo alterado → rechazada", !verifyWebhookSignature(body.replace('"1"', '"2"'), signature, secret));
  const flipped = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
  check("firma alterada → rechazada", !verifyWebhookSignature(body, flipped, secret));
  check("firma ausente → rechazada", !verifyWebhookSignature(body, null, secret) && !verifyWebhookSignature(body, "", secret));
  check("firma de otro largo o no-hex → rechazada", !verifyWebhookSignature(body, signature.slice(2), secret) && !verifyWebhookSignature(body, "z".repeat(64), secret));
  check("otro secreto → rechazada", !verifyWebhookSignature(body, signature, "otro_secreto_distinto_123"));
  check("sin secreto → rechazada", !verifyWebhookSignature(body, signature, null));
  const lemonSrc = read("src/lib/billing/lemonSqueezy.ts");
  check("comparación en tiempo constante (timingSafeEqual)", /timingSafeEqual\(given, expected\)/.test(lemonSrc) && !/signature\s*===|===\s*signature/.test(lemonSrc));
  const webhookSrc = read("src/app/api/billing/webhook/route.ts");
  check("la ruta verifica la firma ANTES de leer el JSON", webhookSrc.indexOf("verifyWebhookSignature(") > 0 && webhookSrc.indexOf("verifyWebhookSignature(") < webhookSrc.indexOf("JSON.parse("));
  check("eventos atendidos", HANDLED_EVENTS.join(",") === "subscription_created,subscription_updated,subscription_cancelled,subscription_expired");

  const userId = "5b0a8c1e-1234-4abc-9def-0123456789ab";
  const variants = { monthly: "111", annual: "222" };
  const event = (name: string, attrs: Record<string, unknown>, custom: Record<string, unknown> = { user_id: userId }) => ({
    meta: { event_name: name, custom_data: custom },
    data: { type: "subscriptions", id: "9001", attributes: { customer_id: 77, variant_id: 111, renews_at: "2026-12-26T00:00:00.000000Z", ends_at: null, ...attrs } },
  });
  const created = parseSubscriptionWebhook(event("subscription_created", { status: "active" }), variants);
  check("created activo → pro mensual con renovación", created.kind === "subscription" && created.row.plan === "pro" && created.row.billing_cycle === "monthly" && created.row.current_period_end === "2026-12-26T00:00:00.000Z" && created.row.provider_subscription_id === "9001" && created.row.provider_customer_id === "77", created);
  const annual = parseSubscriptionWebhook(event("subscription_updated", { status: "active", variant_id: 222 }), variants);
  check("updated con variante anual → annual", annual.kind === "subscription" && annual.row.billing_cycle === "annual");
  const cancelled = parseSubscriptionWebhook(event("subscription_cancelled", { status: "cancelled", ends_at: "2026-12-20T00:00:00Z" }), variants);
  check("cancelled → pro hasta ends_at", cancelled.kind === "subscription" && cancelled.row.plan === "pro" && cancelled.row.status === "cancelled" && cancelled.row.current_period_end === "2026-12-20T00:00:00.000Z");
  const expired = parseSubscriptionWebhook(event("subscription_expired", { status: "expired", ends_at: "2026-11-20T00:00:00Z" }), variants);
  check("expired → free", expired.kind === "subscription" && expired.row.plan === "free" && expired.row.status === "expired");
  check("unpaid → free", (() => { const r = parseSubscriptionWebhook(event("subscription_updated", { status: "unpaid" }), variants); return r.kind === "subscription" && r.row.plan === "free"; })());
  check("evento no manejado → ignorado", parseSubscriptionWebhook(event("order_created", { status: "paid" }), variants).kind === "ignored");
  check("user_id inválido → ignorado", parseSubscriptionWebhook(event("subscription_created", { status: "active" }, { user_id: "x' or 1=1" }), variants).kind === "ignored");
  check("cuerpo vacío → ignorado", parseSubscriptionWebhook(null).kind === "ignored");

  // --------------------------------------------------------------------------
  section("6. Respuesta segura sin variables de la pasarela");
  const empty = readBillingConfig({});
  check("sin variables → sin configuración", empty.config === null && empty.missing.length === 4, empty.missing);
  check("variante no numérica → sin configuración", readBillingConfig({ LEMONSQUEEZY_API_KEY: "k".repeat(40), LEMONSQUEEZY_STORE_ID: "1", LEMONSQUEEZY_VARIANT_MONTHLY: "abc", LEMONSQUEEZY_VARIANT_ANNUAL: "2" }).config === null);
  const full = readBillingConfig({ LEMONSQUEEZY_API_KEY: "k".repeat(40), LEMONSQUEEZY_STORE_ID: "10", LEMONSQUEEZY_VARIANT_MONTHLY: "111", LEMONSQUEEZY_VARIANT_ANNUAL: "222" });
  check("configuración completa → lista", full.config !== null && full.missing.length === 0);
  check("secreto corto o ausente → null", readWebhookSecret({}) === null && readWebhookSecret({ LEMONSQUEEZY_WEBHOOK_SECRET: "corto" }) === null);
  if (full.config) {
    const bodyCheckout = buildCheckoutBody(full.config, { userId, email: "persona@ejemplo.com", cycle: "annual", redirectUrl: "https://andros.example/?pro=gracias" });
    check("checkout: variante anual, tienda y custom.user_id", bodyCheckout.data.relationships.variant.data.id === "222" && bodyCheckout.data.relationships.store.data.id === "10" && bodyCheckout.data.attributes.checkout_data.custom.user_id === userId);
  }

  const jsonOf = async (res: Response) => (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Los avisos de servidor («Pagos sin configurar…») se capturan: son parte de
  // lo que se comprueba (registro para quien opera), no ruido de la prueba.
  const serverLogs: string[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: unknown[]) => void serverLogs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void serverLogs.push(args.map(String).join(" "));
  const checkoutRes = await checkoutPOST(new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ cycle: "monthly" }), headers: { "Content-Type": "application/json" } }));
  const checkoutJson = await jsonOf(checkoutRes);
  check("checkout sin variables → 503 «Los pagos se activarán muy pronto»", checkoutRes.status === 503 && checkoutJson.error === BILLING_UNAVAILABLE_MESSAGE && BILLING_UNAVAILABLE_MESSAGE.startsWith("Los pagos se activarán muy pronto"), { status: checkoutRes.status, checkoutJson });
  check("checkout: no filtra nombres de variables al navegador", !/LEMONSQUEEZY|API_KEY/.test(JSON.stringify(checkoutJson)));
  const badCycle = await checkoutPOST(new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ cycle: "weekly" }) }));
  check("checkout con ciclo inválido → 400", badCycle.status === 400);
  const portalRes = await portalGET(new NextRequest("http://localhost/api/billing/portal"));
  check("portal sin variables → 503", portalRes.status === 503);
  const whNoSecret = await webhookPOST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body }));
  check("webhook sin secreto → 503 (el proveedor reintenta)", whNoSecret.status === 503);

  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = secret;
  const whNoSig = await webhookPOST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body }));
  check("webhook sin firma → 401", whNoSig.status === 401);
  const whBadSig = await webhookPOST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body, headers: { "X-Signature": flipped } }));
  check("webhook con firma alterada → 401", whBadSig.status === 401);
  const ignoredBody = JSON.stringify({ meta: { event_name: "order_created" }, data: {} });
  const whIgnored = await webhookPOST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body: ignoredBody, headers: { "X-Signature": signWebhookBody(ignoredBody, secret) } }));
  check("webhook firmado con evento ajeno → 200 ignorado", whIgnored.status === 200 && typeof (await jsonOf(whIgnored)).ignored === "string");
  const realBody = JSON.stringify(event("subscription_created", { status: "active" }));
  const whNoService = await webhookPOST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body: realBody, headers: { "X-Signature": signWebhookBody(realBody, secret) } }));
  check("webhook válido sin clave de servicio → 503 (no se pierde el aviso)", whNoService.status === 503);
  delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  console.warn = originalWarn;
  console.error = originalError;
  check("el servidor registra qué variable falta (solo en su log)", serverLogs.some((l) => l.includes("LEMONSQUEEZY_API_KEY")) && serverLogs.some((l) => l.includes("SUPABASE_SERVICE_ROLE_KEY")), serverLogs);

  const clientWrites = srcFiles.filter((f) => f !== "src/app/api/billing/webhook/route.ts" && /from\("user_subscriptions"\)[\s\S]{0,120}\.(insert|upsert|update|delete)\(/.test(read(f)));
  check("solo el webhook escribe user_subscriptions", clientWrites.length === 0, clientWrites);
  const publicSecrets = srcFiles.filter((f) => /NEXT_PUBLIC_LEMON|NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(read(f)));
  check("ninguna variable de pagos es NEXT_PUBLIC_", publicSecrets.length === 0, publicSecrets);

  // --------------------------------------------------------------------------
  section("7. Esquema SQL §21");
  const sql = read("supabase/schema.sql");
  const s21 = sql.slice(sql.indexOf("-- 21. (Sprint 21)"));
  check("sección §21 presente", s21.length > 200 && s21.includes("create table if not exists public.user_subscriptions"));
  check("columnas requeridas", ["user_id", "plan", "status", "billing_cycle", "provider", "provider_customer_id", "provider_subscription_id", "current_period_end", "updated_at"].every((c) => new RegExp(`add column if not exists ${c}\\b|^\\s+${c}\\s`, "m").test(s21)));
  check("user_id referencia auth.users", /user_id\s+uuid primary key references auth\.users/.test(s21));
  check("check plan in ('free','pro')", s21.includes("check (plan in ('free','pro'))"));
  check("RLS activada", s21.includes("alter table public.user_subscriptions enable row level security;"));
  check("SELECT solo de la fila propia", /for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/.test(s21));
  check("sin políticas de escritura para el navegador", !/create policy[^;]*on public\.user_subscriptions\s+for (insert|update|delete|all)/i.test(s21));
  check("escrituras revocadas a anon y authenticated", s21.includes("revoke insert, update, delete, truncate on public.user_subscriptions from anon, authenticated;"));
  const statusList = s21.match(/s\.status in \(([^)]*)\)/)?.[1]?.replace(/['\s]/g, "").split(",").sort().join(",");
  check("user_plan(): mismos estados Pro que el código", statusList === [...PRO_STATUSES].sort().join(","), statusList);
  check("user_plan(): mismo margen (72 h)", s21.includes("interval '72 hours'") && PERIOD_GRACE_MS === 72 * 3600 * 1000);
  check("user_plan() sin acceso desde el navegador", s21.includes("revoke all on function public.user_plan(uuid) from public, anon, authenticated;"));
  check(`workspace_live_cap(): ${pro.maxLiveParticipants} Pro / ${free.maxLiveParticipants} Básico`, new RegExp(`= 'pro' then ${pro.maxLiveParticipants}\\s+else ${free.maxLiveParticipants}`).test(s21));
  check("workspace_live_cap() solo para miembros", s21.includes("when not public.is_workspace_member(ws_id) then null"));
  check(`trigger de espacios: máx. ${free.maxSpaces} en Básico`, s21.includes(`if owned >= ${free.maxSpaces} then`) && s21.includes("before insert on public.workspaces"));
  check("idempotente (drop … if exists antes de crear)", /drop trigger if exists workspaces_enforce_plan_limit/.test(s21) && /drop policy if exists "user_subscriptions_select_own"/.test(s21));

  // --------------------------------------------------------------------------
  console.log(`\n${passed} correctas · ${failed} fallidas`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
