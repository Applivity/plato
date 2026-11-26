/**
 * The park's note offer, and the footer's two-control rule, as they SHIP.
 *
 * `chatHtml()` is the page both hosts render — the VS Code webview and the
 * Visual Studio tool window — so what it contains is what the product draws.
 * These assertions read that page: the markup, the CSS and the script that the
 * page carries.
 *
 * They are structural, not behavioural. The behaviour in a real DOM — a click
 * landing in the textarea through the sentence, the composer taking the note,
 * Resume sitting beside Stop at a park — is driven by `scripts/render/*.mjs`
 * against this same HTML, which is Plato Core's suite and not this package's.
 * What this file guards is that the copy, the colour, the accessibility
 * wiring and the footer's state rules cannot drift without a test failing.
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The build under test is this package's own `out/webview.js`. The override
// exists so the same assertions can be pointed at an older build to show them
// failing there — a test that cannot be made to fail is not a witness.
const OUT = process.env['PLATO_WEBVIEW_OUT'] ?? join(HERE, '..', 'out', 'webview.js');
const { chatHtml } = createRequire(import.meta.url)(OUT);

const html = chatHtml();
const script = html.slice(html.indexOf('<script'));

/** The source of the nearest handler or function after `needle`. */
function around(needle, chars = 900) {
  const at = script.indexOf(needle);
  assert.ok(at >= 0, `the page no longer carries "${needle}"`);
  return script.slice(at, at + chars);
}

/* ------------------------------------------------------- the footer, not a bar */

assert.equal(
  html.includes('noteOffer'),
  false,
  'the note offer is not a footer button any more',
);

/* ---------------------------------------------------- the sentence in the box */

assert.match(
  html,
  /<div id="parkHint" class="park-hint" hidden><span aria-hidden="true">Tell Plato what to do differently — or <\/span><button id="parkHintUse" type="button"><\/button><span aria-hidden="true"> — then press Resume\.<\/span><\/div>/,
  'the sentence sits in the composer, with only the phrase between the dashes as a control',
);
assert.ok(
  html.indexOf('<textarea id="q"') < html.indexOf('id="parkHint"') &&
    html.indexOf('id="parkHint"') < html.indexOf('class="ring-wrap"'),
  'the sentence is drawn inside the composer box, over the textarea',
);
assert.match(
  html,
  /<span id="parkHintText" class="sr-only" hidden><\/span>/,
  'the full sentence has a screen-reader home',
);

// Only shown while the run is parked, the park carries a philosopher's name
// and note, and the box is empty.
const paint = around('function paintParkNote()', 1800);
assert.match(
  paint,
  /pauseParked && pauseNote !== '' && pauseNoteBy !== ''/,
  'a sentence needs a park, a note and the speaker',
);
assert.match(
  paint,
  /parkedWithNote && q\.value\.length === 0/,
  'and it cannot sit over text the person typed',
);
assert.match(
  paint,
  /"use " \+ pauseNoteBy \+ "'s note"/,
  'the phrase is the speaker\'s, in the sentence\'s own lower case',
);
assert.match(
  paint,
  /q\.placeholder = show\s*\?\s*''/,
  'the native placeholder is blank while the sentence shows',
);
assert.match(
  paint,
  /q\.setAttribute\('aria-describedby', 'parkHintText'\)/,
  'the textarea points at the sentence while it shows',
);
assert.match(
  paint,
  /q\.removeAttribute\('aria-describedby'\)/,
  'and stops pointing at it once it goes',
);
assert.match(
  paint,
  /pauseParked \? PARK_PLACEHOLDER/,
  'a park with no note keeps the plain park instruction',
);

// The phrase fills the box, and nothing is sent: Resume is the person's press.
const take = around("parkHintUse.addEventListener('click'");
assert.match(take, /q\.value = pauseNote;/, 'the click fills the composer');
assert.match(take, /q\.focus\(\);/, 'and focuses it');
assert.match(
  take,
  /q\.setSelectionRange\(q\.value\.length, q\.value\.length\)/,
  'with the caret after the last word',
);
assert.equal(
  take.includes('postMessage'),
  false,
  'and sends nothing — the run stays parked until Resume is pressed',
);

