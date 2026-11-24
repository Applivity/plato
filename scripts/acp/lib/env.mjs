/**
 * The empty-home profile: a fresh directory for the agent's config, and no
 * provider credentials in the environment. This is the shape the registry
 * validator uses. It is deliberately conservative: it removes every `PLATO_*`
 * variable and a known list of credential variables.
 */
import { join } from 'node:path';

const CREDENTIAL_ENV = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'PERPLEXITY_API_KEY',
  'COHERE_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
];

export function isolatedEnv(home) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PLATO_')) delete env[key];
  }
  for (const key of CREDENTIAL_ENV) delete env[key];

  env.HOME = home;
  env.USERPROFILE = home;
  env.APPDATA = join(home, 'AppData', 'Roaming');
  env.LOCALAPPDATA = join(home, 'AppData', 'Local');
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_DATA_HOME = join(home, '.local', 'share');
  // Do not reach the machine's real keychain while proving the empty-home path.
  env.PLATO_DISABLE_KEYRING = '1';
  return env;
}
