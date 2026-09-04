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

function memberLines(m: TeamMember): string[] {
  const lines = [`  - name: ${yamlScalar(m.name)}`, `    model: ${yamlScalar(m.model)}`];
  if (m.role && m.role.trim().length > 0) {
    lines.push(`    role: ${yamlScalar(m.role)}`);
  }
  lines.push(`    kind: ${m.kind}`);
  if (m.kind === 'philosopher') {
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
  }
  return lines;
}

/** Canonical academy.yaml body for a TeamConfig. */
export function emitTeamConfig(cfg: TeamConfig): string {
  const out = [
    '# Plato academy (D47). Lives in ~/.plato/academy.yaml - edit in Settings -> Orchestration -> Academy.',
    '# The worker does the work; philosophers watch and steer. Philosophers NEVER approve tool calls.',
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

/** Canonical duo.yaml body for a DuoConfig. */
export function emitDuoConfig(cfg: DuoConfig): string {
  const ph = cfg.philosopher;
  const out = [
    '# Plato duo philosopher (D47). Lives in ~/.plato/duo.yaml - edit in Settings -> Orchestration -> Duo.',
    '# The philosopher watches the run and steers it. Philosophers NEVER approve tool calls.',
    'philosopher:',
    `  persona: ${yamlScalar(ph.persona)}`,
  ];
  if (ph.name && ph.name.trim().length > 0) {
    out.push(`  name: ${yamlScalar(ph.name.trim())}`);
  }
  if (ph.role && ph.role.trim().length > 0) {
    out.push(`  role: ${yamlScalar(ph.role.trim())}`);
  }
  if (ph.model && ph.model.trim().length > 0) {
    out.push(`  model: ${yamlScalar(ph.model.trim())}`);
  }
  out.push(
    `  pause: ${ph.pause ?? false ? 'true' : 'false'}`,
    `  cancel: ${ph.cancel ?? false ? 'true' : 'false'}`,
    `  maxInterventions: ${ph.maxInterventions ?? 5}`,
  );
  out.push('');
  return out.join('\n');
}
