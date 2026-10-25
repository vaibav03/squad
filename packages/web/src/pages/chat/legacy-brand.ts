/**
 * Render-time normalisation for history written before the assistant was renamed to Nook. Stored and raw message
 * text, sender names and backend aliases stay untouched: this only changes what a customer SEES.
 */
const LEGACY_ASSISTANT = /^(cubbie|cubbi|squad)$/i;

/** The persona's visible name: legacy 'Cubbie' (and the short-lived 'Squad') authors show as Nook. */
export function displayAssistantName(name: string, id?: string): string {
  return id === 'cubbie' || LEGACY_ASSISTANT.test(name.trim()) ? 'Nook' : name;
}

const LEGACY_MENTION = /(^|[^\w@])@(cubbie|cubbi|squad)\b/gi;

/** Legacy `@cubbie` / `@cubbi` / `@squad` mentions display as `@nook` (a bare word 'cubbie' or 'squad' is left alone). */
export function displayLegacyMentions(text: string): string {
  return text.replace(LEGACY_MENTION, (_m, pre: string) => `${pre}@nook`);
}

/** Assistant-authored text: also the assistant's own old name ('Hi, I am Cubbie', 'Ask Cubbie') shows as Nook. */
export function displayAssistantText(text: string): string {
  return displayLegacyMentions(text).replace(/\bCubbie\b/g, 'Nook');
}
