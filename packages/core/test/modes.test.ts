import { describe, expect, it } from 'vitest';
import { decide, isWriteTool, secretRefusal, writePathsOf } from '../src/runtime/modes.js';
import { toolDeclarations } from '../src/tools/schemas.js';
import type { Mode } from '../src/runtime/modes.js';
import type { ToolName } from '../src/runtime/modes.js';

describe('decide', () => {
  const read: ToolName[] = ['read_file', 'list_dir', 'grep', 'glob', 'git'];
  const write: ToolName[] = ['write_file', 'apply_diff', 'apply_patch'];

  it('plan: reads only, and the shell is denied with the writes', () => {
    for (const t of read) expect(decide(t, 'plan')).toBe('allow');
    for (const t of write) expect(decide(t, 'plan')).toBe('deny');
    expect(decide('shell', 'plan')).toBe('deny');
  });

  /**
   * D49ak. The merged mode. **The `shell` line is the whole merge, stated as a
   * test:** it was `deny` before, and the mode that cannot run a command cannot
   * verify its own work — which the worker prompt requires. Writes still ask,
   * and the per-file memory that makes `edit` quieter than the old `act` lives in
   * the shell's `approve`, not here.
   */
  it('edit: reads free, writes AND the shell ask (D49ak)', () => {
    for (const t of read) expect(decide(t, 'edit')).toBe('allow');
    for (const t of write) expect(decide(t, 'edit')).toBe('ask');
    expect(decide('shell', 'edit')).toBe('ask');
  });

  it('auto: everything allowed', () => {
    for (const t of [...read, ...write]) expect(decide(t, 'auto')).toBe('allow');
    expect(decide('shell', 'auto')).toBe('allow');
  });

  /**
   * D49l. `decide` returns 'deny' for a tool it has no kind for, so a tool
   * declared to the model but missing from the kind table is silently unusable
   * in EVERY mode — the model would call it and always be refused.
   *
   * Two nets cover this, and they catch different mistakes. `tsc` requires
   * TOOL_KIND to be exhaustive over the `ToolName` union, so it catches a name
   * added to the union without a kind. This test catches the other direction:
   * a tool added to `toolDeclarations()` — whose name is only a `string` — and
   * never added to `ToolName` at all.
   */
  it('classifies every tool the model is told about', () => {
    for (const t of toolDeclarations()) {
      // `deny` in auto means no kind was declared for it, so it would be
      // unusable in EVERY mode. That is the failure this guards. (Under D49p
      // this comment had to say "not every tool is allowed in auto, `net` asks
      // even there"; D49ak made `net` allowed in auto, so the weaker claim is
      // true again — but the assertion is unchanged either way, because it was
      // always about a missing KIND and never about the verdict.)
      expect(
        decide(t.name, 'auto'),
        `${t.name} is denied in auto — it has no kind, so it would be denied in every mode`,
      ).not.toBe('deny');
    }
  });

  /**
   * D49ak, which AMENDS D49p. D49p made egress ask in every mode including
   * `auto`, because a request cannot be un-sent. **The founder overrode that on
   * 2026-09-24: `auto` fetches without asking.** The assertions are written as
   * the pair, so the change cannot be read as the old rule surviving by accident:
   * `auto` allows, and the two gated modes still ask.
   *
   * **What `auto` gives up is recorded in the decision, not softened here:** no
   * card stands between a fetched page and the model. The executor's own rules —
   * no redirect onto a loopback or private address, no non-text response, content
   * labelled untrusted — do NOT move, because they are not permissions.
   */
  it('auto fetches without asking; plan and edit still ask (D49ak)', () => {
    expect(decide('web_fetch', 'auto')).toBe('allow');
    expect(decide('web_fetch', 'plan')).toBe('ask');
    expect(decide('web_fetch', 'edit')).toBe('ask');
  });
});

