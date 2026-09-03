/**
 * D44a slash commands: the canonical command table. Commands are textual
 * shortcuts, NOT a plugin system — each expands into prompt text the model
 * sees, plus mode/payload side-effects the host applies for the run.
 * D44a's /system-prompt is deliberately absent: it lands with D45a-2.
 */
import type { Mode } from './modes.js';

export type SlashCommandId = 'plan' | 'fix' | 'review' | 'commit' | 'test';

export type SlashSideEffect =
  | { kind: 'mode'; mode: Mode } // force this mode for the whole run
  | { kind: 'mode-if-auto'; mode: Mode } // /test: only when the mode is 'auto'
  | { kind: 'git-context' }; // /commit: host injects git status + diff at run start

export interface SlashCommand {
  id: SlashCommandId;
  label: string;
  usage: string;
  blurb: string;
  /** Pure function of the trimmed args; the prompt text the model sees. */
  expand(args: string): string;
  sideEffects: SlashSideEffect[];
}

const REVIEW_LENS =
  'Review for correctness, edge cases, maintainability, and security. ' +
  'Rank findings by impact and end with an ordered list of concrete changes.';

const COMMANDS: readonly SlashCommand[] = [
  {
    id: 'plan',
    label: 'Plan',
    usage: '/plan [task]',
    blurb: 'Read-only planning brief',
    expand(args) {
      const tail =
        args.length > 0
          ? `\n\nTask to plan: ${args}`
          : '\n\nIf no task is given, inspect the repo and decide the highest-value change to plan.';
      return (
        'You are planning. Produce an ordered implementation plan and stop — do not start editing. ' +
        'Read the relevant code first so the plan is grounded in the real structure. ' +
        'Planning is read-only: do not modify files and run no command that changes the repo.' +
        tail
      );
    },
    sideEffects: [{ kind: 'mode', mode: 'plan' }],
  },
  {
    id: 'fix',
    label: 'Fix',
    usage: '/fix [issue]',
    blurb: 'Diagnose, propose a diff, apply after approval',
    expand(args) {
      const tail =
        args.length > 0 ? `\n\nIssue to fix: ${args}` : '';
      return (
        'You are fixing a bug. Diagnose the issue, present the exact diff, then apply the change ' +
        'once the proposal is approved and the mode permits writes. Re-read and confirm each file ' +
        'after editing.' +
        tail
      );
    },
    sideEffects: [],
  },
  {
    id: 'review',
    label: 'Review',
    usage: '/review [paths…]',
    blurb: 'Opinionated code critique (read-only)',
    expand(args) {
      const head =
        args.length > 0
          ? 'Read the attached file(s) and critique them.'
          : 'Survey the current working tree and pick the most review-worthy surface to critique.';
      return (
        'You are reviewing code. ' +
        head +
        ' Be opinionated and specific — point to exact lines and propose exact fixes. ' +
        REVIEW_LENS +
        ' This review is read-only: do not modify files.'
      );
    },
    sideEffects: [{ kind: 'mode', mode: 'plan' }],
  },
  {
    id: 'commit',
    label: 'Commit',
    usage: '/commit',
    blurb: 'Propose a conventional-commit message',
    expand() {
      return (
        'Produce a conventional-commit message for the current changes and STOP. Do not modify, ' +
        'stage, or commit anything, and do not run git — the host attached the repo status and ' +
        'diff. Return: a type + subject line, a short bullet body, and the exact git command to run.'
      );
    },
    sideEffects: [
      { kind: 'mode', mode: 'plan' },
      { kind: 'git-context' },
    ],
  },
  {
    id: 'test',
    label: 'Test',
    usage: '/test [target]',
    blurb: 'Find and run the test command',
    expand(args) {
      const tail =
        args.length > 0 ? `\n\nTest target: ${args}` : '';
      return (
        'You are testing the project. Find the test command (package.json scripts or README), ' +
        'run the smallest targeted scope first, then report failures and likely causes with ' +
        'evidence from the output.' +
        tail
      );
    },
    sideEffects: [{ kind: 'mode-if-auto', mode: 'act' }],
  },
];

export const SLASH_COMMANDS: readonly SlashCommand[] = COMMANDS;

export function slashCommand(id: string | undefined): SlashCommand | undefined {
  if (id === undefined) return undefined;
  return COMMANDS.find((c) => c.id === id);
}

/** Webview-safe display rows: never carries prompt text. */
export function slashMenu(): {
  id: SlashCommandId;
  label: string;
  usage: string;
  blurb: string;
}[] {
  return COMMANDS.map((c) => ({
    id: c.id,
    label: c.label,
    usage: c.usage,
    blurb: c.blurb,
  }));
}

/**
 * D44a "for the run": the mode a run should execute under for a command,
 * or `current` when the command leaves the mode alone. /plan, /review and
 * /commit always force `plan` (regardless of `current`); /test forces `act`
 * only when `current` is `auto` (never auto); everything else is unchanged.
 */
export function modeForRun(id: string | undefined, current: Mode): Mode {
  const cmd = slashCommand(id);
  if (cmd === undefined) return current;
  const force = cmd.sideEffects.find(
    (s): s is { kind: 'mode'; mode: Mode } => s.kind === 'mode',
  );
  if (force !== undefined) return force.mode;
  const ifAuto = cmd.sideEffects.find(
    (s): s is { kind: 'mode-if-auto'; mode: Mode } => s.kind === 'mode-if-auto',
  );
  if (ifAuto !== undefined && current === 'auto') return ifAuto.mode;
  return current;
}

export function needsGitContext(id: string | undefined): boolean {
  const cmd = slashCommand(id);
  return cmd !== undefined && cmd.sideEffects.some((s) => s.kind === 'git-context');
}
