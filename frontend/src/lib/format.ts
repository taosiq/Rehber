/** Small display helpers shared by dashboard pages. */

export const LANG_NAMES: Record<string, string> = {
  tr: "Turkish", en: "English", de: "German", ru: "Russian", fr: "French", ar: "Arabic", fa: "Persian", ur: "Urdu",
};

export const CHANNEL_NAMES: Record<string, string> = {
  widget: "Website", playground: "Playground", whatsapp: "WhatsApp", eval: "Evaluation",
};

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Nov". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "yesterday";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
