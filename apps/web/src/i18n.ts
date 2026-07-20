// Lightweight i18n for the app shell (nav, titles, hints). Deeper per-screen
// coverage can grow the dictionaries incrementally; strings fall back to English
// then to the key itself.

export type Lang = "en" | "es";

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    home: "Home", stats: "Stats", templates: "Templates", build: "Build",
    run: "Run", inbox: "Inbox", monitor: "Monitor", settings: "Settings",
    overview: "Overview", workflow: "Workflow",
    home_hint: "Your workflows at a glance",
    stats_hint: "Monitor runs across all workflows",
    templates_hint: "Start from a ready-made banking workflow",
    build_hint: "Design the process and its forms",
    run_hint: "Try it as an end user",
    inbox_hint: "Your worklist of open human tasks",
    monitor_hint: "Watch running instances",
    settings_hint: "API keys and connectors",
  },
  es: {
    home: "Inicio", stats: "Estadísticas", templates: "Plantillas", build: "Diseñar",
    run: "Ejecutar", inbox: "Bandeja", monitor: "Monitor", settings: "Ajustes",
    overview: "Resumen", workflow: "Flujo",
    home_hint: "Tus flujos de un vistazo",
    stats_hint: "Monitorea las ejecuciones de todos los flujos",
    templates_hint: "Empieza desde un flujo bancario listo para usar",
    build_hint: "Diseña el proceso y sus formularios",
    run_hint: "Pruébalo como usuario final",
    inbox_hint: "Tu lista de tareas humanas abiertas",
    monitor_hint: "Observa las instancias en ejecución",
    settings_hint: "Claves de API y conectores",
  },
};

let lang: Lang = (typeof localStorage !== "undefined" && (localStorage.getItem("cass.lang") as Lang)) || "en";

export const getLang = (): Lang => lang;
export function setLang(l: Lang): void {
  lang = l;
  try { localStorage.setItem("cass.lang", l); } catch { /* ignore */ }
}
export function t(key: string): string {
  return DICT[lang][key] ?? DICT.en[key] ?? key;
}
