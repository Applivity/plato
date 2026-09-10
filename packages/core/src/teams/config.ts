/**
 * ACADEMY.yaml reader (D31/D32/D47e): tiny zero-dependency parser for the
 * subset we document —
 *   academy:
 *     name: lyceum
 *   members:
 *     - name: aristotle
 *       kind: philosopher
 *       model: anthropic:claude-sonnet-4-5
 *       persona: aristotle
 *       guidance: true
 *       maxInterventions: 3
 * D47e: there is no worker member. Plato (the doer) is implicit in every
 * mode and its model is the chat composer's; Solo/Duo/Academy are the same
 * one worker with 0 / 1 / N philosophers (D45a-3). Anything fancier is
 * rejected with a clear error rather than guessed. Validation is loud,
 * never silent (D11 root cause).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHILOSOPHER_COLORS, findColor } from './colors.js';

/**
 * D47g: the role prompt is injected into the observer's system prompt on EVERY
 * turn (observer.ts: `SYSTEM + '\n' + role`), so an unbounded role is a
 * per-call token cost, not just a layout problem. 1000 chars is ~4x the
 * longest shipped persona role (Aristotle, 249) — generous for a custom role,
 * while still forcing a philosopher to be brief. Enforced here so a
 * hand-pasted 2000-char line in the yaml is rejected, not silently accepted.
 * The webview carries the same number (it cannot import core) and mirrors it
 * with `maxlength`, so the UI cannot produce a file this parser refuses.
 */
export const ROLE_MAX_CHARS = 1000;

export interface TeamMember {
  name: string;
  /** '<connection>:<model>' ref, required. */
  model: string;
  /** Extra system text for this member. */
  role?: string;
  /** D47e: Academy members are philosophers only; Plato is the implicit doer. */
  kind: 'philosopher';
  /**
   * D47d: philosopher identity anchor — one of the PERSONAS ids. Optional;
   * an empty/absent value means a custom philosopher with no preset.
   */
  persona?: string;
  /**
   * D47f: identity colour — one of PHILOSOPHER_COLORS ids. Assigned once at
   * creation and stored, so it never shifts when another member is removed
   * (unlike an index into the council). Absent = neutral grey.
   */
  color?: string;
  /** Philosopher tiers (D30). */
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
      cur = { name: n, model: '', kind: 'philosopher' };
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
        case 'role': {
          // D47g: a role is injected into every observer call, so it is capped.
          const r = unquote(val);
          if (r.length > ROLE_MAX_CHARS) {
            fail(
              i,
              `role is ${r.length} characters — the maximum is ${ROLE_MAX_CHARS}`,
            );
          }
          cur.role = r;
          break;
        }
        case 'persona':
          cur.persona = unquote(val);
          break;
        case 'color': {
          const c = unquote(val);
          if (!findColor(c)) {
            fail(
              i,
              `unknown color '${c}' — use one of ${PHILOSOPHER_COLORS.map((x) => x.id).join(', ')}`,
            );
          }
          cur.color = c;
          break;
        }
        case 'kind': {
          const k = unquote(val);
          if (k === 'coder' || k === 'observer') {
            fail(
              i,
              `kind '${k}' was renamed — use 'philosopher' (D32)`,
            );
          }
          if (k === 'worker') {
            fail(
              i,
              "'kind: worker' is no longer a member — Plato is always the doer (D47e). Remove this entry.",
            );
          }
          if (k !== 'philosopher') {
            fail(i, `kind must be 'philosopher', got '${k}'`);
          }
          cur.kind = 'philosopher';
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

/** Cross-member validation (D31c/D32f/D47e). */
function finishTeam(members: TeamMember[], teamName: string): TeamConfig {
  if (members.length === 0) {
    throw new TeamConfigError('ACADEMY.yaml: no members found under members:');
  }
  // D47e: every member is a philosopher; Plato is the implicit doer.
  if (members.length < 2) {
    throw new TeamConfigError(
      `ACADEMY.yaml: ${members.length} philosopher — a council needs at least 2 (D47e)`,
    );
  }
  if (members.length > 5) {
    throw new TeamConfigError(
      `ACADEMY.yaml: ${members.length} philosophers — at most 5 (D46)`,
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