// The colour and the size are the whole point: the person has just read the
// philosopher's line in that violet, two rows above.
const hintCss = html.slice(
  html.indexOf('.park-hint {'),
  html.indexOf('.textarea-wrap.park-hint-on'),
);
assert.match(hintCss, /color:#b48ad4/, 'the phrase keeps the philosopher\'s violet');
assert.match(hintCss, /font-size:13px/, 'and the sentence\'s size');
assert.match(hintCss, /border:none/, 'with no border');
assert.match(hintCss, /background:none/, 'and no fill');
assert.match(
  hintCss,
  /max-width:100%/,
  'bounded by the box, so a long name cannot run past it',
);
assert.match(
  hintCss,
  /text-overflow:ellipsis/,
  'a name too long for the line is elided, not clipped',
);
assert.match(
  hintCss,
  /\.park-hint \{[^}]*pointer-events:none/,
  'the sentence lets clicks through to the textarea',
);
assert.match(
  hintCss,
  /\.park-hint button[^}]*pointer-events:auto/,
  'and the phrase is the one part that takes them',
);

/* ------------------------------------ hidden means gone, not merely unset */

// An author `display` rule outranks the user agent's [hidden] rule. `#go` is
// `.btn-send` (display:inline-flex), so hiding it by attribute left it on
// screen beside Pause and Stop — three controls where the footer allows two,
// seen in a real window while every test that read `el.hidden` passed.
assert.match(
  html,
  /#pp\[hidden\], #cx\[hidden\], \.run-btn\[hidden\] \{ display:none; \}/,
  'Stop and Pause disappear when hidden',
);
assert.match(
  html,
  /#go\[hidden\], \.btn-send\[hidden\] \{ display:none; \}/,
  'and so does the primary, whose own display rule would otherwise keep it up',
);
assert.match(
  html,
  /\.park-hint\[hidden\], \.park-hint button\[hidden\] \{ display:none; \}/,
  'and the park sentence',
);

/* ----------------------------------------------------- the footer's two controls */

const footer = around('function paintFooter()', 1600);
assert.match(footer, /pp\.hidden = !showPause;/, 'Pause is derived, not toggled');
assert.match(
  footer,
  /pp\.title = 'Pause after the current step — the run waits for Resume\.'/,
  'one pause tooltip, whatever the state',
);
assert.match(footer, /cx\.hidden = !busy;/, 'Stop is shown for every live run');
assert.match(
  footer,
  /cx\.title = 'End this run now — the conversation stays\.'/,
  'and says it ends the run rather than the conversation',
);
assert.match(
  footer,
  /goLabel\.textContent = pauseParked \? 'Resume' : 'Send';/,
  'the primary carries Resume at a park',
);
assert.match(
  footer,
  /go\.disabled = !busy && !hasText;/,
  'and is greyed only while idle with an empty box',
);
assert.match(
  footer,
  /goWrap\.title = !busy && !hasText \? 'Type something to send\.' : '';/,
  'the reason rides on the wrapper, where a disabled button can still show it',
);

// The pause click asks, and does nothing else: no cancel, no label claim.
const pauseClick = around("pp.addEventListener('click'");
assert.match(pauseClick, /pauseWanted = true;/, 'the click records the request');
assert.match(
  pauseClick,
  /vsapi\.postMessage\(\{ type: 'pause' \}\)/,
  'and sends it',
);
assert.equal(
  /type: 'resume'/.test(pauseClick),
  false,
  'clicking Pause can no longer cancel or release the request',
);

// Resume's click must not pass through ask(): ask() would send the words as
// guidance and the run would answer by staying parked.
const resume = around('function resumeRun()');
assert.match(
  resume,
  /vsapi\.postMessage\(note\.length > 0 \? \{ type: 'resume', note \} : \{ type: 'resume' \}\)/,
  'Resume carries the composer\'s words as the note',
);
assert.equal(
  /ask\(\)/.test(resume),
  false,
  'and never goes through ask()',
);
const primary = around("document.getElementById('go').addEventListener('click'");
assert.match(
  primary,
  /if \(pauseParked\) \{ resumeRun\(\); return; \}/,
  'the primary resumes at a park and sends otherwise',
);
