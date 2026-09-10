/**
 * Canonical yaml writers (D47): the Settings editors write both config files
 * by emitting a model, so a UI save is one atomic file write and re-parses
 * to exactly what the form held. The parsers are strict (unknown keys are
 * rejected), so canonical emission loses nothing in substance — only
 * comments/ordering a human may have added by hand.
 *
 * Emitted scalars are quoted only when a plain one would be misread by a
 * real YAML reader ('<key>: ' inside the value, '#', leading specials,
 * leading/trailing space). Our own parsers split on the key's first ':',
 * so quoted or not they return the value verbatim.
 */
import type { TeamConfig, TeamMember } from './config.js';
import type { DuoConfig } from './duo.js';

/** Double/single-quote a scalar when a plain YAML value would be misread. */
export function yamlScalar(s: string): string {
  if (s.length === 0) {
    return '""';
  }
  const leading = /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s);
  const trailing = /[\s:]$/.test(s);
  const unsafe =
    s.includes('\n') || s.includes(' # ') || s.includes(': ') || s.includes('\t');
  if (!leading && !trailing && !unsafe) {
    return s;
  }
  if (!s.includes('"')) {
    return '"' + s + '"';
  }
  if (!s.includes("'")) {
    return "'" + s + "'";
  }
  // Both quote types present: emit raw — our parsers still read it verbatim.
  return s;
}

/**
 * D47g: collapse a role to ONE line. The Role editor is a textarea, so a stray
 * Enter used to emit `role: "line one` + a raw newline + `line two"` — which
 * YAML cannot represent that way and our own parser then rejected, losing the
 * save. The value is free text, so folding runs of whitespace to single spaces
 * loses no meaning. Applied at the emitter (the guarantee for every caller)
 * and mirrored in the webview (so the box matches what is stored).
 */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function memberLines(m: TeamMember): string[] {
  const lines = [`  - name: ${yamlScalar(m.name)}`, `    model: ${yamlScalar(m.model)}`];
  if (m.role && m.role.trim().length > 0) {
    lines.push(`    role: ${yamlScalar(oneLine(m.role))}`);
  }
  // D47e: every member is a philosopher (Plato is the implicit doer), so the
  // kind line is no longer written; the parser defaults to philosopher.
  if (m.persona && m.persona.trim().length > 0) {
    lines.push(`    persona: ${yamlScalar(m.persona.trim())}`);
  }
  if (m.color && m.color.trim().length > 0) {
    lines.push(`    color: ${yamlScalar(m.color.trim())}`);
  }
  if (m.guidance !== undefined) {
    lines.push(`    guidance: ${m.guidance ? 'true' : 'false'}`);
  }
  if (m.pause !== undefined) {
    lines.push(`    pause: ${m.pause ? 'true' : 'false'}`);
  }
  if (m.cancel !== undefined) {
    lines.push(`    cancel: ${m.cancel ? 'true' : 'false'}`);
  }
  if (m.maxInterventions !== undefined) {
    lines.push(`    maxInterventions: ${m.maxInterventions}`);
  }
  return lines;
}

/** Canonical ACADEMY.yaml body for a TeamConfig. */
export function emitTeamConfig(cfg: TeamConfig): string {
  const out = [
    '# Plato academy (D47). Lives in ~/.plato/ACADEMY.yaml - edit in Settings -> Orchestration -> Academy.',
    '# Plato does the work; the philosophers watch and steer. Philosophers NEVER approve tool calls.',
  ];
  if (cfg.name.trim().length > 0) {
    out.push('academy:', `  name: ${yamlScalar(cfg.name.trim())}`);
  } else {
    out.push('academy:');
  }
  out.push('', 'members:');
  cfg.members.forEach((m, i) => {
    if (i > 0) {
      out.push('');
    }
    out.push(...memberLines(m));
  });
  out.push('');
  return out.join('\n');
}

/** Canonical DUO.yaml body for a DuoConfig. */
export function emitDuoConfig(cfg: DuoConfig): string {
  const ph = cfg.philosopher;
  const out = [
    '# Plato duo philosopher (D47). Lives in ~/.plato/DUO.yaml - edit in Settings -> Orchestration -> Duo.',
    '# The philosopher watches the run and steers it. Philosophers NEVER approve tool calls.',
    'philosopher:',
    `  persona: ${yamlScalar(ph.persona)}`,
  ];
  if (ph.name && ph.name.trim().length > 0) {
    out.push(`  name: ${yamlScalar(ph.name.trim())}`);
  }
  if (ph.role && ph.role.trim().length > 0) {
    out.push(`  role: ${yamlScalar(oneLine(ph.role))}`);
  }
  if (ph.model && ph.model.trim().length > 0) {
    out.push(`  model: ${yamlScalar(ph.model.trim())}`);
  }
  if (ph.color && ph.color.trim().length > 0) {
    out.push(`  color: ${yamlScalar(ph.color.trim())}`);
  }
  out.push(
    `  pause: ${ph.pause ?? false ? 'true' : 'false'}`,
    `  cancel: ${ph.cancel ?? false ? 'true' : 'false'}`,
    `  maxInterventions: ${ph.maxInterventions ?? 5}`,
  );
  out.push('');
  return out.join('\n');
}
