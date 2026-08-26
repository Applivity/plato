/**
 * Curated provider presets (D28): pick-to-add entries for the Settings
 * page. Data only — the adapter stays registry-selected by `kind`.
 * Sources cross-checked against OpenRouter/LiteLLM/Cline/OpenCode
 * conventions. Base URLs drift rarely but do drift; users can override
 * every field after picking a preset.
 */

export interface ProviderPreset {
  /** Suggested connection id (editable on collision). */
  id: string;
  label: string;
  kind: 'anthropic' | 'openai';
  baseUrl: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'litellm', label: 'LiteLLM Proxy', kind: 'openai', baseUrl: 'http://localhost:4000/v1' },
  { id: 'ollama', label: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://localhost:1234/v1' },
  { id: 'vllm', label: 'vLLM (self-hosted)', kind: 'openai', baseUrl: 'http://localhost:8000/v1' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1' },
  { id: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'fireworks', label: 'Fireworks AI', kind: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'cerebras', label: 'Cerebras', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1' },
  { id: 'perplexity', label: 'Perplexity', kind: 'openai', baseUrl: 'https://api.perplexity.ai' },
  { id: 'gemini', label: 'Google Gemini (OpenAI-compat)', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'huggingface', label: 'HuggingFace Router', kind: 'openai', baseUrl: 'https://router.huggingface.co/v1' },
];
