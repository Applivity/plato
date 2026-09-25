import { check, page, finish, checkPageClean } from './plib.mjs';

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

const toolLines = (p) => p.evaluate(() => [...document.querySelectorAll('.msg.tool')]
  .map((e) => e.textContent));

// A. Each guard names itself.
{
  const p = await page(760);
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
  const p = await page(760);
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
  const p = await page(760);
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

console.log('');
await finish('refusal');
