/**
 * M1 shim: the subset of the VS Code extension API that Plato uses, backed by
 * local files, an in-memory secret map, and a transport to the test host.
 *
 * This file is NOT a general VS Code emulator. It exists to prove that the
 * existing IDE host can run outside VS Code. The Visual Studio C# shell will
 * replace the transport with stdio JSON-RPC in M2.
 */
import { promises as fsp, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ShimTransport {
  setHtml(html: string): void;
  post(msg: unknown): void;
  reveal(): void;
  disposed(): void;
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface ShimConfig {
  root: string;
  stateDir: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
  transport: ShimTransport;
}

let config: ShimConfig | null = null;

function cfg(): ShimConfig {
  if (config === null) {
    throw new Error('vscode shim: __configure() was not called');
  }
  return config;
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  // rename is atomic enough for the spike; M2 uses the same helper.
  try {
    renameSync(temporary, file);
  } catch {
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
}

/* ------------------------------------------------------------------ events */

export class Disposable {
  constructor(private readonly fn?: () => void) {}
  dispose(): void {
    this.fn?.();
  }
  static from(...items: Disposable[]): Disposable {
    return new Disposable(() => items.forEach((item) => item.dispose()));
  }
}

export type Thenable<T> = PromiseLike<T>;

export type Event<T> = (
  listener: (e: T) => unknown,
  thisArgs?: unknown,
  disposables?: Disposable[],
) => Disposable;

export class EventEmitter<T> {
  private readonly listeners = new Set<(e: T) => unknown>();
  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };
  fire(e: T): void {
    for (const listener of [...this.listeners]) {
      listener(e);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

/* --------------------------------------------------------------------- uri */

export class Uri {
  constructor(
    readonly scheme: string,
    readonly path: string,
    readonly query = '',
    readonly fragment = '',
  ) {}

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return this.scheme === 'file'
      ? pathToFileURL(this.path).toString()
      : `${this.scheme}://${this.path}`;
  }

  with(change: {
    scheme?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  static file(path: string): Uri {
    return new Uri('file', path);
  }

  static joinPath(uri: Uri, ...parts: string[]): Uri {
    return Uri.file(join(uri.fsPath, ...parts));
  }

  static parse(value: string): Uri {
    const url = new URL(value);
    return new Uri(
      url.protocol.replace(/:$/, ''),
      decodeURIComponent(url.pathname),
      url.search.replace(/^\?/, ''),
      url.hash.replace(/^#/, ''),
    );
  }
}

export class RelativePattern {
  constructor(
    readonly base: string | Uri,
    readonly pattern: string,
  ) {}
  get baseUri(): Uri {
    return typeof this.base === 'string' ? Uri.file(this.base) : this.base;
  }
}

/* ------------------------------------------------------------- ui objects */

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: unknown,
  ) {}
}

export class TreeItem {
  label?: string;
  collapsibleState?: number;
  command?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  description?: string;
  tooltip?: string;
  resourceUri?: Uri;
  constructor(label?: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
} as const;

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const;

export class TabInputText {
  constructor(readonly uri: Uri) {}
}

export type Tab = {
  label: string;
  input?: unknown;
};

export interface TreeDataProvider<T> {
  onDidChangeTreeData?: Event<void | T | undefined | null>;
  getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
  getChildren(element?: T): ProviderResult<T[]>;
  getParent?(element: T): ProviderResult<T>;
}

export type ProviderResult<T> =
  | T
  | undefined
  | null
  | Thenable<T | undefined | null>;

/* ---------------------------------------------------------------- defaults */

const DEFAULTS: Record<string, unknown> = {
  'plato.connections': [],
  'plato.model': 'anthropic:claude-sonnet-4-5',
  'plato.reasoning': 'off',
  'plato.orchestration': 'solo',
  'plato.compaction.threshold': 0.8,
  'plato.secrets.protect': [],
  'plato.secrets.allow': [],
  'plato.search.respectGitignore': false,
};

const configChanged = new EventEmitter<{
  affectsConfiguration(section: string): boolean;
}>();

export class WorkspaceConfiguration {
  constructor(private readonly section: string) {}

  private full(key: string): string {
    return this.section.length > 0 ? `${this.section}.${key}` : key;
  }

  get<T>(key: string, defaultValue?: T): T {
    const full = this.full(key);
    const value =
      config !== null && full in config.settings
        ? config.settings[full]
        : full in DEFAULTS
          ? DEFAULTS[full]
          : defaultValue;
    return value as T;
  }

  has(key: string): boolean {
    const full = this.full(key);
    return (config !== null && full in config.settings) || full in DEFAULTS;
  }

  inspect<T>(key: string): {
    key: string;
    defaultValue?: T;
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
  } {
    const full = this.full(key);
    return {
      key: full,
      defaultValue: DEFAULTS[full] as T | undefined,
      globalValue: (config?.settings[full] ?? undefined) as T | undefined,
    };
  }

  async update(
    key: string,
    value: unknown,
    _target?: number,
  ): Promise<void> {
    const c = cfg();
    c.settings[this.full(key)] = value;
    writeJson(join(c.stateDir, 'settings.json'), c.settings);
    configChanged.fire({
      affectsConfiguration: (section: string) =>
        section === 'plato' || section.startsWith('plato.'),
    });
  }
}

/* ------------------------------------------------------------------ memento */

class Memento {
  private data: Record<string, unknown>;
  constructor(private readonly file: string) {
    this.data = readJson(file);
  }
  get<T>(key: string, defaultValue?: T): T {
    return (key in this.data ? this.data[key] : defaultValue) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
    writeJson(this.file, this.data);
  }
  keys(): readonly string[] {
    return Object.keys(this.data);
  }
}

class SecretStorage {
  private readonly data: Record<string, string>;
  readonly onDidChange = new EventEmitter<{ key: string }>().event;
  constructor(seed: Record<string, string>) {
    this.data = { ...seed };
  }
  async get(key: string): Promise<string | undefined> {
    return this.data[key];
  }
  async store(key: string, value: string): Promise<void> {
    this.data[key] = value;
  }
  async delete(key: string): Promise<void> {
    delete this.data[key];
  }
}

/* ------------------------------------------------------------------ panel */

class WebviewPanelImpl {
  readonly webview: {
    html: string;
    options: unknown;
    cspSource: string;
    asWebviewUri(uri: Uri): Uri;
    postMessage(msg: unknown): Promise<boolean>;
    onDidReceiveMessage(cb: (msg: any) => unknown): Disposable;
  };
  readonly onDidDispose: Event<void>;

  private html = '';
  private receive: ((msg: any) => unknown) | null = null;
  private readonly disposeEmitter = new EventEmitter<void>();

  constructor(
    readonly viewType: string,
    readonly title: string,
    readonly viewColumn: number,
    readonly options: unknown,
  ) {
    const self = this;
    this.onDidDispose = this.disposeEmitter.event;
    this.webview = {
      get html(): string {
        return self.html;
      },
      set html(value: string) {
        self.html = value;
        cfg().transport.setHtml(value);
      },
      options,
      cspSource: '',
      asWebviewUri(uri: Uri): Uri {
        return uri;
      },
      async postMessage(msg: unknown): Promise<boolean> {
        cfg().transport.post(msg);
        return true;
      },
      onDidReceiveMessage(cb: (msg: any) => unknown): Disposable {
        self.receive = cb;
        return new Disposable(() => {
          if (self.receive === cb) self.receive = null;
        });
      },
    };
  }

  get active(): boolean {
    return true;
  }
  get visible(): boolean {
    return true;
  }

  reveal(): void {
    cfg().transport.reveal();
  }

  dispose(): void {
    this.disposeEmitter.fire();
    cfg().transport.disposed();
  }

  receiveMessage(msg: unknown): void {
    void this.receive?.(msg);
  }
}

let livePanel: WebviewPanelImpl | null = null;

/* ---------------------------------------------------------------- workspace */

function pathOf(uri: Uri | string): string {
  return typeof uri === 'string' ? uri : uri.fsPath;
}

export interface MementoLike {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

export interface SecretStorageLike {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ExtensionContext {
  subscriptions: Disposable[];
  workspaceState: MementoLike;
  globalState: MementoLike;
  secrets: SecretStorageLike;
  extensionUri: Uri;
  extensionPath: string;
  asAbsolutePath(relative: string): string;
  storageUri: Uri;
  globalStorageUri: Uri;
  logUri: Uri;
  extensionMode: number;
}

export interface WebviewPanel {
  webview: {
    html: string;
    options: unknown;
    cspSource: string;
    asWebviewUri(uri: Uri): Uri;
    postMessage(msg: unknown): Promise<boolean>;
    onDidReceiveMessage(cb: (msg: any) => unknown): Disposable;
  };
  reveal(viewColumn?: number, preserveFocus?: boolean): void;
  onDidDispose: Event<void>;
  dispose(): void;
}

export interface FileSystemWatcher {
  onDidChange: Event<Uri>;
  onDidCreate: Event<Uri>;
  onDidDelete: Event<Uri>;
  dispose(): void;
}

export interface WorkspaceApi {
  workspaceFolders: Array<{ uri: Uri; name: string; index: number }>;
  getConfiguration(section?: string): WorkspaceConfiguration;
  onDidChangeConfiguration: Event<{
    affectsConfiguration(section: string): boolean;
  }>;
  fs: {
    stat(uri: Uri | string): Promise<{
      type: number;
      ctime: number;
      mtime: number;
      size: number;
    }>;
    readFile(uri: Uri | string): Promise<Uint8Array>;
    writeFile(uri: Uri | string, content: Uint8Array): Promise<void>;
    createDirectory(uri: Uri | string): Promise<void>;
    delete(
      uri: Uri | string,
      options?: { recursive?: boolean },
    ): Promise<void>;
    readDirectory(uri: Uri | string): Promise<Array<[string, number]>>;
  };
  createFileSystemWatcher(
    pattern: string | RelativePattern,
  ): FileSystemWatcher;
  openTextDocument(uri: Uri | string): Promise<{
    uri: Uri;
    getText(): Promise<string>;
    lineCount: number;
  }>;
}

export const workspace: WorkspaceApi = {
  workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>,

  getConfiguration(section = ''): WorkspaceConfiguration {
    return new WorkspaceConfiguration(section);
  },

  onDidChangeConfiguration: configChanged.event,

  fs: {
    async stat(uri: Uri | string) {
      const stat = await fsp.stat(pathOf(uri));
      return {
        type: stat.isDirectory() ? FileType.Directory : FileType.File,
        ctime: stat.ctimeMs,
        mtime: stat.mtimeMs,
        size: stat.size,
      };
    },
    async readFile(uri: Uri | string) {
      return await fsp.readFile(pathOf(uri));
    },
    async writeFile(uri: Uri | string, content: Uint8Array) {
      await fsp.writeFile(pathOf(uri), content);
    },
    async createDirectory(uri: Uri | string) {
      await fsp.mkdir(pathOf(uri), { recursive: true });
    },
    async delete(uri: Uri | string, options?: { recursive?: boolean }) {
      await fsp.rm(pathOf(uri), { recursive: options?.recursive ?? false });
    },
    async readDirectory(uri: Uri | string) {
      const entries = await fsp.readdir(pathOf(uri), { withFileTypes: true });
      return entries.map((entry) => [
        entry.name,
        entry.isDirectory() ? FileType.Directory : FileType.File,
      ]);
    },
  },

  createFileSystemWatcher(_pattern: unknown) {
    const change = new EventEmitter<Uri>();
    const create = new EventEmitter<Uri>();
    const remove = new EventEmitter<Uri>();
    return {
      onDidChange: change.event,
      onDidCreate: create.event,
      onDidDelete: remove.event,
      dispose() {
        change.dispose();
        create.dispose();
        remove.dispose();
      },
    };
  },

  async openTextDocument(uri: Uri | string) {
    const file = pathOf(uri);
    return {
      uri: typeof uri === 'string' ? Uri.file(uri) : uri,
      getText: async () => readFileSync(file, 'utf8'),
      lineCount: 0,
    };
  },
};

/* ------------------------------------------------------------------- window */

export interface Diagnostic {
  message: string;
  severity: number;
  source?: string;
  code?: string | number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LanguagesApi {
  getDiagnostics(uri?: Uri): Diagnostic[];
  onDidChangeDiagnostics(cb: (e: { uris: Uri[] }) => void): Disposable;
  createDiagnosticCollection(): any;
}

export interface WindowApi {
  createWebviewPanel(
    viewType: string,
    title: string,
    viewColumn: number,
    options: unknown,
  ): WebviewPanel;
  createTreeView(
    id: string,
    options?: unknown,
  ): {
    onDidChangeVisibility: Event<{ visible: boolean }>;
    dispose(): void;
  };
  showQuickPick<T>(
    items: readonly T[],
    options?: { placeHolder?: string; [key: string]: unknown },
  ): Promise<T | undefined>;
  showInputBox(options?: {
    prompt?: string;
    password?: boolean;
    ignoreFocusOut?: boolean;
    [key: string]: unknown;
  }): Promise<string | undefined>;
  showOpenDialog(options?: unknown): Promise<Uri[] | undefined>;
  showInformationMessage(
    message: string,
    ...actions: Array<string | { modal?: boolean; [key: string]: unknown }>
  ): Promise<string | undefined>;
  showErrorMessage(
    message: string,
    ...actions: Array<string | { modal?: boolean; [key: string]: unknown }>
  ): Promise<string | undefined>;
  showWarningMessage(
    message: string,
    ...actions: Array<string | { modal?: boolean; [key: string]: unknown }>
  ): Promise<string | undefined>;
  showTextDocument(
    documentOrUri: any,
    options?: unknown,
  ): Promise<unknown>;
  tabGroups: {
    activeTabGroup: {
      activeTab: Tab | undefined;
    };
  };
}

export const window: WindowApi = {
  createWebviewPanel(
    viewType: string,
    title: string,
    viewColumn: number,
    options: unknown,
  ): WebviewPanelImpl {
    livePanel = new WebviewPanelImpl(viewType, title, viewColumn, options);
    return livePanel;
  },

  createTreeView(): {
    onDidChangeVisibility: Event<{ visible: boolean }>;
    dispose(): void;
  } {
    const visibility = new EventEmitter<{ visible: boolean }>();
    return {
      onDidChangeVisibility: visibility.event,
      dispose() {
        visibility.dispose();
      },
    };
  },

  async showQuickPick(): Promise<undefined> {
    return undefined;
  },
  async showInputBox(): Promise<undefined> {
    return undefined;
  },
  async showOpenDialog(): Promise<undefined> {
    return undefined;
  },
  async showInformationMessage(): Promise<undefined> {
    return undefined;
  },
  async showErrorMessage(): Promise<undefined> {
    return undefined;
  },
  async showWarningMessage(): Promise<undefined> {
    return undefined;
  },

  async showTextDocument(documentOrUri: any): Promise<unknown> {
    const file =
      documentOrUri?.uri?.fsPath ??
      documentOrUri?.fsPath ??
      (typeof documentOrUri === 'string' ? documentOrUri : '');
    if (file.length > 0) {
      await cfg().transport.request('editor.open', { path: file });
    }
    return { document: documentOrUri };
  },

  tabGroups: {
    activeTabGroup: {
      activeTab: undefined,
    },
  },
};

/* ----------------------------------------------------------------- commands */

const commandMap = new Map<string, (...args: any[]) => unknown>();

export const commands: any = {
  registerCommand(
    id: string,
    callback: (...args: any[]) => unknown,
  ): Disposable {
    commandMap.set(id, callback);
    return new Disposable(() => commandMap.delete(id));
  },
  async executeCommand(id: string, ...args: any[]): Promise<unknown> {
    if (id === 'workbench.action.closeActiveEditor') {
      await cfg().transport.request('editor.closeActive');
      return undefined;
    }
    const callback = commandMap.get(id);
    return callback === undefined ? undefined : await callback(...args);
  },
};

/* ---------------------------------------------------------------- languages */

export const languages: LanguagesApi = {
  getDiagnostics(): Diagnostic[] {
    return [];
  },
  onDidChangeDiagnostics(): Disposable {
    return new Disposable();
  },
  createDiagnosticCollection(): unknown {
    return {
      set() {},
      delete() {},
      clear() {},
      dispose() {},
    };
  },
};

/* -------------------------------------------------------------- public api */

export function __configure(next: ShimConfig): void {
  config = next;
  mkdirSync(next.stateDir, { recursive: true });
  workspace.workspaceFolders = [
    {
      uri: Uri.file(next.root),
      name: basename(next.root),
      index: 0,
    },
  ];
  livePanel = null;
  commandMap.clear();
}

export function __createContext(): any {
  const c = cfg();
  return {
    subscriptions: [] as Disposable[],
    workspaceState: new Memento(join(c.stateDir, 'workspace-state.json')),
    globalState: new Memento(join(c.stateDir, 'global-state.json')),
    secrets: new SecretStorage(c.secrets),
    extensionUri: Uri.file(c.root),
    extensionPath: c.root,
    asAbsolutePath: (relative: string) => join(c.root, relative),
    storageUri: Uri.file(join(c.stateDir, 'storage')),
    globalStorageUri: Uri.file(join(c.stateDir, 'global-storage')),
    logUri: Uri.file(join(c.stateDir, 'logs')),
    extensionMode: 3,
  };
}

export function __panel(): unknown {
  return livePanel;
}

export function __receive(msg: unknown): void {
  livePanel?.receiveMessage(msg);
}