describe('secretRefusal', () => {
  it('refuses path args naming deny-listed files', () => {
    expect(secretRefusal('read_file', { path: 'keystore.properties' })).not.toBeNull();
    expect(secretRefusal('read_file', { path: 'app/local.properties' })).not.toBeNull();
    expect(secretRefusal('apply_diff', { path: '.env' })).not.toBeNull();
  });

  it('scans nested arrays too', () => {
    const cmd = { command: 'cat app/keystore.properties' };
    expect(secretRefusal('shell', cmd)).not.toBeNull();
  });

  /**
   * D49ai. The regression this closes, as the two commands that differ only by a
   * directory prefix. **Verified by running the first one before the fix:**
   * `executeTool` returned `ok: true` WITH the file's contents, and `shell` is
   * `allow` in `auto`, so nothing asked. The proving-ground repo keeps the file
   * at its root, so the spelling that read it was the natural one.
   */
  it('refuses a protected file named inside a command, not just as a whole path (D49ai)', () => {
    expect(secretRefusal('shell', { command: 'cat keystore.properties' })).not.toBeNull();
    expect(secretRefusal('shell', { command: 'cat ./keystore.properties' })).not.toBeNull();
    expect(secretRefusal('shell', { command: 'cp keystore.properties /tmp/x' })).not.toBeNull();
    expect(secretRefusal('shell', { command: 'grep -R secret keystore.properties' })).not.toBeNull();
    expect(secretRefusal('shell', { command: 'openssl pkcs12 -in release.jks' })).not.toBeNull();
    expect(secretRefusal('shell', { command: 'cat .env' })).not.toBeNull();
  });

  it('does not refuse a command that merely mentions the letters (D49ai)', () => {
    // The check is a token scan, not a substring one, or the guard would fight
    // the model over words instead of files.
    for (const command of [
      'cat app/src/main/MainActivity.java',
      'grep -rn "secretsmanager" app/src',
      './gradlew assembleRelease',
      'git status',
      'echo hello > notes.txt',
    ]) {
      expect(secretRefusal('shell', { command }), command).toBeNull();
    }
  });

  it('allows clean paths', () => {
    expect(
      secretRefusal('read_file', { path: 'app/src/main/MainActivity.java' }),
    ).toBeNull();
    expect(secretRefusal('grep', { pattern: 'gradle' })).toBeNull();
  });

  /**
   * D49ah. The scan is for arguments that could cause a secret to be READ — a
   * path, a shell command. A plan item is the model's own sentence about work it
   * intends, and it must be able to name a protected file without the call being
   * refused: "rotate the keystore" is a legitimate step, and the file is never
   * opened. Nothing is weakened — the read tools still refuse it.
   */
  it('does not scan a plan item, which names rather than opens (D49ah)', () => {
    expect(
      secretRefusal('todo_write', {
        todos: [{ content: 'rotate keystore.properties', status: 'pending' }],
      }),
    ).toBeNull();
    // The control: the same words in a tool that CAN read still refuse.
    expect(secretRefusal('read_file', { path: 'keystore.properties' })).not.toBeNull();
    expect(secretRefusal('shell', { command: 'cat keystore.properties' })).not.toBeNull();
  });

  it('ask_user is allow in every mode (meta tool, D34)', () => {
    for (const mode of ['plan', 'edit', 'auto'] as Mode[]) {
      expect(decide('ask_user', mode)).toBe('allow');
    }
  });

  /**
   * D49ah. `todo_write` is the agent's own plan — no workspace, no network — so
   * it is meta for the same reason `ask_user` is, and the mode it most needs to
   * work in is `plan`, where writing the plan down is the whole job. Gating it
   * would have made an approval card out of "write down what you intend".
   */
  it('todo_write is allow in every mode, plan included (meta tool, D49ah)', () => {
    for (const mode of ['plan', 'edit', 'auto'] as Mode[]) {
      expect(decide('todo_write', mode)).toBe('allow');
    }
  });

  it('MCP tools are shell-class: denied in plan, asked in edit, allowed in auto (D06)', () => {
    expect(decide('mcp__fake__echo', 'plan')).toBe('deny');
    expect(decide('mcp__fake__echo', 'edit')).toBe('ask');
    expect(decide('mcp__fake__echo', 'auto')).toBe('allow');
  });

  it('unknown non-mcp tools are denied outright', () => {
    expect(decide('totally_unknown', 'auto')).toBe('deny');
  });
});

/**
 * D49ak. `isWriteTool` used to be a second, hardcoded list in the shell —
 * `write_file || apply_diff` — and `apply_patch` landed later without being added
 * to it, so a multi-file patch was the one write tool with NO session memory:
 * every call raised a card even for files the user had already approved. That is
 * the nagging the per-file memory exists to stop.
 *
 * The names are listed here rather than derived from TOOL_KIND, because deriving
 * them would make the test tautological. These three are the tools that change
 * files, and that is the fact the bug was about.
 */
describe('isWriteTool covers every file-changing tool (D49ak)', () => {
  it('says yes to all three write tools, apply_patch included', () => {
    for (const t of ['write_file', 'apply_diff', 'apply_patch']) {
      expect(isWriteTool(t), t).toBe(true);
    }
  });

  it('says no to everything that does not change a file', () => {
    for (const t of [
      'read_file', 'list_dir', 'grep', 'glob', 'git',
      'shell', 'bash_output', 'kill_shell', 'web_fetch',
    ]) {
      expect(isWriteTool(t), t).toBe(false);
    }
  });
});

