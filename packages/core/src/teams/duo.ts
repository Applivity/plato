/**
 * duo.yaml reader + run-resolution (D47): tiny zero-dependency parser for
 * the single-philosopher file, mirroring the academy.yaml parser. Shape:
 *   philosopher:
 *     persona: aristotle      # required; one of the PERSONAS
 *     name: Aristotle         # optional override of the persona name
 *     role: "..."             # optional override of the persona role
 *     model: <conn>:<model>   # optional; empty -> the worker's ref
 *     pause: false
 *     cancel: false
 *     maxInterventions: 5
 * Validation is loud, never silent (D11 root cause); anything fancier is
 * rejected with a clear error rather than guessed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, findPersona } from './personas.js';

export interface DuoPhilosopher {
  /** One of the PERSONAS ids — the philosopher's identity anchor. */
  persona: string;
  /** Display name; empty -> the persona's name. */
  name?: string;
  /** Extra system text; empty -> the persona's role prompt. */
  role?: string;
  /** '<connection>:<model>' ref; empty -> the worker's ref (duo has none). */
  model?: string;
  pause?: boolean;
  cancel?: boolean;
  maxInterventions?: number;
}

export interface DuoConfig {
  philosopher: DuoPhilosopher;
}

export class DuoConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DuoConfigError';
  }
}

const BOOLS = new Set(['true', 'false']);

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parses duo.yaml text. Throws DuoConfigError naming file+line on any issue. */
export function parseDuoConfig(text: string): DuoConfig {
  const lines = text.split('\n');
  const ph: DuoPhilosopher = { persona: '' };
  let inPhilosopher = false;

  const fail = (ln: number, why: string): never => {
    throw new DuoConfigError(`duo.yaml line ${ln + 1}: ${why}`);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (raw.trim().length === 0 || raw.trim().startsWith('#')) {
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    if (indent === 0) {
      if (trimmed === 'philosopher:') {
        inPhilosopher = true;
        continue;
      }
      fail(i, `expected 'philosopher:', got '${trimmed}'`);
    }

    if (!inPhilosopher) {
      fail(i, `expected 'philosopher:', got '${trimmed}'`);
    }

    // Fields under philosopher: (indent >= 2).
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (kv === null) {
      fail(i, `expected 'key: value' under philosopher:, got '${trimmed}'`);
    }
    const key = kv?.[1] ?? '';
    const val = kv?.[2] ?? '';
    switch (key) {
      case 'persona': {
        const id = unquote(val);
        if (!findPersona(id)) {
          fail(
            i,
            `unknown persona '${id}' — use one of ${PERSONAS.map((p) => p.id).join(', ')}`,
          );
        }
        if (ph.persona.length > 0) {
          fail(i, "duplicate key 'persona'");
        }
        ph.persona = id;
        break;
      }
      case 'name':
        ph.name = unquote(val);
        break;
      case 'role':
        ph.role = unquote(val);
        break;
      case 'model':
        ph.model = unquote(val);
        break;
      case 'pause':
      case 'cancel': {
        const v = unquote(val);
        if (!BOOLS.has(v)) {
          fail(i, `${key} must be true or false, got '${v}'`);
        }
        ph[key] = v === 'true';
        break;
      }
      case 'maxInterventions': {
        const n = Number(val);
        if (!Number.isInteger(n) || n < 0) {
          fail(i, `maxInterventions must be a non-negative integer, got '${val}'`);
        }
        ph.maxInterventions = n;
        break;
      }
      default:
        fail(i, `unknown key '${key}' under philosopher:`);
    }
  }

  if (ph.persona.length === 0) {
    throw new DuoConfigError(
      `duo.yaml: philosopher is missing 'persona' — use one of ${PERSONAS.map((p) => p.id).join(', ')}`,
    );
  }
  return { philosopher: ph };
}

/**
 * Reads and parses `<configDir>/duo.yaml`; missing file → null (run-time
 * falls back to the built-in default philosopher).
 */
export function loadDuoConfig(configDir: string): DuoConfig | null {
  let text: string;
  try {
    text = readFileSync(join(configDir, 'duo.yaml'), 'utf8');
  } catch {
    return null; // missing file = the default philosopher, not an error
  }
  return parseDuoConfig(text);
}

/** The no-file run-time default — exactly today's untouched-settings behavior. */
export function defaultDuoPhilosopher(): DuoPhilosopher {
  return { persona: 'aristotle' };
}

/** Resolves a (possibly default) philosopher to the run() observer spec. */
export function duoObserverSpec(
  ph: DuoPhilosopher,
  fallbackModel: string,
): {
  name: string;
  ref: string;
  role: string;
  guidance: boolean;
  pause: boolean;
  cancel: boolean;
  maxInterventions: number;
} {
  const persona = findPersona(ph.persona) ?? PERSONAS[0]!;
  const name = ph.name?.trim();
  const role = ph.role?.trim();
  const model = ph.model?.trim();
  return {
    name: name && name.length > 0 ? name : persona.name,
    ref: model && model.length > 0 ? model : fallbackModel,
    role: role && role.length > 0 ? role : persona.role,
    guidance: true, // D30b: guidance tier always on in duo
    pause: ph.pause ?? false,
    cancel: ph.cancel ?? false,
    maxInterventions: ph.maxInterventions ?? 5,
  };
}
