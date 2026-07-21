// Selectable palette themes. Applied via data-theme on <html>; persisted in
// localStorage. Swatches are the source Coolors palettes (for the picker).

export interface ThemeDef { id: string; name: string; swatch: string[] }

export const THEMES: ThemeDef[] = [
  { id: "slate", name: "Pizarra & Coral", swatch: ["#2d3142", "#4f5d75", "#ef8354", "#ffffff"] },
  { id: "navy", name: "Marino & Coral", swatch: ["#102542", "#f87060", "#cdd7d6", "#ffffff"] },
  { id: "charcoal", name: "Carbón & Teal", swatch: ["#353535", "#3c6e71", "#284b63", "#ffffff"] },
  { id: "ocean", name: "Océano", swatch: ["#022b3a", "#1f7a8c", "#bfdbf7", "#ffffff"] },
];

const KEY = "cass.theme";

export function getTheme(): string {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  return THEMES.some((x) => x.id === t) ? (t as string) : "slate";
}

export function setTheme(id: string): void {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
}

export function applyStoredTheme(): void {
  setTheme(getTheme());
}
