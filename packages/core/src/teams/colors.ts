/**
 * Philosopher colours (D47f): the palette that identifies a philosopher
 * everywhere it appears — the Settings card, the chat notices, and the
 * run-start team card.
 *
 * A colour is chosen ONCE, when the philosopher is created, and is written to
 * the yaml (`color: violet`). It is deliberately NOT derived from the council
 * position: removing one philosopher would then re-colour the rest. Two
 * philosophers with the same persona therefore still read apart.
 *
 * The file stores the NAME, not the hex, so the exact pastels can be tuned
 * without invalidating anyone's saved council.
 */
export interface PhilosopherColor {
  id: string;
  hex: string;
}

/** The palette, in assignment order. One colour per council slot (max 5). */
export const PHILOSOPHER_COLORS: PhilosopherColor[] = [
  { id: 'violet', hex: '#b48ad4' },
  { id: 'blue', hex: '#7fa8d9' },
  { id: 'teal', hex: '#5fb3a1' },
  { id: 'amber', hex: '#d9a441' },
  { id: 'rose', hex: '#d98a9e' },
];

/** Colour used when a philosopher has none (hand-edited file, no room left). */
export const NEUTRAL_COLOR: PhilosopherColor = { id: 'neutral', hex: '#8a8a8a' };

export function findColor(id: string | undefined): PhilosopherColor | undefined {
  if (!id) return undefined;
  return PHILOSOPHER_COLORS.find((c) => c.id === id) ??
    (id === NEUTRAL_COLOR.id ? NEUTRAL_COLOR : undefined);
}

/** The hex for a colour id; unknown/empty → the neutral grey. */
export function colorHex(id: string | undefined): string {
  return findColor(id)?.hex ?? NEUTRAL_COLOR.hex;
}

/**
 * The first palette colour no member has taken, so adding a philosopher always
 * yields a distinct colour. Once all five are used the palette wraps.
 */
export function firstUnusedColor(used: Iterable<string | undefined>): string {
  const taken = new Set<string>();
  for (const u of used) {
    if (u) taken.add(u);
  }
  for (const c of PHILOSOPHER_COLORS) {
    if (!taken.has(c.id)) return c.id;
  }
  return PHILOSOPHER_COLORS[taken.size % PHILOSOPHER_COLORS.length]!.id;
}
