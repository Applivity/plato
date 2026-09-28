/**
 * The driver: everything the harness knows about operating Plato's webview the
 * way a person does.
 *
 * It is deliberately dumb about assertions. It types, clicks and reads back
 * text — no test logic — so that a failure points at Plato rather than at the
 * harness's opinion of Plato. Two rules keep it honest:
 *
 *   1. **A run's end is decided by the transcript, not by the screen.** The
 *      host writes `run-completed` to ~/.plato/runs/… when a run really ends.
 *      Waiting on a DOM affordance would race the last render; waiting on the
 *      file means every DOM reading after it belongs to a finished run.
 *   2. **An unexpected approval card never blocks the run.** If a card appears
 *      when the case did not expect one, the driver records it and denies it,
 *      so the run finishes and the transcript can be judged. A harness that
 *      hangs on a surprise card reports nothing at all.
 *   3. **A question card never blocks the run either.** It is answered — the
 *      first option on each question, then Submit — even if the case declared no
 *      handler for it. A card that waits for an answer needs a person to give
 *      one, and not needing that person is the point of this file. An omission
 *      in a case must cost a wrong answer, never an indefinite wait.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { By, Key, until } from 'selenium-webdriver';

const SETTLE_MS = 400;
/** How long a run may take before the driver starts reporting what is on screen. */
const WATCH_AFTER_MS = 15000;
/** A run that asks more questions than this is looping; fail loudly rather than guess. */
const MAX_QUESTIONS = 20;

export class Field {
  constructor(driver, webview, { runsDir, shotsDir, log = console.log }) {
    this.driver = driver;
    this.webview = webview;
    this.runsDir = runsDir;
    this.shotsDir = shotsDir;
    this.log = log;
    /** Every card the driver saw, expected or not — the record of what it did. */
    this.cardsSeen = [];
    this.decisions = [];
    /** Set when a question card is actually handled — the check that had no teeth. */
    this.questionSeen = false;
    /** D49aw: set when a stuck card was actually detected and answered. */
    this.stuckSeen = false;
    this.lastWatch = null;
    this.watchLines = 0;
    /** The prompt of the run in progress, so `newChat` can prove the chat reset. */
    this.lastPrompt = null;
  }

  async enter(inFrame = true) {
    if (inFrame) await this.webview.switchToFrame();
  }

  async leave() {
    await this.webview.switchBack();
  }