/**
 * D49ak. `writePathsOf` is what the session memory is keyed on, so it decides
 * both halves of the bargain: which files a "yes" covers, and whether a later
 * call is answered without asking. A path it drops is a file the user is asked
 * about forever; a path it invents is a file approved without being shown.
 */
describe('writePathsOf returns exactly the files a write would change (D49ak)', () => {
  it('returns the single path of a one-file write', () => {
    expect(writePathsOf('write_file', { path: 'a.ts' })).toEqual(['a.ts']);
    expect(writePathsOf('apply_diff', { path: 'src/b.ts' })).toEqual(['src/b.ts']);
  });

  it('returns EVERY path of a multi-file patch', () => {
    expect(
      writePathsOf('apply_patch', {
        patches: [{ path: 'a.ts' }, { path: 'src/b.ts' }, { path: 'c.ts' }],
      }),
    ).toEqual(['a.ts', 'src/b.ts', 'c.ts']);
  });

  it('drops entries with no usable path instead of inventing an empty one', () => {
    // An empty string in the approved set would approve a nameless write.
    expect(
      writePathsOf('apply_patch', { patches: [{ path: 'a.ts' }, {}, { path: '' }, null] }),
    ).toEqual(['a.ts']);
  });

  it('returns nothing when there is nothing to return', () => {
    expect(writePathsOf('apply_patch', {})).toEqual([]);
    expect(writePathsOf('apply_patch', { patches: [] })).toEqual([]);
    expect(writePathsOf('write_file', {})).toEqual([]);
    expect(writePathsOf('write_file', { path: '' })).toEqual([]);
  });
});

/**
 * D49ak, the founder's call: *"cap it to 3 choices and one free text box... and
 * maybe may ask up to 4 questions at a time. We don't want to overwhelm the
 * users."*
 *
 * These are product limits rather than technical ones, so they are pinned here —
 * a later session raising them should have to delete an assertion that says why.
 * The card adds its own free-text row on top of the declared options, so 3
 * declared labels are 4 rows on screen.
 */
describe('the ask_user declaration keeps the question card small (D49ak)', () => {
  const ask = () => {
    const t = toolDeclarations().find((x) => x.name === 'ask_user');
    if (!t) throw new Error('ask_user is not declared');
    return t;
  };
  const param = (path: string[]): Record<string, unknown> => {
    let cur = ask().parameters;
    for (const key of path) {
      cur = (cur[key] ?? {}) as Record<string, unknown>;
    }
    return cur;
  };

  it('caps a question at 3 options', () => {
    expect(param(['properties', 'questions', 'items', 'properties', 'options']).maxItems).toBe(3);
    expect(param(['properties', 'questions', 'items', 'properties', 'options']).minItems).toBe(2);
  });

  it('caps one call at 4 questions', () => {
    expect(param(['properties', 'questions']).maxItems).toBe(4);
  });

  it('tells the model the limits, not only the JSON schema', () => {
    // A schema constraint the prompt never mentions is one the model will cross.
    expect(ask().description).toContain('at most 4 questions');
    expect(ask().description).toContain('2-3 options');
  });

  /**
   * D49bd: the short label each question's TAB is named with. It is bounded and
   * asked for in the prompt, but deliberately NOT required — a question without
   * one renders with its number instead, so the field can only improve a card.
   */
  it('asks for a bounded tab label, and does not require it (D49bd)', () => {
    const h = param(['properties', 'questions', 'items', 'properties', 'header']);
    expect(h.type).toBe('string');
    expect(h.maxLength).toBe(12);
    expect(ask().description).toContain('header');
    const required = param(['properties', 'questions', 'items']).required as string[];
    expect(required).not.toContain('header');
    expect(required).toContain('question');
  });

  /**
   * The founder's point, in his words: *"a model should really work hard to give
   * us plausible options within limits."* A tighter ceiling only helps if the
   * model spends the smaller space better, so the description says what a good
   * option IS and gives the model a way out of asking badly — the free-text row
   * already covers what it cannot anticipate, and a question with one real answer
   * should not be asked at all.
   */
  it('asks for options the model would act on, not padding (D49am)', () => {
    expect(ask().description).toContain('one you would genuinely act on');
    expect(ask().description).toContain('not three variations of one');
  });

  it('tells the model not to ask when only one answer is plausible (D49am)', () => {
    expect(ask().description).toContain('If only one answer is plausible, do not ask');
  });

  it('points at the free-text row instead of weak options (D49am)', () => {
    expect(ask().description).toContain('free-text row');
    expect(ask().description).toContain('instead of padding the options');
  });
});
