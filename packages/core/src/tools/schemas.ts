/**
 * M1 tool contracts (D05, D22): six-tool surface as declared to the model.
 * Schemas are provider-neutral JSON Schema (canonical D25b shape);
 * adapters map them onto their wire protocol. Implementations live in
 * execute.ts; the diff engine in diff.ts.
 */
import type { CanonicalTool } from '../providers/types.js';

/** Declares all M1 tools to the model. */
export function toolDeclarations(): CanonicalTool[] {
  return [
    {
      name: 'read_file',
      description: 'Read a text file from the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description:
        'Create or overwrite a file with full contents. Refused for existing non-empty files; prefer apply_diff.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
    {
      name: 'apply_diff',
      description:
        'Edit a file with exact SEARCH/REPLACE blocks. Each SEARCH must match exactly once. Re-applying an identical change succeeds as a no-op.',
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
              },
              required: ['search', 'replace'],
            },
          },
        },
        required: ['path', 'diffs'],
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
      description: 'List workspace files as relative paths.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'grep',
      description:
        'Search file contents for a fixed string; returns path:line:text hits.',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern'],
      },
    },
    {
      name: 'ask_user',
      description:
        'Ask the user a question with multiple-choice options. Use this when you need clarification, when there are multiple valid approaches, or when a decision requires user input. Always provide a recommended option.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user' },
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
          allowCustom: {
            type: 'boolean',
            default: true,
            description: 'Whether the user can type a custom answer instead of picking one',
          },
        },
        required: ['question', 'options'],
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

