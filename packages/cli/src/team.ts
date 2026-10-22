import {
  DuoConfigError,
  ObserverAgent,
  TeamConfigError,
  colorHex,
  createProvider,
  defaultAcademyMembers,
  defaultDuoPhilosopher,
  duoObserverSpec,
  loadDuoConfig,
  loadTeamConfig,
  splitModelRef,
  type AgentBus,
  type ChatProvider,
  type DigestEntry,
  type RunController,
} from '@applivity/plato-core';
import type { PlatoConfig, Team } from './config.js';
import { HostError } from './errors.js';
import { connectionNeedsKey, resolveKey } from './keys.js';
import type { Env } from './paths.js';

/**
 * Solo, Duo, and Academy (D49bw). The team files are the extension's own —
 * `~/.plato/DUO.yaml` and `~/.plato/ACADEMY.yaml` — so a team configured in
 * either host runs in both. The parsers, the observer agent, the personas, and
 * the colours all come from core; this module only resolves keys and wiring.
 */
export const MAX_INTERVENTIONS = 5;

export interface ObserverSpec {
  name: string;
  ref: string;
  role: string;
  guidance: boolean;
  pause: boolean;
  cancel: boolean;
  maxInterventions: number;
  /** Identity colour, as the hex the terminal can paint. */
  hex: string;
}

export function observerSpecs(team: Team, workerRef: string, home: string): ObserverSpec[] {
  if (team === 'solo') {
    return [];
  }

  if (team === 'duo') {
    let config = null;
    try {
      config = loadDuoConfig(home);
    } catch (error) {
      const message = error instanceof DuoConfigError ? error.message : String(error);
      throw new HostError(`DUO.yaml could not be read: ${message}`);
    }
    const spec = duoObserverSpec(
      config !== null ? config.philosopher : defaultDuoPhilosopher(),
      workerRef,
    );
    return [
      {
        name: spec.name,
        ref: spec.ref,
        role: spec.role,
        guidance: spec.guidance,
        pause: spec.pause,
        cancel: spec.cancel,
        maxInterventions: spec.maxInterventions,
        hex: colorHex(spec.color),
      },
    ];
  }

  let teamConfig = null;
  try {
    teamConfig = loadTeamConfig(home);
  } catch (error) {
    const message = error instanceof TeamConfigError ? error.message : String(error);
    throw new HostError(`ACADEMY.yaml could not be read: ${message}`);
  }
  const members = teamConfig !== null ? teamConfig.members : defaultAcademyMembers(workerRef);
  return members
    .filter((member) => member.kind === 'philosopher')
    .map((member) => ({
      name: member.name,
      ref: member.model,
      role: member.role ?? '',
      guidance: member.guidance ?? true,
      pause: member.pause ?? false,
      cancel: member.cancel ?? false,
      maxInterventions: member.maxInterventions ?? MAX_INTERVENTIONS,
      hex: colorHex(member.color),
    }));
}

export interface ObserverHandle {
  name: string;
  ref: string;
  hex: string;
  agent: ObserverAgent;
}

export interface ObserverSkip {
  name: string;
  ref: string;
  reason: string;
}

export interface ObserverBuildOptions {
  config: PlatoConfig;
  env: Env;
  fetchImpl?: typeof fetch;
  /** Injected by the scripted runs. Returning null builds the real provider. */
  provider?: (spec: ObserverSpec) => ChatProvider | null;
}

export async function createObservers(
  specs: readonly ObserverSpec[],
  options: ObserverBuildOptions,
): Promise<{ handles: ObserverHandle[]; skipped: ObserverSkip[] }> {
  const handles: ObserverHandle[] = [];
  const skipped: ObserverSkip[] = [];

  for (const spec of specs) {
    const parts = splitModelRef(spec.ref);
    if (parts === null) {
      skipped.push({
        name: spec.name,
        ref: spec.ref,
        reason: `'${spec.ref}' is not connection:model`,
      });
      continue;
    }
    const connection = options.config.connections.find((c) => c.id === parts.connectionId);
    if (connection === undefined) {
      skipped.push({
        name: spec.name,
        ref: spec.ref,
        reason: `the connection '${parts.connectionId}' is not configured`,
      });
      continue;
    }

    let provider = options.provider?.(spec) ?? null;
    if (provider === null) {
      const key = await resolveKey(connection, { env: options.env });
      if (key === null && connectionNeedsKey(connection)) {
        skipped.push({
          name: spec.name,
          ref: spec.ref,
          reason: `no key for ${connection.id}; run 'plato auth login ${connection.id}'`,
        });
        continue;
      }
      provider = createProvider(connection.kind, {
        apiKey: key?.key ?? '',
        baseUrl: connection.baseUrl,
        fetchImpl: options.fetchImpl,
      });
    }

    handles.push({
      name: spec.name,
      ref: spec.ref,
      hex: spec.hex,
      agent: new ObserverAgent(provider, {
        model: spec.ref,
        role: spec.role,
        guidance: spec.guidance,
        pause: spec.pause,
        cancel: spec.cancel,
        maxInterventions: spec.maxInterventions,
      }),
    });
  }

  return { handles, skipped };
}

export type ObserverState = 'watching' | 'thinking' | 'exhausted';

export type ObserverEvent =
  | { type: 'watching'; name: string; ref: string; hex: string }
  | { type: 'state'; name: string; hex: string; state: ObserverState; last?: string }
  | { type: 'unavailable'; name: string; ref: string; reason: string }
  | { type: 'done'; text: string };

