#!/usr/bin/env python3
"""Real-model proof for the Ink terminal, which needs a pseudo-terminal.

`real.mjs` drives the non-TTY hosts. This drives the TUI the way a person does:
type a task, pick a numbered option on the approval card, then `/exit`. It
asserts what landed on disk and how the process ended.

Keys come from the environment only and are never printed:

    set -a; . ~/.plato-real-test.env; set +a
    python3 packages/cli/scripts/pty-real.py

Not shipped.
"""
import os
import pty
import re
import select
import shutil
import sys
import tempfile
import time

CLI = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist', 'cli.js')
NODE = shutil.which('node')
KEY = os.environ.get('PLATO_TEST_OPENAI_KEY', '')
BASE = (os.environ.get('PLATO_TEST_OPENAI_BASE_URL') or '').strip() or 'https://api.deepseek.com/v1'
MODEL = (os.environ.get('PLATO_TEST_OPENAI_MODEL') or '').strip() or 'deepseek-flash'

if NODE is None or KEY == '':
    print('pty-real: node and PLATO_TEST_OPENAI_KEY are required', file=sys.stderr)
    sys.exit(2)

home = tempfile.mkdtemp(prefix='plato-pty-home-')
work = tempfile.mkdtemp(prefix='plato-pty-work-')
os.makedirs(os.path.join(home, 'config'), exist_ok=True)
with open(os.path.join(home, 'config', 'config.json'), 'w') as handle:
    handle.write(
        '{\n'
        '  "connections": [{ "id": "openai-real", "kind": "openai", "baseUrl": "%s" }],\n'
        '  "model": "openai-real:%s",\n'
        '  "team": "solo",\n'
        '  "mode": "edit",\n'
        '  "reasoning": "off",\n'
        '  "compactionThreshold": 0.8\n'
        '}\n' % (BASE, MODEL)
    )

env = dict(os.environ)
env.update(
    {
        'PLATO_CONFIG_DIR': os.path.join(home, 'config'),
        'PLATO_DATA_DIR': os.path.join(home, 'data'),
        'PLATO_HOME': os.path.join(home, 'plato'),
        'PLATO_DISABLE_KEYRING': '1',
        'PLATO_KEY_OPENAI_REAL': KEY,
        'COLUMNS': '100',
        'LINES': '40',
        'TERM': 'xterm-256color',
    }
)

pid, fd = pty.fork()
if pid == 0:
    os.chdir(work)
    os.execvpe(NODE, [NODE, CLI], env)

raw = ''


def read_for(seconds):
    global raw
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            return
        if not chunk:
            return
        raw += chunk.decode('utf-8', 'replace')


def screen():
    text = re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]', '', raw)
    return text.replace('\x1b[?25l', '').replace('\x1b[?25h', '')


def wait_for(pattern, timeout, label):
    end = time.time() + timeout
    while time.time() < end:
        read_for(0.2)
        if re.search(pattern, screen(), re.MULTILINE):
            return
    raise AssertionError('timed out waiting for %s' % label)


def send(text):
    os.write(fd, text.encode())


def finish():
    try:
        os.kill(pid, 9)
    except ProcessLookupError:
        pass


failed = 0
try:
    wait_for(r'›', 30, 'the composer')
    send('Use the write_file tool to create pty.txt containing exactly "pty ok" and nothing else.')
    time.sleep(0.3)
    send('\r')

    wait_for(r'Allow \w+\?', 90, 'the first approval card')

    def option_label(line):
        text = line.strip().strip('│').strip()
        if text.startswith('❯ '):
            text = text[2:].strip()
        if text in ('No', 'Yes') or text.startswith('Yes, allow '):
            return text
        return None

    def answer_yes():
        # The card lists No, Yes, and a per-file Yes; a number key picks one.
        labels = [label for label in map(option_label, screen().splitlines()) if label]
        card = labels[-3:]
        assert card[0] == 'No' and card[1] == 'Yes', 'unexpected card options %r' % (card,)
        send(str(card.index('Yes') + 1))
        time.sleep(0.2)
        send('\r')

    # The model decides how many tools it calls, so answer every card it shows.
    answered = 0
    deadline = time.time() + 120
    while time.time() < deadline:
        read_for(0.3)
        if re.search(r'\d+ turns? · ', screen()):
            break
        cards = len(re.findall(r'Allow \w+\?', screen()))
        if cards > answered:
            read_for(0.4)
            answered = cards
            answer_yes()
    else:
        raise AssertionError('timed out waiting for the closing summary')
    path = os.path.join(work, 'pty.txt')
    assert os.path.exists(path), 'the approved write did not happen'
    assert open(path).read() == 'pty ok', 'the file content is %r' % open(path).read()

    send('/exit\r')
    deadline = time.time() + 15
    status = None
    while time.time() < deadline:
        read_for(0.2)
        done, status = os.waitpid(pid, os.WNOHANG)
        if done == pid:
            break
        status = None
    assert status is not None, 'the TUI did not exit on /exit'
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, 'exit status %r' % (status,)
    print('✓ the TUI runs a real model, approves a write on the card, and exits cleanly')
except AssertionError as error:
    failed = 1
    print('✗ %s' % error)
    print('--- screen ---')
    print(screen()[-2000:])
finally:
    finish()
    shutil.rmtree(home, ignore_errors=True)
    shutil.rmtree(work, ignore_errors=True)

sys.exit(failed)
