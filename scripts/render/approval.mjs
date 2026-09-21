import { check, page, S, finish, checkPageClean } from './plib.mjs';

/**
 * D49p: the approval card is where the user decides where Plato may go, so the
 * card has to say WHICH HOST the approval covers. "Approve all web_fetch" would
 * read as covering every future host — which is exactly what it must not do.
 */

// A. A host-scoped card names the host, not the tool.
{
  const p = await page(900, S());
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), {
    type: 'approval',
    tool: 'web_fetch',
    sessionKey: 'web_fetch:example.com',
    host: 'example.com',
    preview: 'This sends a request to:\n\n  https://example.com/a',
  });
  await p.waitForTimeout(250);

  const r = await p.evaluate(() => {
    const card = document.querySelector('.card:last-of-type') || document.body;
    const buttons = [...card.querySelectorAll('button')].map((b) => b.textContent);
    return { buttons, text: card.textContent };
  });
  check('the card offers three choices', r.buttons.length === 3, r.buttons);
  check('the session button names the HOST', /\bexample\.com\b/.test(r.buttons.join('|')), r.buttons);
  check('the session button does not offer the whole tool',
    !/Approve all web_fetch/.test(r.buttons.join('|')), r.buttons);
  check('the preview URL is visible on the card', r.text.includes('https://example.com/a'), r.text);
  checkPageClean(p, 'host card');
  await p.close();
}

// B. "Approve all" reports back the HOST-SCOPED key, so the shell cannot widen
//    it into a tool-wide approval.
{
  const p = await page(900, S());
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), {
    type: 'approval',
    tool: 'web_fetch',
    sessionKey: 'web_fetch:example.com',
    host: 'example.com',
    preview: 'preview',
  });
  await p.waitForTimeout(250);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.card button')]
      .find((x) => /Approve all/.test(x.textContent));
    b.click();
  });
  await p.waitForTimeout(120);
  const posted = await p.evaluate(() => window.__posted);
  const all = posted.find((m) => m.type === 'approve-all');
  check('approve-all sent the host-scoped sessionKey',
    all && all.sessionKey === 'web_fetch:example.com', posted);
  checkPageClean(p, 'approve-all');
  await p.close();
}

// C. A tool with no host still gets a card that names the TOOL — the host rule
//    must not leak into shell and write approvals.
{
  const p = await page(900, S());
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), {
    type: 'approval', tool: 'shell', preview: 'rm -rf build',
  });
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.card button')]
      .find((x) => /Approve all/.test(x.textContent));
    return b ? b.textContent : '';
  });
  check('a hostless card still names the tool', /shell/.test(r), r);
  checkPageClean(p, 'hostless card');
  await p.close();
}

// D. The address warning is rendered as visible text, not swallowed.
{
  const p = await page(900, S());
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), {
    type: 'approval',
    tool: 'web_fetch',
    sessionKey: 'web_fetch:169.254.169.254',
    host: '169.254.169.254',
    preview: 'This sends a request to:\n\n  http://169.254.169.254/latest/meta-data/'
      + '\n\nWARNING: 169.254.169.254 is the cloud metadata address, not a website.'
      + ' A request here can read this machine\'s cloud credentials.',
  });
  await p.waitForTimeout(250);
  const text = await p.evaluate(() =>
    (document.querySelector('.card:last-of-type') || document.body).textContent);
  check('the metadata warning reaches the user', /cloud metadata address/.test(text), text);
  checkPageClean(p, 'warning card');
  await p.close();
}

await finish('approval');