export interface ObserverHooks {
  event(event: ObserverEvent): void;
  notice(text: string): void;
}

/** A short hint about which file, command, or pattern a tool call touched. */
function argHint(args: Record<string, unknown>): string {
  if (typeof args['path'] === 'string') {
    return ` ${args['path'].slice(0, 120)}`;
  }
  if (typeof args['command'] === 'string') {
    return ` ${args['command'].slice(0, 120)}`;
  }
  if (typeof args['pattern'] === 'string') {
    return ` /${args['pattern'].slice(0, 80)}/`;
  }
  return '';
}

/**
 * Subscribes every observer to the run's bus. A decision is taken at the start
 * of a turn after the first, one observer at a time, and the run-wide cap of
 * five interventions is shared by the whole team (D31d). A philosopher never
 * approves a tool call; it can only guide, pause, or cancel.
 */
export function watchObservers(
  handles: readonly ObserverHandle[],
  options: { bus: AgentBus; controller: RunController; task: string },
  hooks: ObserverHooks,
): void {
  let interventionsUsed = 0;

  for (const handle of handles) {
    const digest: DigestEntry[] = [];
    let observing = true;
    let errorNotified = false;
    let parseErrorNotified = false;
    hooks.event({ type: 'watching', name: handle.name, ref: handle.ref, hex: handle.hex });

    options.bus.on((event) => {
      if (event.type === 'tool-event') {
        const args =
          typeof event.args === 'object' && event.args !== null
            ? (event.args as Record<string, unknown>)
            : undefined;
        digest.push({
          kind: 'tool',
          text: `${event.tool}${args === undefined ? '' : argHint(args)} ${event.phase}${
            event.ok === false ? ' (error)' : ''
          }`,
        });
        return;
      }
      if (event.type === 'text') {
        handle.agent.noteText(event.text);
        return;
      }
      if (event.type !== 'turn-started' || !observing) {
        return;
      }
      if (event.turn <= 1 || handle.agent.exhausted) {
        return;
      }
      if (interventionsUsed >= MAX_INTERVENTIONS) {
        return;
      }

      observing = false;
      hooks.event({
        type: 'state',
        name: handle.name,
        hex: handle.hex,
        state: 'thinking',
      });
      void handle.agent
        .observe(options.task, digest)
        .then((action) => {
          if (handle.agent.lastError !== null && !errorNotified) {
            errorNotified = true;
            hooks.notice(`[${handle.name}] unavailable — ${handle.agent.lastError}`);
          }
          if (handle.agent.parseErrors > 0 && !parseErrorNotified) {
            parseErrorNotified = true;
            hooks.notice(
              `[${handle.name}] reply not parseable as JSON — try a stronger model`,
            );
          }

          if (action.action === 'guidance') {
            interventionsUsed += 1;
            options.controller.sendGuidance(action.message);
            hooks.notice(`[${handle.name}] guidance: ${action.message}`);
            hooks.event({
              type: 'state',
              name: handle.name,
              hex: handle.hex,
              state: 'watching',
              last: `guidance: ${action.message}`,
            });
          } else if (action.action === 'pause') {
            interventionsUsed += 1;
            options.controller.pause();
            hooks.notice(`[${handle.name}] paused the run`);
            hooks.event({
              type: 'state',
              name: handle.name,
              hex: handle.hex,
              state: 'watching',
              last: 'paused the run',
            });
          } else if (action.action === 'cancel') {
            interventionsUsed += 1;
            options.controller.cancel();
            hooks.notice(`[${handle.name}] cancelled the run`);
            hooks.event({
              type: 'state',
              name: handle.name,
              hex: handle.hex,
              state: 'watching',
              last: 'cancelled the run',
            });
          } else {
            hooks.event({
              type: 'state',
              name: handle.name,
              hex: handle.hex,
              state: handle.agent.exhausted ? 'exhausted' : 'watching',
            });
          }
        })
        .catch(() => undefined)
        .finally(() => {
          observing = true;
          if (handle.agent.exhausted) {
            hooks.event({
              type: 'state',
              name: handle.name,
              hex: handle.hex,
              state: 'exhausted',
            });
          }
        });
    });
  }
}

/** The closing line: checks, interventions, and the health extras. */
export function observerSummary(handles: readonly ObserverHandle[]): string | undefined {
  if (handles.length === 0) {
    return undefined;
  }
  const checks = handles.reduce((sum, handle) => sum + handle.agent.checks, 0);
  const interventions = handles.reduce((sum, handle) => sum + handle.agent.interventions, 0);
  const unparseable = handles.reduce((sum, handle) => sum + handle.agent.parseErrors, 0);
  const degraded = handles.reduce((sum, handle) => sum + handle.agent.degraded, 0);
  const cost = handles.reduce((sum, handle) => sum + handle.agent.costUsd, 0);

  const parts = [
    `${handles.length === 1 ? 'observer' : 'observers'} ${checks} ${
      checks === 1 ? 'check' : 'checks'
    } · ${interventions} ${interventions === 1 ? 'intervention' : 'interventions'}`,
  ];
  if (unparseable > 0) {
    parts.push(`${unparseable} unparseable`);
  }
  if (degraded > 0) {
    parts.push(`${degraded} tier-blocked`);
  }
  if (cost > 0) {
    parts.push(`≈$${cost.toFixed(4)} watching`);
  }
  return parts.join(' · ');
}
