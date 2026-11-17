import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { loadConfig, type ConnectionConfig } from '../config.js';
import { deleteKey, resolveKey } from '../keys.js';
import type { Env } from '../paths.js';
import {
  askModels,
  connectionFor,
  providerChoices,
  saveSetup,
  type ModelAnswer,
  type ProviderChoice,
} from '../setup.js';

export interface SetupResult {
  saved: boolean;
  declined?: boolean;
  model?: string;
}

type Step =
  | 'offer'
  | 'provider'
  | 'url'
  | 'addv1'
  | 'key'
  | 'existing'
  | 'checking'
  | 'models'
  | 'modelId'
  | 'context'
  | 'rejected'
  | 'unreachable'
  | 'saved';

function moved(selected: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(length - 1, selected + delta));
}

/**
 * Setup as an Ink screen: used by the first run, `plato auth login`, and
 * `/model add`. Arrows move, Enter selects, Esc goes back a step and then
 * aborts, and typing filters the provider list. The key is masked.
 */
export function SetupScreen({
  env,
  offer = false,
  fetchImpl,
  provider,
  onDone,
}: {
  env: Env;
  offer?: boolean;
  fetchImpl?: typeof fetch;
  /** A provider already chosen (a named login), so the picker is skipped. */
  provider?: string;
  onDone: (result: SetupResult) => void;
}): ReactElement {
  const CHOICES = providerChoices();
  const [step, setStep] = useState<Step>(offer ? 'offer' : 'provider');
  const [choice, setChoice] = useState<ProviderChoice | null>(null);
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [kept, setKept] = useState(false);
  const [existing, setExisting] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ModelAnswer | null>(null);
  const [model, setModel] = useState('');
  const [modelText, setModelText] = useState('');
  const [context, setContext] = useState('');
  const [savedModel, setSavedModel] = useState('');
  const doneRef = useRef(false);
  const initialisedRef = useRef(false);
  const finish = (result: SetupResult): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(result);
  };
  const abort = (): void => finish({ saved: false });

  const visible = CHOICES.filter((entry) => {
    const needle = filter.toLowerCase();
    return needle.length === 0 || entry.label.toLowerCase().includes(needle) || entry.id.includes(needle);
  });

  const connection = (): ConnectionConfig => {
    if (choice === null) return { id: 'custom', kind: 'openai' };
    const base = choice.custom === true ? url : undefined;
    const made = connectionFor(choice, base);
    if (made.id === 'custom') {
      const config = loadConfig(env);
      if (config.connections.some((entry) => entry.id === 'custom')) {
        return { ...made, id: 'custom-2' };
      }
    }
    return made;
  };

  const enterKeyStep = async (): Promise<void> => {
    const found = await resolveKey(connection(), { env });
    if (found !== null) {
      setExisting(found.key.slice(0, 4));
      setKept(false);
      setStep('existing');
      return;
    }
    setExisting(null);
    setStep('key');
  };

  const validate = async (apiKey: string): Promise<void> => {
    setStep('checking');
    const result = await askModels(connection(), apiKey, {
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
    setAnswer(result);
    if (result.kind === 'rejected') {
      setStep('rejected');
      return;
    }
    if (result.kind === 'unreachable') {
      setStep('unreachable');
      return;
    }
    if (result.entries.length === 0) {
      setModelText('');
      setStep('modelId');
      return;
    }
    setSelected(0);
    setStep('models');
  };

  const persist = async (chosenModel: string, contextWindow?: number): Promise<void> => {
    const full = await saveSetup({
      env,
      connection: connection(),
      model: chosenModel,
      ...(kept || secret.length === 0 ? {} : { key: secret }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
    });
    setSavedModel(full);
    setStep('saved');
  };

  const afterModel = (chosen: { id: string; maxContext?: number }): void => {
    setModel(chosen.id);
    // The question is about the answer, not the provider: any endpoint that
    // listed the model without a window leaves the fold guessing, so ask.
    if (chosen.maxContext === undefined) {
      setStep('context');
      return;
    }
    void persist(chosen.id);
  };

  // A provider named on the command line starts the flow already chosen.
  useEffect(() => {
    if (provider === undefined || initialisedRef.current) return;
    initialisedRef.current = true;
    const chosen = CHOICES.find((entry) => entry.id === provider);
    if (chosen === undefined) return;
    setChoice(chosen);
    if (chosen.custom === true) {
      setStep('url');
      return;
    }
    void (async () => {
      const found = await resolveKey(connectionFor(chosen, undefined), { env }).catch(
        () => null,
      );
      if (found !== null) {
        setExisting(found.key.slice(0, 4));
        setStep('existing');
      } else {
        setStep('key');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    if (step !== 'saved') return;
    const timer = setTimeout(() => finish({ saved: true, model: savedModel }), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, savedModel]);

  useInput((input, key) => {
    const enter = key.return || input === '\r' || input === '\n';
    const backspace = key.backspace || key.delete;
    if (key.ctrl && input === 'c') {
      abort();
      return;
    }
    switch (step) {
      case 'offer': {
        if (key.upArrow || key.downArrow) {
          setSelected(selected === 0 ? 1 : 0);
          return;
        }
        if (input.toLowerCase() === 'y') {
          setStep('provider');
          return;
        }
        if (input.toLowerCase() === 'n') {
          finish({ saved: false, declined: true });
          return;
        }
        if (enter) {
          if (selected === 0) setStep('provider');
          else finish({ saved: false, declined: true });
        }
        return;
      }
      case 'provider': {
        if (key.upArrow || key.downArrow) {
          setSelected(moved(selected, key.upArrow ? -1 : 1, visible.length));
          return;
        }
        if (backspace) {
          setFilter(filter.slice(0, -1));
          setSelected(0);
          return;
        }
        if (enter) {
          const picked = visible[selected];
          if (picked === undefined) return;
          setChoice(picked);
          setSelected(0);
          if (picked.custom === true) {
            setStep('url');
          } else {
            void enterKeyStep();
          }
          return;
        }
        if (key.escape) {
          abort();
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) {
          setFilter(filter + input);
          setSelected(0);
        }
        return;
      }
      case 'url': {
        if (key.escape) {
          setStep('provider');
          return;
        }
        if (backspace) {
          setUrl(url.slice(0, -1));
          return;
        }
        if (enter) {
          if (url.trim().length === 0) return;
          try {
            const parsed = new URL(url.trim());
            if (parsed.pathname === '' || parsed.pathname === '/') {
              setStep('addv1');
              return;
            }
          } catch {
            return;
          }
          void enterKeyStep();
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) setUrl(url + input);
        return;
      }
      case 'addv1': {
        if (key.escape) {
          setStep('url');
          return;
        }
        if (input.toLowerCase() === 'n') {
          void enterKeyStep();
          return;
        }
        if (enter || input.toLowerCase() === 'y') {
          setUrl(`${url.trim().replace(/\/$/, '')}/v1`);
          void enterKeyStep();
        }
        return;
      }
      case 'existing': {
        const options = ['Keep the saved key', 'Replace it', 'Clear it'];
        if (key.upArrow || key.downArrow) {
          setSelected(moved(selected, key.upArrow ? -1 : 1, options.length));
          return;
        }
        if (key.escape) {
          setStep(choice?.custom === true ? 'url' : 'provider');
          return;
        }
        if (!enter) return;
        if (selected === 0) {
          setKept(true);
          void (async () => {
            const found = await resolveKey(connection(), { env }).catch(() => null);
            await validate(found?.key ?? '');
          })();
          return;
        }
        if (selected === 2) {
          void (async () => {
            await deleteKey(connection().id, { env });
            setExisting(null);
            setKept(false);
            setSecret('');
            setStep('key');
          })();
          return;
        }
        setKept(false);
        setSecret('');
        setStep('key');
        return;
      }
      case 'key': {
        if (key.escape) {
          setStep(choice?.custom === true ? 'url' : 'provider');
          return;
        }
        if (backspace) {
          setSecret(secret.slice(0, -1));
          return;
        }
        if (enter) {
          void validate(secret.trim());
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) setSecret(secret + input);
        return;
      }
      case 'models': {
        const entries = answer?.kind === 'ok' ? answer.entries : [];
        const count = entries.length + 1;
        if (key.upArrow || key.downArrow) {
          setSelected(moved(selected, key.upArrow ? -1 : 1, count));
          return;
        }
        if (key.escape) {
          setStep('key');
          return;
        }
        if (!enter) return;
        if (selected >= entries.length) {
          setModelText('');
          setStep('modelId');
          return;
        }
        const entry = entries[selected];
        if (entry !== undefined) afterModel(entry);
        return;
      }
      case 'modelId': {
        if (key.escape) {
          setStep(answer?.kind === 'ok' && answer.entries.length > 0 ? 'models' : 'key');
          return;
        }
        if (backspace) {
          setModelText(modelText.slice(0, -1));
          return;
        }
        if (enter) {
          if (modelText.trim().length === 0) return;
          afterModel({ id: modelText.trim() });
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) setModelText(modelText + input);
        return;
      }
      case 'context': {
        if (key.escape) {
          setStep('models');
          return;
        }
        if (backspace) {
          setContext(context.slice(0, -1));
          return;
        }
        if (enter) {
          const size = Number(context);
          void persist(
            model,
            context.length > 0 && Number.isInteger(size) && size > 0 ? size : undefined,
          );
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) setContext(context + input);
        return;
      }
      case 'rejected': {
        if (key.upArrow || key.downArrow) {
          setSelected(selected === 0 ? 1 : 0);
          return;
        }
        if (key.escape) {
          setStep('key');
          return;
        }
        if (!enter) return;
        if (selected === 0) {
          setSecret('');
          setKept(false);
          setStep('key');
        } else {
          setStep(choice?.custom === true ? 'url' : 'provider');
        }
        return;
      }
      case 'unreachable': {
        if (key.upArrow || key.downArrow) {
          setSelected(selected === 0 ? 1 : 0);
          return;
        }
        if (key.escape || (enter && selected === 1)) {
          setStep('key');
          return;
        }
        if (enter && selected === 0) {
          setModelText('');
          setStep('modelId');
        }
        return;
      }
      case 'checking':
      case 'saved':
        return;
    }
  });

  const option = (text: string, index: number): ReactElement => (
    <Text key={text} color={index === selected ? 'cyan' : undefined}>
      {index === selected ? '❯ ' : '  '}
      {text}
    </Text>
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      {step === 'offer' ? (
        <>
          <Text>No model is set up yet. Plato needs a provider to answer.</Text>
          <Text>Set one up now?</Text>
          {['Yes', 'No'].map((text, index) => option(text, index))}
          <Text dimColor>↑↓ move · Enter selects</Text>
        </>
      ) : null}

      {step === 'provider' ? (
        <>
          <Text bold>Provider</Text>
          {visible.map((entry, index) => option(entry.label, index))}
          {filter.length > 0 ? <Text dimColor>filter: {filter}</Text> : null}
          <Text dimColor>↑↓ move · Enter selects · type to filter · Esc cancels</Text>
        </>
      ) : null}

      {step === 'url' ? (
        <>
          <Text bold>Endpoint URL</Text>
          <Text>{url}</Text>
          <Text dimColor>Enter accepts · Esc goes back</Text>
        </>
      ) : null}

      {step === 'addv1' ? (
        <>
          <Text>Add /v1 to the address?</Text>
          {['Yes, add /v1', 'No, keep it as typed'].map((text, index) => option(text, index))}
          <Text dimColor>Enter accepts · Esc goes back</Text>
        </>
      ) : null}

      {step === 'existing' ? (
        <>
          <Text>
            A key is saved for {connection().id}: {existing}…
          </Text>
          {['Keep the saved key', 'Replace it', 'Clear it'].map((text, index) => option(text, index))}
          <Text dimColor>↑↓ move · Enter selects · Esc goes back</Text>
        </>
      ) : null}

      {step === 'key' ? (
        <>
          <Text bold>API key</Text>
          <Text>{'•'.repeat(secret.length)}</Text>
          <Text dimColor>
            {choice?.custom === true ? 'Enter skips it · ' : ''}Enter accepts · Esc goes back
          </Text>
        </>
      ) : null}

      {step === 'checking' ? <Text>Checking the key…</Text> : null}

      {step === 'models' && answer?.kind === 'ok' ? (
        <>
          <Text color="green">
            ✓ key accepted · {answer.entries.length}{' '}
            {answer.entries.length === 1 ? 'model' : 'models'}
          </Text>
          <Text bold>Model</Text>
          {answer.entries.map((entry, index) => option(entry.id, index))}
          {option('Type a model id…', answer.entries.length)}
          <Text dimColor>↑↓ move · Enter selects · Esc goes back</Text>
        </>
      ) : null}

      {step === 'modelId' ? (
        <>
          <Text>
            {answer?.kind === 'ok' && answer.entries.length === 0
              ? 'The endpoint did not list any models.'
              : 'Type the model id.'}
          </Text>
          <Text>{modelText}</Text>
          <Text dimColor>Enter accepts · Esc goes back</Text>
        </>
      ) : null}

      {step === 'rejected' ? (
        <>
          <Text color="red">The key was rejected.</Text>
          <Text dimColor>the endpoint said the key is not accepted</Text>
          {['Replace the key', 'Edit the endpoint'].map((text, index) => option(text, index))}
          <Text dimColor>↑↓ move · Enter selects · Esc goes back</Text>
        </>
      ) : null}

      {step === 'unreachable' && answer?.kind === 'unreachable' ? (
        <>
          <Text>The endpoint could not be reached ({answer.reason}).</Text>
          <Text>Continue anyway?</Text>
          {['Continue anyway', 'Go back'].map((text, index) => option(text, index))}
          <Text dimColor>↑↓ move · Enter selects · Esc goes back</Text>
        </>
      ) : null}

      {step === 'context' ? (
        <>
          <Text>The endpoint did not say how large its context is.</Text>
          <Text>Context length in tokens (Enter skips):</Text>
          <Text>{context}</Text>
          <Text dimColor>Enter accepts · Esc goes back</Text>
        </>
      ) : null}

      {step === 'saved' ? <Text color="green">Saved. Using {savedModel}.</Text> : null}
    </Box>
  );
}
