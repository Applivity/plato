/**
 * ACADEMY.yaml reader (D31/D32): tiny zero-dependency parser for the subset
 * we document —
 *   academy:
 *     name: hcad-audit
 *   members:
 *     - name: plato
 *       model: anthropic:claude-sonnet-4-5
 *       role: You fix bugs.
 *       kind: worker
 *     - name: aristotle
 *       kind: philosopher
 *       model: litellm:openrouter-nvidia/nemotron-3-ultra-550b-a55b:free
 *       guidance: true
 *       maxInterventions: 3
 * Anything fancier is rejected with a clear error rather than guessed.
 * Validation is loud, never silent (D11 root cause).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TeamMember {
  name: string;
  /** '<connection>:<model>' ref, required. */
  model: string;
  /** Extra system text for this member. */
  role?: string;
  kind: 'worker' | 'philosopher';
  /** Philosopher tiers (D30); ignored for workers. */
  guidance?: boolean;
  pause?: boolean;
  cancel?: boolean;
  maxInterventions?: number;
}

export interface TeamConfig {
  name: string;
  members: TeamMember[];
}

export class TeamConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TeamConfigError';
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

/** Parses ACADEMY.yaml text. Throws TeamConfigError naming file+line on any issue. */
export function parseTeamConfig(text: string): TeamConfig {
  const lines = text.split('\n');
  let teamName = '';
  const members: TeamMember[] = [];
  /** Current member being filled, or null before the first one. */
  let cur: TeamMember | null = null;
  /** True between 'academy:' and 'members:'. */
  let inTeamBlock = false;

  const fail = (ln: number, why: string): never => {
    throw new TeamConfigError(`ACADEMY.yaml line ${ln + 1}: ${why}`);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (raw.trim().length === 0 || raw.trim().startsWith('#')) {
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    if (indent === 0) {
      if (trimmed === 'academy:' || trimmed === 'team:') {
        cur = null;
        inTeamBlock = true;
        continue;
      }
      if (trimmed === 'members:') {
        cur = null;
        inTeamBlock = false;
        continue;
      }
      fail(i, `expected 'academy:' or 'members:', got '${trimmed}'`);
    }

    // Under team: — only name: value
    if (inTeamBlock) {
      const m = /^name:\s*(.+)$/.exec(trimmed);
      if (m === null) {
        fail(i, `expected 'name: <team name>' under team:, got '${trimmed}'`);
      }
      teamName = unquote(m?.[1] ?? '');
      continue;
    }

    // A member entry: "- name: coder" (name must be first).
    if (indent === 2 && trimmed.startsWith('- ')) {
      const body = trimmed.slice(2);
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(body);
      if (kv === null) {
        fail(i, `expected '- key: value' for a member, got '${trimmed}'`);
      }
      const key = kv?.[1] ?? '';
      const val = kv?.[2] ?? '';
      if (key !== 'name') {
        fail(i, `'name' must be the first key of a member, got '${key}'`);
      }
      const n = unquote(val);
      if (n.length === 0) {
        fail(i, "member 'name' must not be empty");
      }
      if (members.some((m) => m.name === n)) {
        fail(i, `duplicate member name '${n}'`);
      }
      cur = { name: n, model: '', kind: 'worker' };
      members.push(cur);
      continue;
    }

    // Member fields (indented under the dash).
    if (cur !== null && indent >= 4) {
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
      if (kv === null) {
        fail(i, `expected 'key: value' in member '${cur.name}', got '${trimmed}'`);
      }
      const key = kv?.[1] ?? '';
      const val = kv?.[2] ?? '';
      switch (key) {
        case 'name':
          fail(i, `'name' must be the first key of a member`);
        case 'model':
          cur.model = unquote(val);
          break;
        case 'role':
          cur.role = unquote(val);
          break;
        case 'kind': {
          const k = unquote(val);
          if (k === 'coder' || k === 'observer') {
            fail(
              i,
              `kind '${k}' was renamed — use 'worker' or 'philosopher' (D32)`,
            );
          }
          if (k !== 'worker' && k !== 'philosopher') {
            fail(i, `kind must be 'worker' or 'philosopher', got '${k}'`);
          }
          cur.kind = k as 'worker' | 'philosopher';
          break;
        }
        case 'guidance':
        case 'pause':
        case 'cancel': {
          const v = unquote(val);
          if (!BOOLS.has(v)) {
            fail(i, `${key} must be true or false, got '${v}'`);
          }
          cur[key] = v === 'true';
          break;
        }
        case 'maxInterventions': {
          const n = Number(val);
          if (!Number.isInteger(n) || n < 0) {
            fail(i, `maxInterventions must be a non-negative integer, got '${val}'`);
          }
          cur.maxInterventions = n;
          break;
        }
        default:
          fail(i, `unknown key '${key}' in member '${cur.name}'`);
      }
      continue;
    }

    fail(i, `unexpected indentation or content: '${trimmed}'`);
  }
  return finishTeam(members, teamName);
}

/** Cross-member validation (D31c/D32f). */
function finishTeam(members: TeamMember[], teamName: string): TeamConfig {
  if (members.length === 0) {
    throw new TeamConfigError('ACADEMY.yaml: no members found under members:');
  }
  const workers = members.filter((m) => m.kind === 'worker');
  if (workers.length === 0) {
    throw new TeamConfigError(
      'ACADEMY.yaml: no worker member — add kind: worker',
    );
  }
  if (workers.length > 1) {
    throw new TeamConfigError(
      `ACADEMY.yaml: ${workers.length} worker members — exactly one worker is allowed (D31c)`,
    );
  }
  const philosophers = members.filter((m) => m.kind === 'philosopher');
  if (philosophers.length > 5) {
    throw new TeamConfigError(
      `ACADEMY.yaml: ${philosophers.length} philosopher members — at most 5 (D46)`,
    );
  }
  for (const m of members) {
    if (m.model.length === 0) {
      throw new TeamConfigError(
        `ACADEMY.yaml: member '${m.name}' is missing 'model'`,
      );
    }
    // Same semantics as splitModelRef: first ':' separates connection from
    // model; the model part may itself contain ':' (e.g. ':free' routes).
    const c = m.model.indexOf(':');
    if (c <= 0 || c >= m.model.length - 1) {
      throw new TeamConfigError(
        `ACADEMY.yaml: member '${m.name}' model must be a '<connection>:<model>' ref, got '${m.model}'`,
      );
    }
  }
  return { name: teamName, members };
}

/**
 * Reads and parses `<configDir>/ACADEMY.yaml`; missing file → null (solo).
 * D46: the config dir is Plato's home folder (`~/.plato`), NOT the project —
 * a stray/broken ACADEMY.yaml in the project is never read.
 */
export function loadTeamConfig(configDir: string): TeamConfig | null {
  let text: string;
  try {
    text = readFileSync(join(configDir, 'ACADEMY.yaml'), 'utf8');
  } catch {
    return null; // missing file = solo mode, not an error
  }
  return parseTeamConfig(text);
}

