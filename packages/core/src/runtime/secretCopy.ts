/**
 * D49bb, D49bc: what Plato SAYS about a protected file.
 *
 * Two decisions live here. D49bb is the masked read — the file arrives with its
 * values replaced. D49bc is the file that CANNOT be masked: opaque content stays
 * a refusal, and text the masker cannot parse gets a card, because the only
 * reason for refusing it is the masker's own limits.
 *
 * The copy lives in core, beside `undoCopy` and `approvalCopy`, for the reason
 * D49ba records: this is the text a model acts on and a user reads, and copy only
 * the shell can reach is copy nothing checks. The rules are D49ba's — short
 * sentences, active voice with the actor named, one idea per sentence, and a
 * control states exactly what it does.
 */

/**
 * The block appended to a masked file's content.
 *
 * It has to teach three things and no more: what happened, that the structure is
 * still trustworthy, and the ONE rule that makes the round trip work — write the
 * placeholder back exactly as written. A model that "helpfully" strips it or
 * invents a value destroys the secret, so that sentence is the load-bearing one.
 */
export function maskedFileNotice(count: number): string {
  const values = count === 1 ? 'value' : 'values';
  return [
    '',
    '[Plato masked this file]',
    `This file is protected. Plato replaced ${count} ${values} with a placeholder before showing it to you.`,
    'The keys, the comments and the line structure are real. The values are not.',
    'To keep a value, write its placeholder back exactly as you see it. Plato then puts the real value back.',
  ].join('\n');
}

/**
 * The refusal for a protected file that cannot be masked.
 *
 * This is the one refusal left in the read path, and it is deliberate: a
 * keystore, a private key or a one-line blob has no values Plato can replace, so
 * showing it would hand over the whole secret. The message says what happened and
 * why, because "protected file" alone is the kind of dead end D49ba exists to
 * remove.
 */
export function unmaskableRefusal(rel: string, names: string): string {
  return (
    `Plato did not show ${rel}. It is on the protected list and Plato cannot mask it, ` +
    `because it holds no "${names}" style lines. Plato shows a protected file only when it can hide the values. ` +
    `To show this file in full, add "${rel}" to the plato.secrets.allow setting.`
  );
}

/**
 * D49bc: the block appended to a file the USER chose to show in full.
 *
 * The last sentence is the load-bearing one, exactly as it is in the masked
 * notice: the model now holds real values, and the one thing Plato cannot undo
 * is a value the model copies somewhere else. Saying it is cheaper than a rule
 * that would refuse the copy.
 */
export function revealedFileNotice(rel: string): string {
  return [
    '',
    '[Plato showed this file in full]',
    `${rel} is protected. Plato cannot replace its values with placeholders, because the file does not hold "KEY=value" lines.`,
    'You chose to show it in full, so the values are real.',
    'Do not write a value from this file into another file.',
  ].join('\n');
}

/**
 * D49bc: the refusal when the user was asked and said no.
 *
 * The user's own answer, not a dead end: saying "Plato cannot mask this file"
 * would read as a defect, and the reason the file is not shown is that the
 * question was put and answered.
 */
export function declinedRevealRefusal(rel: string): string {
  return (
    `Plato did not show ${rel}. It is protected, and Plato cannot replace its values ` +
    `with placeholders. The user chose not to show it in full.`
  );
}

/**
 * D49bc: the card for a protected text file Plato cannot mask.
 *
 * Shaped like `undoCard` and sent over the wire verbatim, so a reloaded card
 * matches the one the user first read. The consequence is on the card in full
 * foreground — *the values go into this conversation and Plato cannot hide them
 * afterwards* — because that is the thing the click costs and finding it out
 * later is what makes a security prompt dishonest. The permanent alternative is
 * named too, so nobody clicks yes for want of a setting they were never told
 * about.
 */
export interface RevealCard {
  title: string;
  /** The situation, one sentence per row. */
  lines: string[];
  /**
   * What the click COSTS, as its own field rather than one more row.
   *
   * The view gives this line the weight the undo card gives what it cannot put
   * back, and a field is what keeps that true: as one row among four, the
   * consequence would silently lose its emphasis the day somebody reorders the
   * copy, and this is the one line on the card the user must not miss.
   */
  cost: string;
  /** The primary button: exactly what the click does. */
  confirm: string;
  cancel: string;
}

export function revealCard(rel: string): RevealCard {
  return {
    title: 'Show this protected file in full?',
    lines: [
      `${rel} is protected.`,
      'Plato hides a value by replacing it with a placeholder, and it cannot do that in this file, because the file does not hold "KEY=value" lines.',
      'The choice lasts until the session ends. To allow this file in every session, add it to the plato.secrets.allow setting.',
    ],
    cost:
      'If you show it, every value in this file goes into this conversation. ' +
      'Plato cannot hide the values afterwards.',
    confirm: 'Show it this session',
    cancel: 'Cancel',
  };
}

/**
 * The refusal for a write that carries a placeholder Plato has no value for.
 *
 * Writing it through would put the literal text `«masked:API_KEY»` into the file
 * — a config that looks right and authenticates nothing, which is worse than a
 * refusal because the damage is silent.
 */
export function unknownPlaceholderRefusal(names: string): string {
  const one = names.split(', ').length === 1;
  return (
    `Plato did not write the file. Its content names ${names}, and Plato has no real ` +
    `${one ? 'value' : 'values'} for ${one ? 'it' : 'them'}. Read the protected file first, then write again.`
  );
}
