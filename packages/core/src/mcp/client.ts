/**
 * MCP stdio client (D06, M3): JSON-RPC 2.0 over a child process per
 * configured server. Lifecycle: spawn → initialize handshake →
 * tools/list. Tools surface as canonical declarations named
 * `mcp__<server>__<tool>`. A dead or hung server degrades to zero tools;
 * it never breaks the loop.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface McpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** D49bt: skipped at the next run. Absent means enabled. */
  disabled?: boolean;
}

export class McpServer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = '';
  readonly tools: McpTool[] = [];

  constructor(
    readonly serverName: string,
    private readonly cfg: McpServerConfig,
  ) {}

  /** Spawns the server, handshakes, and loads the tool list. */
  async start(timeoutMs = 20_000): Promise<void> {
    const proc = spawn(this.cfg.command, this.cfg.args ?? [], {
      env: { ...process.env, ...(this.cfg.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    proc.stdout.on('data', (d: Buffer) => this.onData(d));
    proc.stderr.on('data', () => {
      // Server diagnostics go nowhere by design (noisy daemons).
    });
    proc.on('close', () => {
      for (const p of this.pending.values()) {
        p.reject(new Error(`mcp server ${this.serverName} exited`));
      }
      this.pending.clear();
      this.proc = null;
    });

    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('mcp handshake timeout')), timeoutMs),
    );
    try {
      await Promise.race([this.call('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'plato', version: '0.1.0' },
      }), timer]);
      // Notification: no response expected.
      this.notify('notifications/initialized');
      const res = (await Promise.race([
        this.call('tools/list', {}),
        timer,
      ])) as { tools?: unknown[] };
      for (const t of res.tools ?? []) {
        const rec = t as Record<string, unknown>;
        if (typeof rec['name'] !== 'string') {
          continue;
        }
        this.tools.push({
          name: String(rec['name']),
          description:
            typeof rec['description'] === 'string'
              ? String(rec['description'])
              : '',
          parameters:
            (rec['inputSchema'] as Record<string, unknown>) ??
            { type: 'object', properties: {} },
        });
      }
    } finally {
      clearTimeout(undefined as unknown as ReturnType<typeof setTimeout>);
    }
  }

  /**
   * Tool name as exposed to the model: mcp__<server>__<tool>.
   *
   * D49bt: the separator is a DOUBLE underscore, matching Claude Code and Codex.
   * A single one is ambiguous — a server may be named `a_b` and a tool may be
   * `b_c`, and the loop keys its tool map by this joined string, so a collision
   * silently dropped one server's tool with nothing reported anywhere.
   */
  fullName(tool: string): string {
    return `mcp__${this.serverName}__${tool}`;
  }

  async callTool(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs = 60_000,
  ): Promise<unknown> {
    const timer = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`mcp tool ${tool} timed out`)),
        timeoutMs,
      ),
    );
    const res = (await Promise.race([
      this.call('tools/call', { name: tool, arguments: args }),
      timer,
    ])) as { content?: unknown[]; isError?: boolean };
    if (res.isError) {
      const text = (res.content ?? [])
        .map((c) => String((c as Record<string, unknown>)['text'] ?? ''))
        .join('\n');
      throw new Error(text || `mcp tool ${tool} failed`);
    }
    return res.content ?? [];
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }

  private onData(d: Buffer): void {
    this.buffer += d.toString('utf8');
    let idx = this.buffer.indexOf('\n');
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) {
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (typeof msg['id'] === 'number' && this.pending.has(msg['id'])) {
            const p = this.pending.get(msg['id'])!;
            this.pending.delete(msg['id']);
            if (msg['error']) {
              p.reject(
                new Error(
                  String(
                    (msg['error'] as Record<string, unknown>)['message'] ??
                      'mcp error',
                  ),
                ),
              );
            } else {
              p.resolve(msg['result']);
            }
          }
        } catch {
          // Non-JSON noise on stdout: skip the line.
        }
      }
      idx = this.buffer.indexOf('\n');
    }
  }

  private call(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        reject(new Error(`mcp server ${this.serverName} not running`));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.proc.stdin.write(msg + '\n', (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private notify(method: string): void {
    if (this.proc) {
      this.proc.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', method }) + '\n',
      );
    }
  }
}
