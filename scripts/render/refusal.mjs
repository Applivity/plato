import { check, page, finish, checkPageClean, TOOL_WORDS_MSG } from './plib.mjs';

/**
 * D49aq: a refusal is readable.
 *
 * The pre-flight guard used to push a tool_result to the model and emit nothing,
 * so a run's record could not distinguish "the guard refused this call" from
 * "the model never made one". The fix is a bus event, and this suite covers the
 * half of it the user actually reads: the line in the run's transcript view,
 * which says the call was refused AND which guard refused it.
 *
 * The reason arrives as a fixed word from the host rather than as the refusal
 * sentence, because the sentence can quote the argument and no argument reaches
 * the record (D24c). That is asserted here too — as the absence of the command.
 */

const showRun = async (p, events) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), {
    type: 'run',
    events: [{ kind: 'header' }, ...events],
  });
  await p.waitForTimeout(260);
};

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

/**
 * D49ba: the view holds no tool words of its own — the host sends them at ready,
 * so a suite that draws a guard line or an activity row must send them first.
 * Without this the line reads "Plato did not run the tool call", which is the
 * generic fallback and would make these assertions test nothing.
 */
const open = async (w) => {
  const p = await page(w);
  await post(p, TOOL_WORDS_MSG);
  return p;
};

const replay = async (p, log) => {
  await post(p, { type: 'restore', log, hasConnections: true, title: '' });
  await p.waitForTimeout(260);
};

const toolLines = (p) => p.evaluate(() => [...document.querySelectorAll('.msg.tool')]
  .map((e) => e.textContent));

const guardLines = (p) => p.evaluate(() => [...document.querySelectorAll('.msg.guard')]
  .map((e) => e.textContent));

// A. Each guard names itself.
{
  const p = await open(760);
  await showRun(p, [
    { type: 'tool-event', tool: 'shell', phase: 'refused', reason: 'secret' },
    { type: 'tool-event', tool: 'write_file', phase: 'refused', reason: 'containment' },
  ]);
  const lines = (await toolLines(p)).join('\n');
  check('a refused tool call is in the record at all', lines.includes('refused'), lines);
  check('the secret guard is named', /shell — refused \(protected file\)/.test(lines), lines);
  check('the containment guard is named',
    /write_file — refused \(outside the workspace\)/.test(lines), lines);
  checkPageClean(p, 'refusal lines');
  await p.close();
}

// B. The reason is a word, never the argument.
{
  const p = await open(760);
  await showRun(p, [
    {
      type: 'tool-event',
      tool: 'shell',
      phase: 'refused',
      reason: 'secret',
      // A hostile record: the host never emits this, and the line must not
      // print it even if one did.
      args: { command: 'cat keystore.properties' },
    },
  ]);
  const lines = (await toolLines(p)).join('\n');
  check('the refusal line does not print the command',
    !lines.includes('keystore.properties') && !lines.includes('cat '), lines);
  checkPageClean(p, 'no argument leak');
  await p.close();
}

// C. A refusal does not disturb the ordinary phases around it.
{
  const p = await open(760);
  await showRun(p, [
    { type: 'tool-event', tool: 'read_file', phase: 'done', ok: true },
    { type: 'tool-event', tool: 'shell', phase: 'refused', reason: 'secret' },
    { type: 'tool-event', tool: 'grep', phase: 'done', ok: true },
  ]);
  const lines = (await toolLines(p)).join('\n');
  check('an allowed read still reads as done', /read_file — done/.test(lines), lines);
  check('the refusal sits between them, still named',
    /refused \(protected file\)/.test(lines), lines);
  checkPageClean(p, 'mixed phases');
  await p.close();
}

// D. The LIVE conversation shows a refusal as it happens (D49as).
//
// The gap this closes: a refusal reached the run's transcript view and never the
// chat the user was watching. The cause was not styling — the host bridge
// forwards a bus event only when it carries `args`, and the refusal event
// carried none, so the host was never told. These two blocks pin the host's
// message shape and the drawing of it, so a revert to an args-less event (which
// loop.test.ts guards from the other side) cannot pass unnoticed here either.
{
  const p = await open(760);
  await post(p, { type: 'tool', tool: 'shell', phase: 'refused', reason: 'secret' });
  await post(p, { type: 'tool', tool: 'write_file', phase: 'refused', reason: 'containment' });
  await p.waitForTimeout(160);
  const lines = (await guardLines(p)).join('\n');
  check('a refusal is drawn in the live conversation', lines.length > 0, lines);
  // D49ba: no tool identifier, no "guard", no bare "it". The line says what did
  // not happen and why, in the user's words.
  check('the live line says what did not happen, in plain words',
    /Plato did not run the command\. That file is protected\./.test(lines), lines);
  check('and the containment one names the other reason',
    /Plato did not run the write\. That path is outside the workspace\./.test(lines), lines);
  check('and neither prints an internal tool name',
    !/shell|write_file/.test(lines), lines);
  checkPageClean(p, 'live guard line');
  await p.close();
}

// E. A refusal breaks the tool chain instead of being folded into it.
//
// The chip merges a run of completed calls into one summary. A refused call did
// NOT run, so it must end the chain — otherwise "3 tools" would count one that
// the guard stopped, and the guard's line would sit under a summary it does not
// belong to.
{
  const p = await open(760);
  await post(p, { type: 'tool', tool: 'read_file', phase: 'done', ok: true });
  await post(p, { type: 'tool', tool: 'shell', phase: 'refused', reason: 'secret' });
  await post(p, { type: 'tool', tool: 'grep', phase: 'done', ok: true });
  await p.waitForTimeout(700);
  const guard = (await guardLines(p)).join('\n');
  const summary = await p.evaluate(() => [...document.querySelectorAll('.msg.tool-summary')]
    .map((e) => e.textContent).join('\n'));
  check('the refusal is still drawn between two allowed calls',
    /Plato did not run the command\. That file is protected\./.test(guard), guard);
  check('and the refused call is NOT counted among the tools that ran',
    !/3 tool calls/.test(summary), summary);
  checkPageClean(p, 'chain broken');
  await p.close();
}

// F. A reload says the same thing the live line said (D49as).
//
// One wording, two paths. A second rendering that described the refusal
// differently would mean the record depends on when you looked at it.
{
  const p = await open(760);
  await replay(p, [
    { k: 'msg', cls: 'you', who: 'You', text: 'do the thing' },
    { k: 'tool', tool: 'read_file', phase: 'done' },
    { k: 'tool', tool: 'shell', phase: 'refused', reason: 'secret' },
    { k: 'tool', tool: 'grep', phase: 'done' },
  ]);
  const guard = (await guardLines(p)).join('\n');
  check('a refusal survives a reload as its own line', guard.length > 0, guard);
  check('and it says what the live line said',
    /Plato did not run the command\. That file is protected\./.test(guard), guard);
  checkPageClean(p, 'reloaded guard line');
  await p.close();
}

console.log('');
await finish('refusal');
