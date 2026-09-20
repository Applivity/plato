/**
 * M1 tool contracts (D05, D22): the tool surface as declared to the model.
 * Schemas are provider-neutral JSON Schema (canonical D25b shape);
 * adapters map them onto their wire protocol. Implementations live in
 * execute.ts; the diff engine in diff.ts.
 *
 * Do not write a tool COUNT here — it has gone stale twice (ask_user in D34 and
 * git both landed after "six-tool surface" was written). The array below is the
 * source of truth.
 */
import type { CanonicalTool } from '../providers/types.js';

/** Declares all M1 tools to the model. */
export function toolDeclarations(): CanonicalTool[] {
  return [
    {
      name: 'read_file',
      description:
        'Read a text file from the workspace. Returns the whole file when it is small. For a large file, read it in windows with offset and limit — when the output is cut it states which lines it covers and how to continue.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: {
            type: 'number',
            description: 'First line to return, 1-based. Default 1.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to return.',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description:
        'Create a file, or replace one whose whole contents you already know. An existing EMPTY file is always writable. An existing non-empty file is refused unless you pass overwrite: true — use apply_diff for a targeted edit instead.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          overwrite: {
            type: 'boolean',
            description:
              'Replace an existing non-empty file. Set this only when the entire file must change.',
          },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'apply_diff',
      description:
        'Edit one file with exact SEARCH/REPLACE blocks. Each SEARCH must match exactly once — unless replace_all is set on that block, which replaces every occurrence. Re-applying an identical change succeeds as a no-op. For edits spanning several files use apply_patch instead, so they land together or not at all.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          diffs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                search: { type: 'string' },
                replace: { type: 'string' },
                replace_all: {
                  type: 'boolean',
                  description:
                    'Replace EVERY occurrence of search, instead of requiring exactly one. Use for renaming a symbol that appears many times.',
                },
              },
              required: ['search', 'replace'],
            },
          },
        },
        required: ['path', 'diffs'],
      },
    },
    {
      name: 'apply_patch',
      description:
        'Apply SEARCH/REPLACE edits to SEVERAL files in one call, all-or-nothing: if any block fails, NO file is changed. Use this instead of several apply_diff calls when a change must land as a whole. The user approves it once.',
      parameters: {
        type: 'object',
        properties: {
          patches: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                diffs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      search: { type: 'string' },
                      replace: { type: 'string' },
                      replace_all: { type: 'boolean' },
                    },
                    required: ['search', 'replace'],
                  },
                },
              },
              required: ['path', 'diffs'],
            },
          },
        },
        required: ['patches'],
      },
    },
    {
      name: 'shell',
      description: 'Run a shell command inside the workspace root.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
    {
      name: 'list_dir',
      description:
        'List workspace files as relative paths. Pass path to list only that directory.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Optional directory to list, relative to the workspace root. Omit to list the whole workspace.',
          },
        },
      },
    },
    {
      name: 'grep',
      description:
        'Search file contents. Returns path:line:text by default; mode changes that to matching file names or per-file counts. The pattern is a literal string unless regex is true.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              'Text to find. Literal by default — regex metacharacters are not special unless regex is true.',
          },
          regex: {
            type: 'boolean',
            description: 'Treat pattern as a JavaScript regular expression.',
          },
          glob: {
            type: 'string',
            description:
              'Only search files whose path matches this pattern, e.g. "*.ts" or "src/**/*.ts". A pattern with no slash matches the file NAME, so "*.ts" finds TypeScript files at any depth.',
          },
          mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description:
              'content (default) returns matching lines; files_with_matches returns only the file names; count returns a per-file match count.',
          },
          limit: {
            type: 'number',
            description: 'Maximum result lines to return. Default 100.',
          },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'glob',
      description:
        'Find files by NAME pattern, e.g. "**/*.test.ts" or "*.json". A pattern with no slash matches the file name at any depth. Use this to discover files when you do not know the path.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              'Glob pattern. "*" matches within one directory, "**" crosses directories, "?" matches one character.',
          },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'ask_user',
      description:
        'Ask the user one or more questions with multiple-choice options. Use this when you need clarification, when there are multiple valid approaches, or when a decision requires user input. You can ask up to 3 questions at once. Always provide a recommended option.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            description: 'The list of questions to ask.',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'The question title/heading' },
                context: { type: 'string', description: 'Optional 1-2 line context explaining why you are asking' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 2,
                  maxItems: 6,
                  description: '2-6 answer options (short labels)',
                },
                recommended: {
                  type: 'string',
                  description: 'Which option you recommend (must exactly match one of the options)',
                },
              },
              required: ['question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
    {
      name: 'git',
      description: 'Read-only git info of the workspace.',
      parameters: {
        type: 'object',
        properties: { verb: { type: 'string', enum: ['status', 'diff'] } },
        required: ['verb'],
      },
    },
  ];
}