  async shot(name) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(this.shotsDir, { recursive: true });
    const png = await this.driver.takeScreenshot();
    writeFileSync(join(this.shotsDir, `${name}.png`), png, 'base64');
    this.log(`  shot ${name}.png`);
  }

  /** Files in the runs dir right now — the baseline a run end is measured against. */
  transcripts() {
    try {
      return readdirSync(this.runsDir)
        .filter((n) => n.endsWith('.jsonl'))
        .map((n) => join(this.runsDir, n));
    } catch {
      return [];
    }
  }

  /**
   * Clears VS Code's notification toasts.
   *
   * They stack in the window's bottom-right corner — over the composer and over
   * the mode popover, which is wide because its rows carry an explanation. A
   * click that lands on one fails as "element click intercepted" and names the
   * WEBVIEW IFRAME, which blames entirely the wrong layer. The toasts live in
   * the workbench, so this steps out of the frame, clears them, and steps back.
   */
  async clearToasts() {
    const { NotificationsCenter } = await import('vscode-extension-tester');
    await this.webview.switchBack();
    try {
      await new NotificationsCenter().clearAllNotifications();
    } catch {
      // Nothing showing, or the center is unreachable — carry on either way.
    }
    await this.webview.switchToFrame();
  }

  /**
   * Clicks an element, falling back to a JS-dispatched click when an overlay is
   * in the way. A toast is not part of the app under test, so a click it
   * intercepts must never be reported as a Plato failure. The fallback is
   * deliberately narrow: it engages ONLY on "intercepted", never on a missing or
   * disabled element, so a real UI regression still fails the run honestly.
   */
  async clickElement(el) {
    try {
      await el.click();
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (!msg.includes('intercepted')) throw e;
      this.log('  a click was intercepted by an overlay — dispatching it directly');
      await this.driver.executeScript('arguments[0].click()', el);
    }
  }

  async openChat() {
    const { Workbench } = await import('vscode-extension-tester');
    await new Workbench().executeCommand('Plato: Open Chat');
    await this.driver.sleep(3000);
  }

  async newChat() {
    // D49az: start from a clean surface, whatever the previous case left behind.
    // See `settleUi` for the failing acceptance run that put this here.
    await this.settleUi();
    await this.clickElement(await this.driver.findElement(By.id('new')));
    await this.driver.sleep(700);
    // The host asks before it discards a conversation. That dialog is VS Code's
    // own modal, so it lives in the workbench DOM and NOT inside the webview
    // frame — the driver has to step out to answer it. An unanswered modal
    // blocks every later click with an error that names the iframe rather than
    // the dialog, so this is easy to misread as a webview problem.
    await this.webview.switchBack();
    const confirm = await this.driver.findElements(
      By.xpath("//div[contains(@class,'monaco-dialog-box')]//a[normalize-space(text())='New Chat']"),
    );
    if (confirm.length > 0) {
      await this.clickElement(confirm[0]);
      await this.driver.sleep(700);
    }
    await this.webview.switchToFrame();
    // A new chat that did NOT start is the most expensive silent failure in this
    // file. The host refuses "New Chat" while a run is active, so the next prompt
    // then lands in the PREVIOUS conversation — and its run, its transcript and
    // every assertion about it belong to the wrong case. Measured against a real
    // model: a case that overran its clock by fifteen seconds caused exactly this,
    // and the next case reported a 900-second hang for a run that never existed.
    if (this.lastPrompt !== null) {
      const text = await this.logText();
      if (text.includes(this.lastPrompt.slice(0, 30))) {
        throw new Error(
          'a new chat did not start — the previous conversation is still on screen, which means its run is still active',
        );
      }
    }
    this.lastPrompt = null;
  }

  /** Switches mode through the real picker, exactly as a user would. */
  async setMode(mode) {
    await this.clearToasts();
    await this.clickElement(await this.driver.findElement(By.id('modeBtn')));
    const row = await this.driver.wait(
      until.elementLocated(By.css(`.popover[data-trigger="modeBtn"] .mp-row[data-mode="${mode}"]`)),
      10000,
    );
    await this.clickElement(row);
    await this.driver.sleep(SETTLE_MS);
    const label = await this.driver.findElement(By.id('modeBtnLabel')).getText();
    if (label.trim() !== mode) throw new Error(`mode picker did not take: label reads "${label}"`);
    this.log(`  mode ${mode}`);
  }

  /**
   * D49at clause 4: switches orchestration (solo → duo) through the real chip,
   * exactly as a user would.
   *
   * The chip CYCLES rather than offering a menu, so this clicks until the label
   * reads what the case asked for and fails loudly if it never does — a silent
   * miss here would run the case solo and the observer clause would pass on a
   * run with no observer in it at all.
   */
  async setOrchestration(target) {
    const LABEL = { solo: 'Solo', duo: 'Duo', academy: 'Academy' };
    const wanted = LABEL[target];
    if (wanted === undefined) throw new Error(`unknown orchestration "${target}"`);
    const chipLabel = async () =>
      (await (await this.driver.findElement(By.id('orchChip'))).getText()).trim().toLowerCase();

    if ((await chipLabel()).includes(target)) {
      this.log(`  orchestration ${target}`);
      return;
    }

    // The chip is a DOOR, not a switch: it opens Settings → Orchestration, where
    // the three mode cards live. (An earlier version of this clicked the chip
    // repeatedly expecting it to cycle, which is why it never took.)
    await this.clearToasts();
    await this.clickElement(await this.driver.findElement(By.id('orchChip')));
    const CARD = By.xpath(
      `//div[contains(@class,'modes')]//div[contains(@class,'mcard')]` +
        `[.//div[contains(@class,'mtitle') and normalize-space(text())='${wanted}']]`,
    );

    // D49az: located-then-clicked is a RACE, and this is where it bit. The
    // Settings panel repaints as it settles, replacing the mode card's node
    // between the `wait` and the `click` — a StaleElementReferenceError that
    // reads as a missing card. So the locate and the click are retried together,
    // and only for a stale or un-clickable node: a card that is genuinely absent
    // still fails, and the chip label below is the real post-condition either
    // way. **Never let this loop be the thing that decides the mode took.**
    let clicked = false;
    for (let attempt = 0; attempt < 3 && !clicked; attempt += 1) {
      try {
        const card = await this.driver.wait(until.elementLocated(CARD), 10000);
        await this.driver.executeScript('arguments[0].scrollIntoView({block:"center"})', card);
        await this.driver.sleep(200);
        await card.click();
        clicked = true;
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (!/stale element|not clickable|not interactable|intercepted/i.test(msg)) throw e;
        this.log(`  the orchestration card was not clickable — retrying (${msg.split('\n')[0]})`);
        await this.driver.sleep(500);
      }
    }
    if (!clicked) throw new Error(`the ${wanted} card could not be clicked after 3 attempts`);
    await this.driver.sleep(SETTLE_MS);
    await this.clickElement(await this.driver.findElement(By.id('sback')));
    await this.driver.sleep(SETTLE_MS);

    // The post-condition, read from the product: the chip is the user's view of
    // which arrangement is active, so it is the only honest thing to assert. A
    // case that "set duo" and ran solo would pass the observer clause on a run
    // with no observer in it at all.
    const now = await chipLabel();
    if (!now.includes(target)) {
      throw new Error(`orchestration did not take: the chip reads "${now}", wanted ${target}`);
    }
    this.log(`  orchestration ${target}`);
  }

  /**
   * D49az: leave the window where the NEXT case needs it, whatever the last one
   * did.
   *
   * **This exists because a full acceptance run reported M4 as NOT met, and was
   * wrong.** Case 17 threw a `StaleElementReferenceError` inside
   * `setOrchestration` — the mode card was replaced by a repaint between being
   * located and being clicked — so its `#sback` click never ran and **Settings
   * was left open**. Settings is a full-surface panel in the webview, so it
   * covers the New Chat button, and cases 18, 19 and 20 each then failed at the
   * FIRST line of their bodies with `ElementNotInteractableError`. Three cases
   * that had never started were reported as failing.
   *
   * Two lessons, and both are older than this feature. The first is the file's
   * own: a fault reports as something else. The second is why the remedy is here
   * rather than in `clickElement`: that fallback fires ONLY on "intercepted" on
   * purpose, and swallowing "not interactable" would let a genuinely disabled
   * New Chat button pass as success. **Closing what a previous failure left open
   * is not hiding a failure** — this runs before anything a case asserts, and a
   * case's own checks still fail loudly on their own account.
   */
  async settleUi() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const back = await this.driver.findElements(By.id('sback'));
      if (back.length === 0 || !(await back[0].isDisplayed())) break;
      this.log('  a previous case left Settings open — closing it');
      // Its own race, the same one that caused this: the back button can go
      // stale between the look and the click. Two tries, then leave it to the
      // case to fail loudly on its own account rather than reporting it here.
      try {
        await this.clickElement(back[0]);
      } catch {
        continue;
      }
      await this.driver.sleep(SETTLE_MS);
    }
    // Popovers (the mode picker, the slash menu, the question card's tabs) sit
    // over the header too. The webview's own Escape handler closes any of them.
    await this.driver.executeScript(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    await this.driver.sleep(150);
  }

  /**
   * Sends a prompt. Returns the transcript files that were already on disk, so
   * `waitRunEnd` can identify the file this run creates.
   */
  async send(text) {
    const before = new Set(this.transcripts());
    await this.clearToasts();
    const box = await this.driver.findElement(By.id('q'));
    await box.clear();
    // Enter, not a click on the send button. Both work, but a VS Code
    // notification toast can sit over the bottom-right corner where the button
    // lives, and an intercepted click is a harness failure that looks like a
    // Plato failure. Enter is also what the placeholder tells a person to do.
    await box.sendKeys(text, Key.ENTER);
    this.lastPrompt = text;
    this.log(`  > ${text.slice(0, 70)}${text.length > 70 ? '…' : ''}`);
    return before;
  }

  /**
   * What kind of card is on screen right now — approval, question, or nothing.
   *
   * ONE lookup for both kinds, and that is the point rather than a tidy-up.
   * Approval cards were always found by reading `div.card h3` and matching the
   * heading; the question card was given a *second* lookup of its own, and that
   * one never matched once in three runs. The heading is set by the same call
   * that builds every card, so it is the one thing both kinds are certain to
   * share. Two paths meant one of them could be silently dead; there is now one.
   */
  async cardKind() {
    // D49aw: the stuck card is identified by its CLASS, not by its heading. The
    // heading is a sentence the product is free to reword ("Plato is repeating
    // itself", "5 turns in a row have failed"), and a check that breaks when the
    // wording improves would fail for exactly the wrong reason.
    //
    // `:not(.answered)` is load-bearing. An answered card STAYS on screen as the
    // record of what was asked, exactly as an approval card does — so without
    // this an already-answered question reads as a live one, and a case would
    // click it again or report the run as left hanging.
    if ((await this.driver.findElements(By.css('.card.stuck-card:not(.answered)'))).length > 0) {
      const h = await this.driver.findElement(By.css('.card.stuck-card h3'));
      return { kind: 'stuck', heading: (await h.getText()).trim() };
    }
    // D49ax: the undo offer, by class for the same reason — its heading is a
    // sentence the product is free to reword, and a check that breaks when the
    // wording improves fails for the wrong reason.
    if ((await this.driver.findElements(By.css('.card.undo-card:not(.answered)'))).length > 0) {
      const h = await this.driver.findElement(By.css('.card.undo-card h3'));
      return { kind: 'undo', heading: (await h.getText()).trim() };
    }
    for (const h of await this.driver.findElements(By.css('div.card h3'))) {
      const text = (await h.getText()).trim();
      if (/^Approve .+\?$/.test(text)) return { kind: 'approval', heading: text };
      if (/^Plato has (a question|a few questions)$/.test(text)) {
        return { kind: 'question', heading: text };
      }
    }
    return { kind: null, heading: '' };
  }

  /** An approval card, if one is open right now. Returns its heading text or null. */
  async openCard() {
    const { kind, heading } = await this.cardKind();
    return kind === 'approval' ? heading : null;
  }

  /** Is the model waiting on a question card right now? */
  async questionOpen() {
    return (await this.cardKind()).kind === 'question';
  }

  /** D49aw: is the run parked on the "Plato is repeating itself" card? */
  async stuckOpen() {
    return (await this.cardKind()).kind === 'stuck';
  }

  /**
   * D49aw: answers the stuck card the way a person does.
   *
   * Both buttons are located INSIDE `.stuck-card`, so this cannot accidentally
   * click an approval card's buttons — which in `edit` mode may be sitting in
   * the same conversation.
   */
  async answerStuck(which, guidance = '') {
    const label = which === 'stop' ? 'Stop' : 'Keep going';
    if (guidance.length > 0) {
      // Typed the way a person types it, into the card's own box.
      const box = await this.driver.findElement(By.css('.card.stuck-card .stuck-input'));
      await box.sendKeys(guidance);
    }
    const xpath =
      `//div[contains(@class,'stuck-card')]//button[normalize-space(text())='${label}']`;
    const btn = await this.driver.wait(until.elementLocated(By.xpath(xpath)), 15000);
    await this.clickElement(btn);
    this.log(`  answered the stuck card: ${label}${guidance ? ' with guidance' : ''}`);
    await this.driver.sleep(SETTLE_MS);
  }

  /** D49ax: is /undo offering to put files back right now? */
  async undoOpen() {
    return (await this.cardKind()).kind === 'undo';
  }

  /**
   * D49ax: the undo offer's own text, so a case can assert what it NAMES — the
   * files, and what it cannot put back. A card that says "3 files" and nothing
   * else is the cryptic draft the founder rejected.
   */
  async undoText() {
    const cards = await this.driver.findElements(By.css('.card.undo-card'));
    if (cards.length === 0) return '';
    return (await cards[cards.length - 1].getText()).trim();
  }

  /**
   * D49ax: answers the undo offer the way a person does — the button INSIDE
   * `.undo-card`, so this cannot click an approval card's button sitting in the
   * same conversation.
   */
  async answerUndo(which) {
    const label = which === 'cancel' ? 'Cancel' : 'Put these back';
    const xpath =
      `//div[contains(@class,'undo-card')]//button[normalize-space(text())='${label}']`;
    const btn = await this.driver.wait(until.elementLocated(By.xpath(xpath)), 15000);
    await this.clickElement(btn);
    this.log(`  answered the undo card: ${label}`);
    await this.driver.sleep(SETTLE_MS);
  }

  /**
   * Stops the run the way a person does — the Stop control in the composer.
   *
   * D49as: this is what case 10 exists for. The control is disabled unless a run
   * is active, so a disabled button is an ERROR here rather than a silent no-op:
   * a click on a disabled button does nothing, the run would keep going, and the
   * harness would report the hang instead of the reason for it. While a QUESTION
   * card is open the button must be enabled — that is the claim under test.
   */
  async cancel() {
    const btn = await this.driver.findElement(By.id('cx'));
    if ((await btn.getAttribute('disabled')) !== null) {
      throw new Error(
        'the Stop control is disabled while a run is active — the user has no way to stop it',
      );
    }
    await this.clickElement(btn);
    this.log('  cancelled the run');
    await this.driver.sleep(SETTLE_MS);
  }

  /** Clicks Allow once / Deny / Approve-all on the open card. */
  async decide(which) {
    const xpath =
      which === 'deny'
        ? "//button[normalize-space(text())='Deny']"
        : which === 'all'
          ? "//button[contains(text(),'this session')]"
          : "//button[normalize-space(text())='Allow once']";
    const btn = await this.driver.wait(until.elementLocated(By.xpath(xpath)), 15000);
    await this.clickElement(btn);
    await this.driver.sleep(SETTLE_MS);
    this.decisions.push(which);
    this.log(`  card -> ${which}`);
  }

  /**
   * Prints what is on screen, each time it CHANGES, while a run has stalled.
   *
   * Two things were learned the hard way here. First, the previous diagnostic
   * spoke only when it found *some* card, so "no card was ever drawn" and "the
   * diagnostic never ran" produced identical output: nothing at all. It says
   * "none" out loud now. Second, it speaks only after a run has been going a
   * while — a healthy case finishes in seconds, so a line here means something
   * is wrong, and printing on every poll would bury that in noise.
   */
  async watchForQuestion(started) {
    if (Date.now() - started < WATCH_AFTER_MS) return;
    const headings = await this.cardHeadings();
    const snapshot = headings.join(' | ');
    if (snapshot === this.lastWatch || this.watchLines >= 16) return;
    this.lastWatch = snapshot;
    this.watchLines += 1;
    this.log(`  watch: ${headings.length} card(s)${snapshot ? ` — ${snapshot}` : ' — none'}`);
  }

  /**
   * Waits for the run to finish and returns its transcript events.
   *
   * `plan` is the case's own expectation of what to do about approval cards:
   * `undefined` means no card is expected at all, so a card is a failure —
   * recorded, denied, and the run allowed to finish. An array means click those
   * decisions in that order, one per card.
   */
  async waitRunEnd(before, { plan = undefined, timeoutMs = 180000, tag = '', question = undefined, cancelOnQuestion = false, stuckStop = false, stuckGuidance = '' } = {}) {
    const started = Date.now();
    let step = 0;
    let finished = null;
    let answered = 0;
    let cancelled = false;
    let stuckCards = 0;
    this.questionSeen = false;
    this.stuckSeen = false;
    this.lastWatch = null;
    this.watchLines = 0;

    while (Date.now() - started < timeoutMs) {
      // A question card must NEVER leave the harness waiting — whether or not the
      // case declared one, and however many times the model asks. A run that stops
      // for an answer nobody gives needs a person sitting next to it, and removing
      // that person is the entire point of this file. An undeclared card is
      // answered here: the first option on each question, then Submit, so the run
      // finishes and its transcript can be judged. Same rule as an unexpected
      // approval card, which is denied rather than allowed to block.
      //
      // EVERY card, not just the first. An earlier version latched after one
      // answer, and a real run that asked a second question left that card sitting
      // on screen until the clock ran out — the very hang this rule exists to stop.
      if (finished === null) {
        await this.watchForQuestion(started);
        if (!cancelled && (await this.questionOpen())) {
          if (answered >= MAX_QUESTIONS) {
            throw new Error(`answered ${MAX_QUESTIONS} question cards in one run — that is a loop, not a conversation`);
          }
          answered += 1;
          this.questionSeen = true;
          if (cancelOnQuestion) {
            // D49as: the case under test. Stop is pressed WHILE the card is on
            // screen. Before the fix the handler unblocked a waiting approval and
            // never a waiting question, so pressing Stop did nothing and the only
            // way out was to answer a card belonging to a run the user had
            // already abandoned. `cancelled` guards the branch: if the card does
            // not go away, this must not re-enter and cancel forever — the
            // question must be answered or the run must end.
            this.log('  cancelling with the question card open');
            await this.cancel();
            cancelled = true;
          } else if (question !== undefined) {
            this.log('  question card is open');
            await question();
          } else {
            this.log('  UNEXPECTED question card — answering it so the run can finish');
            await this.answerAllQuestions({ picks: 1 });
          }
        }
      }
      // D49aw: the run stopped because it is repeating itself. An UNDECLARED one
      // is told to continue rather than left on screen — the rule every other
      // card here follows, and the reason is sharper for this one: a stuck card
      // nobody answers parks the run until the clock runs out, which is the hang
      // this whole harness exists to avoid. The cap stops a case that never
      // declared the card from being answered forever.
      if (finished === null && stuckCards < 5 && (await this.stuckOpen())) {
        stuckCards += 1;
        this.stuckSeen = true;
        if (stuckStop) {
          this.log('  the run is stuck — pressing Stop on the card');
          await this.answerStuck('stop');
        } else if (stuckGuidance.length > 0) {
          // The case under test: the user says keep going AND says what to do
          // differently, which is the fastest unstick there is.
          this.log('  the run is stuck — answering "keep going" with guidance');
          await this.answerStuck('continue', stuckGuidance);
        } else {
          this.log('  UNEXPECTED stuck card — telling it to continue so the run can finish');
          await this.answerStuck('continue');
        }
      }

      const isNew = this.transcripts().filter((f) => !before.has(f));
      for (const file of isNew) {
        let text = '';
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        if (text.includes('"run-completed"') || text.includes('"run-failed"')) {
          finished = file;
          break;
        }
      }

      if (finished === null) {
        const heading = await this.openCard();
        if (heading !== null) {
          const tool = heading.replace(/^Approve /, '').replace(/\?$/, '');
          // `plan: 'all'` approves every card. The real-model pass needs this: a
          // real agent doing real work asks for far more than a hand-written list
          // allows, and an exceeded list does not merely stop approving — it
          // DENIES, which reads to the model as the user refusing, sends it
          // re-planning, and turns a two-minute run into a fifteen-minute one.
          const wants = plan === 'all' || (Array.isArray(plan) && step < plan.length);
          this.cardsSeen.push({ tag, tool, expected: wants });
          if (wants) {
            await this.decide(plan === 'all' ? 'allow' : plan[step]);
            step += 1;
          } else {
            this.log(`  UNEXPECTED card: ${heading} — denying so the run can finish`);
            await this.decide('deny');
          }
        }
      } else {
        // The file is complete; give the DOM a beat to paint the last message.
        await this.driver.sleep(1200);
        break;
      }
      await this.driver.sleep(500);
    }

    if (finished === null) throw new Error(`run never completed within ${timeoutMs}ms (${tag})`);
    const events = readFileSync(finished, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    this.lastTranscript = finished;
    return events;
  }

  /** The whole chat log as text — the cheapest way to assert on what a human sees. */
  async logText() {
    return (await this.driver.findElement(By.id('log'))).getText();
  }

  /** Card headings currently in the log, in order. */
  async cardHeadings() {
    const out = [];
    for (const h of await this.driver.findElements(By.css('div.card h3'))) {
      out.push((await h.getText()).trim());
    }
    return out;
  }

  /**
   * The plan card's state.
   *
   * Counted WITHIN THE NEWEST CARD, not across the log, and that distinction is
   * the documented behaviour rather than a detail: a replan adds a SECOND card
   * instead of mutating the first, so a whole-log count legitimately finds one
   * in-progress step per card and reports two. The count that means anything is
   * the one in the card the user is currently looking at.
   */
  async planState() {
    const cards = await this.driver.findElements(By.css('.card.todo-card'));
    let inProgress = 0;
    let completed = 0;
    let totalInProgress = 0;
    let totalCompleted = 0;
    for (const card of cards) {
      totalInProgress += (await card.findElements(By.css('.todo-item.in_progress'))).length;
      totalCompleted += (await card.findElements(By.css('.todo-item.completed'))).length;
    }
    if (cards.length > 0) {
      const last = cards[cards.length - 1];
      inProgress = (await last.findElements(By.css('.todo-item.in_progress'))).length;
      completed = (await last.findElements(By.css('.todo-item.completed'))).length;
    }
    return { cards: cards.length, inProgress, completed, totalInProgress, totalCompleted };
  }

  /**
   * The question card's state: tabs, and whether options are boxes or circles.
   *
   * There is NO `<input>` anywhere in this card, and an earlier version of this
   * file assumed there was — so it clicked nothing, in both suites, while the
   * case still reported PASS. The card draws its own marks: `div.q-check` for a
   * multi-select question, `div.q-radio` for a single-answer one, inside a
   * `div.q-option` row that carries `selected` once picked.
   */
  async questionState() {
    const tabs = (await this.driver.findElements(By.css('.q-tab'))).length;
    const boxes = (await this.driver.findElements(By.css('.q-option .q-check'))).length;
    const circles = (await this.driver.findElements(By.css('.q-option .q-radio'))).length;
    const rows = (await this.driver.findElements(By.css('.q-option'))).length;
    return { tabs, boxes, circles, rows };
  }

  /**
   * Picks the first `n` options on the question now on screen. Returns how many
   * rows were actually clicked, so a caller can assert on it rather than assume
   * — the assumption is what went wrong before.
   */
  async tickOptions(n) {
    const rows = await this.driver.findElements(By.css('.q-option'));
    let clicked = 0;
    for (let i = 0; i < Math.min(n, rows.length); i += 1) {
      await this.clickElement(rows[i]);
      await this.driver.sleep(150);
      clicked += 1;
    }
    this.log(`  picked ${clicked} option(s) of ${rows.length} offered`);
    return clicked;
  }

  async goToTab(i) {
    const tabs = await this.driver.findElements(By.css('.q-tab'));
    if (tabs[i]) {
      await this.clickElement(tabs[i]);
      await this.driver.sleep(SETTLE_MS);
    }
  }

  /** The labels picked on the visible question — the state a round trip must preserve. */
  async checkedLabels() {
    const out = [];
    for (const row of await this.driver.findElements(By.css('.q-option.selected'))) {
      out.push((await row.getText()).trim());
    }
    return out;
  }

  /**
   * Closes the card, or refuses to pretend it did.
   *
   * "Submit answers" exists only on the LAST question and stays disabled until
   * that question has an answer. A click on a disabled button does nothing, and
   * a harness that does not check would leave the card open and report the run
   * as a hang — which is exactly what happened against the real model. So a
   * disabled button is an error here, with the reason in the message.
   */
  async submitAnswers() {
    const btn = await this.driver.wait(
      until.elementLocated(By.xpath("//button[contains(text(),'Submit answers')]")),
      10000,
    );
    if ((await btn.getAttribute('disabled')) !== null) {
      throw new Error('"Submit answers" is disabled — a question is unanswered, so this card can never close');
    }
    await this.clickElement(btn);
    await this.driver.sleep(SETTLE_MS);
  }

  /**
   * Answers every question on the card and submits it, the way a person does:
   * one pick per question, advancing to the last one, then Submit. A question
   * that already has a pick is left alone, so a caller can do its own
   * round-trip experiment first and then call this to finish.
   */
  async answerAllQuestions({ picks = 1 } = {}) {
    const tabs = (await this.driver.findElements(By.css('.q-tab'))).length;
    const count = Math.max(1, tabs);
    for (let i = 0; i < count; i += 1) {
      if (tabs > 0) await this.goToTab(i);
      const already = (await this.driver.findElements(By.css('.q-option.selected'))).length;
      if (already === 0) await this.tickOptions(picks);
    }
    await this.submitAnswers();
  }
}

/** Freshness check used by the runner when deciding a transcript is this run's. */
export function newestTranscript(dir, since) {
  let best = null;
  try {
    for (const n of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
      const p = join(dir, n);
      const m = statSync(p).mtimeMs;
      if (m >= since && (best === null || m > best.m)) best = { path: p, m };
    }
  } catch {
    /* no runs yet */
  }
  return best?.path ?? null;
}
