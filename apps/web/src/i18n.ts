// Lightweight i18n for the app shell (nav, titles, hints). Deeper per-screen
// coverage can grow the dictionaries incrementally; strings fall back to English
// then to the key itself.

export type Lang = "en" | "es";

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    home: "Home", stats: "Stats", templates: "Templates", build: "Flows",
    forms: "Forms", agents: "Integrations",
    run: "Run", inbox: "Inbox", monitor: "Executions", drafts: "Incomplete", audit: "Audit", settings: "Settings",
    overview: "Overview", workflow: "Workflow", design: "Design", operate: "Operate", governance: "Governance",
    home_hint: "Your workflows at a glance",
    stats_hint: "Monitor runs across all workflows",
    templates_hint: "Start from a ready-made banking workflow",
    build_hint: "Design a process: human tasks, agents and forms",
    forms_hint: "Design and reuse forms across your flows",
    agents_hint: "A catalog of connections -- APIs, AI agents and MCP tools -- to invoke from your flows",
    run_hint: "Try it as an end user",
    inbox_hint: "Your worklist of open human tasks",
    monitor_hint: "Every application, end to end — data, AI decisions, approvals",
    drafts_hint: "Applications a customer started but never finished — nudge them to come back",
    audit_hint: "Everything users did on the platform — who, what, when, from where",
    settings_hint: "API keys and connectors",
  },
  es: {
    home: "Inicio", stats: "Estadísticas", templates: "Plantillas", build: "Flujos",
    forms: "Formularios", agents: "Integraciones",
    run: "Ejecutar", inbox: "Bandeja", monitor: "Ejecuciones", drafts: "Sin completar", audit: "Auditoría", settings: "Ajustes",
    overview: "Resumen", workflow: "Flujo", design: "Diseño", operate: "Operación", governance: "Gobierno",
    home_hint: "Tus flujos de un vistazo",
    stats_hint: "Monitorea las ejecuciones de todos los flujos",
    templates_hint: "Empieza desde un flujo bancario listo para usar",
    build_hint: "Diseñá un proceso: tareas humanas, agentes y formularios",
    forms_hint: "Diseñá y reutilizá formularios en tus flujos",
    agents_hint: "Un catálogo de conexiones -- APIs, agentes de IA y MCP -- para invocar desde tus flujos",
    run_hint: "Pruébalo como usuario final",
    inbox_hint: "Tu lista de tareas humanas abiertas",
    monitor_hint: "Cada solicitud, de punta a punta — datos, decisiones de IA y aprobaciones",
    drafts_hint: "Solicitudes que un cliente empezó y dejó a medias — invitalo a volver",
    audit_hint: "Todo lo que hicieron los usuarios en la plataforma — quién, qué, cuándo y desde dónde",
    settings_hint: "Claves de API y conectores",
  },
};

let lang: Lang = "es"; // single-language product (Banco del Futuro demo)

export const getLang = (): Lang => lang;
export function setLang(l: Lang): void {
  lang = l;
  try { localStorage.setItem("cass.lang", l); } catch { /* ignore */ }
}
export function t(key: string): string {
  return DICT[lang][key] ?? DICT.en[key] ?? key;
}
