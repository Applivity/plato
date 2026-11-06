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
    /** D49bc: set when a reveal card was actually detected, and how many. */
    this.revealSeen = false;
    this.revealCards = 0;
    this.lastWatch = null;
    this.watchLines = 0;
    /** The prompt of the run in progress, so `newChat` can prove the chat reset. */
    this.lastPrompt = null;
    /**
     * Which webview the driver last entered — 'chat' (an editor tab) or
     * 'side' (the activity-bar view). `clearToasts` must leave a frame to reach
     * the workbench, and before this it always came back to an editor tab, so a
     * sidebar case silently sent its next prompt to the tab behind it.
     */
    this.frameTarget = null;
  }

  async enter(inFrame = true) {
    if (inFrame) await this.switchToChatFrame();
  }

  /**
   * Enter the chat webview. The tester's locator can find no iframe while a
   * panel is being rebuilt right after a close, even though the document has
   * one — so this falls back to the iframes the document itself reports, and
   * names what it saw if neither works.
   */
  async switchToChatFrame(timeoutMs = 15000) {
    // Prefer the iframe of the ACTIVE editor group. The tester's geometry picks
    // the first webview editor it knows about, which is the wrong conversation
    // once a second chat tab exists.
    try {
      await this.driver.switchTo().defaultContent();
    } catch {
      /* already at the top level */
    }
    const marked = await this.driver
      .executeScript(`
        document.querySelectorAll('iframe[data-plato-target]')
          .forEach((f) => f.removeAttribute('data-plato-target'));
        const group = document.querySelector('.editor-group-container.active');
        if (!group) return false;
        const r = group.getBoundingClientRect();
        // Chat tabs are stacked webview overlays with identical geometry, so
        // rectangles cannot tell them apart. The topmost element at the centre
        // of the active editor area IS the conversation on screen.
        let frame = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (frame && frame.tagName !== 'IFRAME') {
          frame = frame.closest ? frame.closest('iframe') : null;
        }
        if (!frame || frame.tagName !== 'IFRAME') {
          // Last resort: the last overlay in the document.
          const all = document.querySelectorAll('iframe');
          frame = all.length > 0 ? all[all.length - 1] : null;
        }
        if (!frame) return false;
        frame.setAttribute('data-plato-target', '1');
        return true;
      `)
      .catch(() => false);
    if (marked) {
      try {
        const target = await this.driver.findElement(
          By.css('iframe[data-plato-target="1"]'),
        );
        await this.driver.switchTo().frame(target);
        const active = await this.driver.findElements(By.id('active-frame'));
        if (active.length > 0) {
          await this.driver.switchTo().frame(active[0]);
          this.frameTarget = 'chat';
          return;
        }
        await this.driver.switchTo().defaultContent();
      } catch {
        try {
          await this.driver.switchTo().defaultContent();
        } catch {
          /* nothing to reset */
        }
      }
    }
    try {
      await this.webview.switchToFrame(3000);
      this.frameTarget = 'chat';
      return;
    } catch {
      this.log('  the tester could not enter the webview — trying the document fallback');
    }
    const deadline = Date.now() + timeoutMs;
    let seen = 0;
    while (Date.now() < deadline) {
      try {
        await this.driver.switchTo().defaultContent();
      } catch {
        /* already at the top level */
      }
      seen = await this.driver
        .executeScript('return document.querySelectorAll("iframe").length')
        .catch(() => 0);
      if (seen > 0) {
        // More than one chat tab means more than one iframe can be in the
        // document (a retained webview stays alive while hidden). The VISIBLE
        // one is the one to type into; a hidden copy would put this case's
        // prompt in the wrong conversation. Display state is the first filter,
        // area the tie-break.
        const frames = await this.driver.findElements(By.css('iframe'));
        const shown = [];
        for (const frame of frames) {
          try {
            if (await frame.isDisplayed()) shown.push(frame);
          } catch {
            /* a detached frame is not a candidate */
          }
        }
        const pool = shown.length > 0 ? shown : frames;
        let best = null;
        let bestArea = -1;
        for (const frame of pool) {
          try {
            const r = await frame.getRect();
            const area = r.width * r.height;
            if (area > bestArea) {
              best = frame;
              bestArea = area;
            }
          } catch {
            /* a detached frame is not a candidate */
          }
        }
        if (seen > 1) {
          this.log(`  ${seen} webview iframe(s) in the document, ${shown.length} displayed`);
        }
        if (best !== null) {
          try {
            await this.driver.switchTo().frame(best);
            const active = await this.driver.findElements(By.id('active-frame'));
            if (active.length > 0) {
              await this.driver.switchTo().frame(active[0]);
              this.frameTarget = 'chat';
              this.log('  entered the webview through the document fallback');
              return;
            }
            await this.driver.switchTo().defaultContent();
          } catch {
            try {
              await this.driver.switchTo().defaultContent();
            } catch {
              /* nothing to reset */
            }
          }
        }
      }
      await this.driver.sleep(250);
    }
    throw new Error(
      `no chat iframe appeared within ${timeoutMs}ms (iframes seen: ${seen})`,
    );
  }

  /**
   * Enters the activity-bar chat's frame.
   *
   * `switchToChatFrame` prefers the active EDITOR group, which is the right
   * chat when the conversation is a tab — but the sidebar lives in a different
   * part of the document, so entering it needs its own lookup.
   */
  async switchToSidebarFrame(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let seen = 0;
    while (Date.now() < deadline) {
      try {
        await this.driver.switchTo().defaultContent();
      } catch {
        /* already at the top level */
      }
      // The view's iframe is NOT a child of `.part.sidebar` in this build: the
      // webview is hosted outside the part tree. Geometry is the reliable
      // discriminator — the editor's own frame is the one INSIDE the editor
      // part, and a view's frame (sidebar or auxiliary bar) is outside it.
      seen = Number(
        await this.driver
          .executeScript(`
            document.querySelectorAll('iframe[data-plato-side]')
              .forEach((f) => f.removeAttribute('data-plato-side'));
            const editor = document.querySelector('.part.editor');
            if (!editor) return 0;
            const e = editor.getBoundingClientRect();
            const outside = [...document.querySelectorAll('iframe')].filter((f) => {
              const r = f.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return false;
              const inside =
                r.x >= e.x - 1 && r.x + r.width <= e.x + e.width + 1 &&
                r.y >= e.y - 1 && r.y + r.height <= e.y + e.height + 1;
              return !inside;
            });
            if (outside.length === 0) return 0;
            // The largest is the chat; a small one would be another view.
            outside.sort((a, b) => {
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              return ra.width * ra.height - rb.width * rb.height;
            });
            outside[outside.length - 1].setAttribute('data-plato-side', '1');
            return outside.length;
          `)
          .catch(() => 0),
      );
      if (seen > 0) {
        try {
          const frame = await this.driver.findElement(
            By.css('iframe[data-plato-side="1"]'),
          );
          await this.driver.switchTo().frame(frame);
          const active = await this.driver.findElements(By.id('active-frame'));
          if (active.length > 0) {
            await this.driver.switchTo().frame(active[0]);
          }
          // Both shapes are valid: some VS Code builds render the content one
          // frame down, and the caller's own composer check says which arrived.
          this.frameTarget = 'side';
          return;
        } catch {
          try {
            await this.driver.switchTo().defaultContent();
          } catch {
            /* nothing to reset */
          }
        }
      }
      await this.driver.sleep(250);
    }
    const diag = await this.driver
      .executeScript(`
        const parts = [...document.querySelectorAll('.part')].map((p) => ({
          cls: String(p.className),
          iframes: p.querySelectorAll('iframe').length,
        }));
        const all = [...document.querySelectorAll('iframe')].map((f) => {
          const r = f.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return { parts, all };
      `)
      .catch((e) => ({ error: String(e) }));
    throw new Error(
      `no sidebar chat iframe appeared within ${timeoutMs}ms (iframes seen: ${seen}; dom: ${JSON.stringify(diag)})`,
    );
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
    const back = this.frameTarget;
    await this.webview.switchBack();
    try {
      await new NotificationsCenter().clearAllNotifications();
    } catch {
      // Nothing showing, or the center is unreachable — carry on either way.
    }
    // Come back to the surface the driver was on. A sidebar case that
    // came back to an editor tab sent its next prompt to the tab behind it.
    if (back === 'side') {
      await this.switchToSidebarFrame();
    } else {
      await this.switchToChatFrame();
    }
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

  /** Whether an activity-bar container is the one on screen. */
  async viewSelected(name) {
    const { ActivityBar } = await import('vscode-extension-tester');
    const control = await new ActivityBar().getViewControl(name);
    if (!control) return false;
    const klass = String((await control.getAttribute('class')) ?? '');
    return klass.includes('checked');
  }

  /**
   * Shows the activity-bar chat by opening its container, the way the
   * activity-bar icon does. `openView` clicks only when the container is not
   * already the active one, and a trusted click is used — VS Code listens for
   * real mouse events on the activity bar, so a JS-dispatched click there is
   * ignored.
   */
  async openSidebarChat() {
    const { ActivityBar } = await import('vscode-extension-tester');
    await this.webview.switchBack();
    const control = await new ActivityBar().getViewControl('Plato');
    if (!control) throw new Error('the Plato view container is not in the activity bar');
    await control.openView();
    await this.driver.sleep(900);
    if (!(await this.viewSelected('Plato'))) {
      throw new Error('the Plato activity-bar view could not be shown');
    }
  }

  /**
   * Shows a different activity-bar container. Plato's view is now hidden — not
   * disposed — which is the state its conversation must survive.
   */
  async hideSidebarChat() {
    const { ActivityBar } = await import('vscode-extension-tester');
    await this.webview.switchBack();
    const control = await new ActivityBar().getViewControl('Explorer');
    if (!control) throw new Error('the Explorer view container is not in the activity bar');
    await control.openView();
    await this.driver.sleep(900);
    if (await this.viewSelected('Plato')) {
      throw new Error('the Plato activity-bar view did not hide');
    }
  }

  /**
   * Opens a new chat the way a person does — the Plato mark in the
   * editor's title bar.
   *
   * The command palette is NOT used first. With a webview editor active, the
   * tester's command prompt sends F1 to the active TAB, and that key can be
   * swallowed while the page repaints: the observed failure is a five-second
   * "Waiting until element is visible" inside the prompt, after which every
   * later case fails the same way. A click on the mark is the same command by
   * the real affordance, and it does not depend on keyboard focus. The command
   * remains the fallback for a window with no editor at all.
   */
  async startNewChat() {
    await this.webview.switchBack();
    // Prefer the ACTIVE group's mark. A split window has one action row per
    // group, and the first in document order is not necessarily the active
    // one.
    const clicked = await this.driver
      .executeScript(`
        const groups = [...document.querySelectorAll('.editor-group-container')];
        const active = groups.find((g) => g.classList.contains('active'));
        const pools = active ? [active] : groups;
        for (const pool of pools) {
          const a = [...pool.querySelectorAll('.editor-actions .action-label, .editorTitle .action-label, .editor-title .action-label')]
            .find((x) =>
              ((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || ''))
                .includes('Plato: New Chat'));
          if (a) { a.click(); return true; }
        }
        return false;
      `)
      .catch(() => false);
    if (clicked) {
      this.log('  new chat: clicked the Plato mark');
      return;
    }
    this.log('  new chat: no mark on screen — using the command');
    const { Workbench } = await import('vscode-extension-tester');
    await new Workbench().executeCommand('Plato: New Chat');
  }

  async newChat() {
    // D49az: start from a clean surface, whatever the previous case left behind.
    // See `settleUi` for the failing acceptance run that put this here.
    await this.settleUi();
    // The "+" inside the chat header is gone; the title-bar mark is how
    // a new conversation is opened. Remember which tab is left behind: the
    // suite wants one clean surface per case, so the old tab is closed
    // afterwards — close-and-open is exactly how the product says to clear a
    // conversation, and it keeps per-case isolation.
    await this.webview.switchBack();
    const oldLabel = await this.activeEditorLabel();
    await this.startNewChat();
    await this.driver.sleep(700);
    // A host without tabs asks before discarding a conversation. That dialog is
    // VS Code's own modal, so it lives in the workbench DOM and NOT inside the
    // webview frame — the driver has to step out to answer it.
    await this.webview.switchBack();
    if (oldLabel) await this.waitForActiveLabelChange(oldLabel);
    const confirm = await this.driver.findElements(
      By.xpath("//div[contains(@class,'monaco-dialog-box')]//a[normalize-space(text())='New Chat']"),
    );
    if (confirm.length > 0) {
      await this.clickElement(confirm[0]);
      await this.driver.sleep(700);
    }
    if (oldLabel) {
      try {
        await this.closeTabByLabel(oldLabel, { notActive: true });
      } catch (e) {
        this.log(`  the previous chat tab could not be closed (${String(e?.message ?? e)})`);
      }
    }
    await this.switchToChatFrame();
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

  /** D49cb: what the picker's label says — the view's account of the mode. */
  async modeLabel() {
    return (await this.driver.findElement(By.id('modeBtnLabel')).getText()).trim();
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
    // D49bc: the reveal card, by class for the same reason as the two above.
    if ((await this.driver.findElements(By.css('.card.reveal-card:not(.answered)'))).length > 0) {
      const h = await this.driver.findElement(By.css('.card.reveal-card h3'));
      return { kind: 'reveal', heading: (await h.getText()).trim() };
    }
    // D49ba: the approval card is found by its CLASS and its DATA, never by
    // parsing its heading. The heading is now a sentence core writes — "Let Plato
    // edit src/a.ts?" — and a harness that matched its words would fail the day
    // the copy improved, which is exactly what happened while the undo copy was
    // being rewritten. `data-tool` is there for the same reason: the card names
    // the tool as DATA and the user as a SITUATION, and only one of those is a
    // stable thing to assert on.
    const cards = await this.driver.findElements(By.css('.card.approval-card:not(.answered)'));
    if (cards.length > 0) {
      const h = await cards[0].findElement(By.css('h3'));
      return {
        kind: 'approval',
        heading: (await h.getText()).trim(),
        tool: (await cards[0].getAttribute('data-tool')) ?? '',
      };
    }
    for (const h of await this.driver.findElements(By.css('div.card h3'))) {
      const text = (await h.getText()).trim();
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

  /** The same, with the tool the card is about — read from the card's own data. */
  async openCardInfo() {
    const info = await this.cardKind();
    return info.kind === 'approval' ? info : null;
  }

  /** Is the model waiting on a question card right now? */
  async questionOpen() {
    return (await this.cardKind()).kind === 'question';
  }

  /** D49aw: is the run parked on the "Plato is repeating itself" card? */
  async stuckOpen() {
    return (await this.cardKind()).kind === 'stuck';
  }

  /** D49bc: is the run parked on the "show it in full" card? */
  async revealOpen() {
    return (await this.cardKind()).kind === 'reveal';
  }

  /** D49bc: the reveal card's own text, so a case can assert what it states. */
  async revealText() {
    const cards = await this.driver.findElements(By.css('.card.reveal-card'));
    if (cards.length === 0) return '';
    return (await cards[cards.length - 1].getText()).trim();
  }

  /**
   * D49bc: answers the reveal card the way a person does.
   *
   * Both buttons are located INSIDE `.card.reveal-card`, so this cannot click an
   * approval card's button sitting in the same conversation. The labels are
   * stable and say what they do — unlike the undo card's primary button, whose
   * label is built from the file list and would pin the harness to one wording.
   */
  async answerReveal(which) {
    const label = which === 'allow' ? 'Show it this session' : 'Cancel';
    const xpath =
      `//div[contains(@class,'reveal-card')]//button[normalize-space(text())='${label}']`;
    const btn = await this.driver.wait(until.elementLocated(By.xpath(xpath)), 15000);
    await this.clickElement(btn);
    this.log(`  answered the reveal card: ${label}`);
    await this.driver.sleep(SETTLE_MS);
  }

  /**
   * D49cb: the mode card that is waiting for an answer, or null.
   *
   * By CLASS and the `answered` marker, the rule every card here follows: the
   * heading is copy and a settled card stays on screen as the record.
   */
  async modeRequestState() {
    const cards = await this.driver.findElements(By.css('.card.mode-card'));
    for (const c of cards) {
      const cls = (await c.getAttribute('class')) || '';
      if (!/\banswered\b/.test(cls)) {
        return {
          mode: (await c.getAttribute('data-mode')) || '',
          text: (await c.getText()).trim(),
        };
      }
    }
    return null;
  }

  /**
   * D49cb: answers the mode card. The first button is the switch, the second is
   * staying — both are located INSIDE `.card.mode-card`, so this can never
   * click an approval card sitting in the same conversation.
   */
  async answerModeRequest(allow) {
    const cards = await this.driver.findElements(By.css('.card.mode-card'));
    for (const c of cards) {
      const cls = (await c.getAttribute('class')) || '';
      if (/\banswered\b/.test(cls)) continue;
      const buttons = await c.findElements(By.css('button'));
      const btn = allow ? buttons[0] : buttons[1];
      if (btn === undefined) throw new Error('the mode card has fewer than two answers');
      await this.clickElement(btn);
      this.log(`  answered the mode card: ${allow ? 'switch' : 'stay'}`);
      await this.driver.sleep(SETTLE_MS);
      return;
    }
    throw new Error('no live mode card to answer');
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
    // The PRIMARY button is found by POSITION, not by its words. Its label is
    // built by core and says what the click does — "Put back 2 files", "Delete
    // 1 file", "Put back 2, delete 1" — so matching a string here would pin the
    // harness to one wording and, worse, fail as "the button is missing" the
    // moment the copy improves. That is exactly what happened when the wording
    // was fixed: the case failed on a button that was on screen the whole time.
    //
    // Cancel and the narrower action ARE found by their words, because those two
    // are fixed: "Cancel", and "Only <file>".
    const btns = await this.driver.wait(
      async () => {
        const found = await this.driver.findElements(By.css('.card.undo-card button'));
        return found.length > 0 ? found : false;
      },
      15000,
    );
    let target;
    if (which === 'cancel') target = await this.buttonByText(btns, 'Cancel');
    else if (which === 'only') target = await this.buttonStartingWith(btns, 'Only ');
    else target = btns[0];
    if (target === undefined) {
      throw new Error(
        `no undo button matched "${which}" — the card reads: ${await this.undoText()}`,
      );
    }
    // Read the label BEFORE the click: answering removes the button from the
    // card and the log line, so reading it afterwards is a stale reference.
    const label = (await target.getText()).trim();
    await this.clickElement(target);
    this.log(`  answered the undo card: ${label}`);
    await this.driver.sleep(SETTLE_MS);
  }

  async buttonByText(btns, text) {
    for (const b of btns) {
      if ((await b.getText()).trim() === text) return b;
    }
    return undefined;
  }

  async buttonStartingWith(btns, prefix) {
    for (const b of btns) {
      if ((await b.getText()).trim().startsWith(prefix)) return b;
    }
    return undefined;
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

  /**
   * D49bm: reads the pause button as the user sees it, without clicking.
   *
   * The label is the whole point of the control: "Pausing…" means the request is
   * recorded and the run is still going, "Resume" means the run has actually
   * stopped. A test that only clicked would not be able to tell the two apart.
   */
  async pauseState() {
    const btn = await this.driver.findElement(By.id('pp'));
    return {
      hidden: (await btn.getAttribute('hidden')) !== null,
      label: (await btn.getText()).trim(),
      title: await btn.getAttribute('title'),
    };
  }

  /** Clicks Pause or Resume, whichever the button currently offers. */
  async pause() {
    const btn = await this.driver.findElement(By.id('pp'));
    await this.clickElement(btn);
    this.log('  clicked the pause control');
    return this.pauseState();
  }

  /**
   * Waits for a run to be in flight.
   *
   * `send` returns as soon as the prompt is typed, so anything that acts on a
   * RUNNING run has to wait for the run control to appear first. Clicking Pause
   * before that is a no-op — the handler ignores a click outside a run — and the
   * case would report a pause that was never asked for.
   */
  async waitForRunStart(timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const st = await this.pauseState();
        if (!st.hidden) return st;
      } catch {
        // The frame can lag the click that opened the run; keep waiting.
      }
      await this.driver.sleep(200);
    }
    throw new Error(
      `no run started within ${timeoutMs}ms — the run control never appeared, so nothing could be tested`,
    );
  }

  /**
   * Waits for the pause button to reach a label, and returns whatever it holds
   * when the wait runs out — so the caller can report what it actually saw
   * rather than a timeout with no state in it.
   */
  async waitForPauseLabel(want, timeoutMs = 20000) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = await this.pauseState();
      if (last.label === want) return last;
      await this.driver.sleep(200);
    }
    return last;
  }

  /**
   * D49bo: types '/queue <message>' and presses Enter — the typed path, which
   * is the one a user reaches for. The command menu is open by then (the '/'
   * opened it), so this also exercises Enter running the highlighted row.
   */
  async queueMessage(text) {
    const q = await this.driver.findElement(By.id('q'));
    await q.click();
    await q.sendKeys('/queue ' + text);
    await this.driver.sleep(250);
    await q.sendKeys(Key.ENTER);
    await this.driver.sleep(SETTLE_MS);
    this.log('  queued: ' + text);
  }

  /** The queue row, as drawn. Empty `names` means the row is hidden. */
  async queueState() {
    const row = await this.driver.findElement(By.id('queueRow'));
    const hidden = (await row.getAttribute('hidden')) !== null;
    if (hidden) return { hidden: true, names: [], start: false };
    const names = await this.driver.executeScript(
      'return [...arguments[0].querySelectorAll(".ac-name")].map((e) => e.textContent);',
      row,
    );
    const starts = await this.driver.findElements(By.css('#queueRow .queue-start'));
    return { hidden: false, names: names, start: starts.length > 0 };
  }

  /** Clicks the × on a queued message, 0-based. */
  async queueRemove(i) {
    const boxes = await this.driver.findElements(By.css('#queueRow .ac-x'));
    if (boxes.length <= i) {
      throw new Error(`asked to remove queued message ${i} of ${boxes.length}`);
    }
    await this.clickElement(boxes[i]);
    await this.driver.sleep(SETTLE_MS);
    this.log(`  removed queued message ${i + 1}`);
  }

  /** Clicks Start, which is the only way a HELD queue continues. */
  async queueStart() {
    const btn = await this.driver.wait(
      until.elementLocated(By.css('#queueRow .queue-start')), 10000);
    await this.clickElement(btn);
    await this.driver.sleep(SETTLE_MS);
    this.log('  started the held queue');
  }

  /** Types into the composer without sending — the queue command reads it. */
  async type(text) {
    const q = await this.driver.findElement(By.id('q'));
    await q.click();
    await q.sendKeys(text);
    await this.driver.sleep(200);
  }

  /**
   * D49bn: closes the chat panel the way a user does — the × on its tab.
   *
   * The tab lives in the workbench, not inside the webview frame, so the driver
   * has to step out first and back in afterwards, exactly as `newChat` does for
   * VS Code's own modal.
   */
  async closeChat() {
    await this.webview.switchBack();
    this.log('  closing the chat panel');
    // The tab's own close button, clicked in the workbench DOM.
    //
    // Two other routes were tried and both failed in a FULL-suite run while
    // working in isolation. `EditorView.closeEditor('Plato Chat')` left the panel
    // open once the earlier cases' editors had crowded the tab bar, because the
    // tab is then behind the overflow control. And the command palette —
    // `executeCommand('workbench.action.closeActiveEditor')` — never became
    // visible at all that late in a run, timing out after five seconds. A direct
    // click on the tab's close button needs neither the tab to be visible nor the
    // palette to open.
    //
    // Still verified, because a click that misses would let the case pass for the
    // wrong reason: the caller asserts the RUN ended as cancelled, which a close
    // that did nothing cannot produce. The falsification in DECISIONS shows
    // exactly that failure.
    // The ACTIVE tab is the one to close: the driver was just inside its
    // frame. With tabs, several conversations can carry the same label, so a
    // label is no longer an identity.
    const result = await this.driver.executeScript(`
      const tabs = Array.from(document.querySelectorAll('.tab, .tabs-container .tab'));
      const tab = tabs.find((t) => t.classList.contains('active'));
      if (!tab) return 'no-active-tab:' + tabs.length;
      const btn = tab.querySelector('.tab-actions-right .action-label')
        || tab.querySelector('.close-action')
        || tab.querySelector('.codicon-close')
        || tab.querySelector('[title="Close"]');
      if (!btn) return 'no-close-button';
      btn.click();
      return 'clicked';
    `);
    if (result !== 'clicked') {
      throw new Error(`the active chat tab could not be closed (${result})`);
    }
    await this.driver.sleep(1500);
    this.log('  closed the chat panel');
  }

  /**
   * Marks the webview iframes that are in the document now, so a tab switch
   * can wait for the old document to go before entering a frame. Called at the
   * top level, around an action that changes the active tab.
   */
  async markCurrentFrames() {
    await this.driver.executeScript(`
      document.querySelectorAll('iframe').forEach((f) => f.setAttribute('data-plato-stale', '1'));
    `);
  }

  /** Waits until every iframe marked by `markCurrentFrames` is gone. */
  async waitForStaleFramesGone(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const left = await this.driver.executeScript(
        "return document.querySelectorAll('iframe[data-plato-stale]').length",
      );
      if (left === 0) return true;
      await this.driver.sleep(200);
    }
    this.log('  the previous webview document was still in the DOM after a tab switch');
    return false;
  }

  /** The label of the editor tab that is active in the workbench. */
  async activeEditorLabel() {
    const raw = await this.driver.executeScript(`
      const t = document.querySelector('.tab.active, .tabs-container .tab.active');
      if (!t) return '';
      return (t.getAttribute('aria-label')
        || (t.querySelector('.label-name') && t.querySelector('.label-name').textContent)
        || t.textContent || '').trim();
    `);
    // VS Code's accessibility label appends the group ("…, Editor Group 1");
    // the tab's visible title does not, and a label with the suffix matches no
    // tab.
    return String(raw)
      .replace(/,\s*Editor Group[^,]*$/i, '')
      .trim();
  }

  /** Waits until the active editor is no longer `from`. Top level only. */
  async waitForActiveLabelChange(from, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const now = await this.activeEditorLabel();
      if (now.length > 0 && now !== from) return now;
      await this.driver.sleep(200);
    }
    return '';
  }

  /**
   * Activates a workbench tab by its label. `notActive` picks the copy that is
   * NOT on screen — how two tabs sharing a label are told apart.
   * Leaves the driver at top level; the caller enters the frame.
   */
  async activateTabByLabel(label, { notActive = false } = {}) {
    // Prefer the page object's own openEditor: it drives the workbench the way
    // VS Code expects, where a synthetic click on the tab label can be a no-op.
    // The label must be unique — the scripted title now derives from the
    // prompt, so two open conversations do not share one.
    await this.markCurrentFrames();
    try {
      const { EditorView } = await import('vscode-extension-tester');
      await new EditorView().openEditor(label);
      await this.driver.sleep(900);
      const active = await this.activeEditorLabel();
      if (active.includes(label)) {
        await this.waitForStaleFramesGone();
        return;
      }
    } catch {
      // Fall through to the direct click and the verdict below.
    }
    // Click the tab's own label, not the tab chrome, and return the tab's
    // position so the activation can be VERIFIED. Clicking the wrong copy of
    // two identically labelled tabs leaves the run where it was, and the send
    // that follows then lands in the wrong conversation — silently.
    const idx = await this.driver.executeScript(
      `
      const want = arguments[0]; const skipActive = arguments[1];
      const tabs = Array.from(document.querySelectorAll('.tab, .tabs-container .tab'));
      const match = tabs.filter((t) =>
        ((t.getAttribute('aria-label') || '') + ' ' + (t.textContent || '')).includes(want));
      const target = skipActive ? match.find((t) => !t.classList.contains('active')) : match[0];
      if (!target) return -1;
      const at = tabs.indexOf(target);
      (target.querySelector('.label-name') || target).click();
      return at;
    `,
      label,
      notActive,
    );
    if (idx < 0) {
      throw new Error(`no editor tab matching "${label}" could be activated`);
    }
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const active = await this.driver.executeScript(
        `
        const tabs = Array.from(document.querySelectorAll('.tab, .tabs-container .tab'));
        return tabs.findIndex((t) => t.classList.contains('active'));
      `,
      );
      if (active === idx) {
        await this.driver.sleep(900);
        await this.waitForStaleFramesGone();
        return;
      }
      if (attempt === 5) {
        // One more try on the tab element itself; some layouts do not take the
        // click on the label.
        await this.driver.executeScript(
          `
          const tabs = Array.from(document.querySelectorAll('.tab, .tabs-container .tab'));
          const want = arguments[0]; const skipActive = arguments[1];
          const match = tabs.filter((t) =>
            ((t.getAttribute('aria-label') || '') + ' ' + (t.textContent || '')).includes(want));
          const target = skipActive ? match.find((t) => !t.classList.contains('active')) : match[0];
          if (target) target.click();
        `,
          label,
          notActive,
        );
      }
      await this.driver.sleep(200);
    }
    throw new Error(`the tab matching "${label}" did not become active`);
  }

  /** Closes a workbench tab by label. Top level only. */
  async closeTabByLabel(label, { notActive = false } = {}) {
    const result = await this.driver.executeScript(
      `
      const want = arguments[0]; const skipActive = arguments[1];
      const tabs = Array.from(document.querySelectorAll('.tab, .tabs-container .tab'));
      const match = tabs.filter((t) =>
        ((t.getAttribute('aria-label') || '') + ' ' + (t.textContent || '')).includes(want));
      const target = skipActive ? match.find((t) => !t.classList.contains('active')) : match[0];
      if (!target) return 'no-tab';
      const btn = target.querySelector('.tab-actions-right .action-label')
        || target.querySelector('.close-action')
        || target.querySelector('.codicon-close')
        || target.querySelector('[title="Close"]');
      if (!btn) return 'no-close-button';
      btn.click();
      return 'clicked';
    `,
      label,
      notActive,
    );
    if (result !== 'clicked') {
      throw new Error(`the tab matching "${label}" could not be closed (${result})`);
    }
    await this.driver.sleep(1500);
  }

  /**
   * A new conversation opens in ANOTHER tab and leaves this one open. Returns
   * the label of the tab that was left behind. Leaves the driver at top level;
   * the caller enters the new frame.
   */
  async openNewTab() {
    await this.webview.switchBack();
    const oldLabel = await this.activeEditorLabel();
    // A toast can sit over the title bar's action area too; clear it first.
    await this.clearToasts();
    // The old conversation's iframe can still be the only iframe in the
    // document for a moment after the new tab opens; entering it would type
    // into the wrong conversation. Mark it and wait for it to go.
    await this.webview.switchBack();
    await this.markCurrentFrames();
    // The header's "+" is gone; the title-bar mark is the control.
    await this.startNewChat();
    await this.driver.sleep(1200);
    await this.webview.switchBack();
    if (oldLabel) await this.waitForActiveLabelChange(oldLabel);
    await this.waitForStaleFramesGone();
    // The only iframe may still be the previous conversation for a moment.
    // A new tab is empty, so wait until the frame on screen is — otherwise the
    // next prompt lands in the old conversation and starts the wrong run.
    await this.waitForEmptyChat();
    return oldLabel;
  }

  /** Enters the chat frame repeatedly until the visible conversation is empty. */
  async waitForEmptyChat(timeoutMs = 15000) {
    const started = Date.now();
    let diagDone = false;
    while (Date.now() - started < timeoutMs) {
      await this.switchToChatFrame();
      const seen = await this.driver
        .executeScript(
          "const l = document.getElementById('log'); return l ? l.children.length : -1;",
        )
        .catch(() => -1);
      if (seen === 0) return true;
      await this.webview.switchBack();
      if (!diagDone) {
        diagDone = true;
        await this.driver.sleep(1000);
        const diag = await this.driver
          .executeScript(`
            const active = document.querySelector('.tab.active');
            const groups = Array.from(document.querySelectorAll('.editor-group-container')).map((g) => {
              const r = g.getBoundingClientRect();
              return { cls: g.className, w: Math.round(r.width), h: Math.round(r.height),
                       active: g.classList.contains('active'),
                       iframes: Array.from(g.querySelectorAll('iframe')).map((f) => {
                         const fr = f.getBoundingClientRect();
                         return { x: Math.round(fr.x), y: Math.round(fr.y),
                                  w: Math.round(fr.width), h: Math.round(fr.height),
                                  cls: f.className,
                                  parent: f.parentElement ? f.parentElement.className : '',
                                  grand: f.parentElement && f.parentElement.parentElement
                                    ? f.parentElement.parentElement.className : '' };
                       }) };
            });
            const groupRect = (() => {
              const g = document.querySelector('.editor-group-container.active');
              if (!g) return null;
              const r = g.getBoundingClientRect();
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            })();
            const frames = Array.from(document.querySelectorAll('iframe')).map((f) => {
              const fr = f.getBoundingClientRect();
              const chain = [];
              let el = f;
              for (let i = 0; i < 4 && el; i += 1) {
                chain.push(el.className || el.tagName);
                el = el.parentElement;
              }
              return { x: Math.round(fr.x), y: Math.round(fr.y), w: Math.round(fr.width),
                       h: Math.round(fr.height),
                       vis: f.checkVisibility ? f.checkVisibility() : null, chain };
            });
            return { tab: active ? (active.getAttribute('aria-label') || active.textContent || '').trim() : null,
                     tabCls: active ? active.className : null,
                     groupRect,
                     all: frames.length, frames };
          `)
          .catch((e) => ({ error: String(e.message ?? e) }));
        this.log(`  DIAG after new tab: ${JSON.stringify(diag)}`);
      }
      await this.driver.sleep(300);
    }
    throw new Error(
      `the new tab did not show an empty conversation within ${timeoutMs}ms`,
    );
  }

  /** Parses one transcript file into its events. */
  readRun(file) {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e) => e !== null);
  }

  /** Transcripts of runs that started after `before`, once there are `want`. */
  async waitForNewRuns(before, want, timeoutMs = 60000) {
    const started = Date.now();
    let fresh = [];
    while (Date.now() - started < timeoutMs) {
      fresh = this.transcripts().filter((f) => !before.has(f));
      if (fresh.length >= want) return fresh;
      await this.driver.sleep(250);
    }
    throw new Error(
      `only ${fresh.length} of ${want} new runs appeared within ${timeoutMs}ms`,
    );
  }

  /** One transcript's events, once it carries an ending. */
  async waitRunTerminal(file, timeoutMs = 180000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const events = this.readRun(file);
      if (
        events.some(
          (e) => e.type === 'run-completed' || e.type === 'run-failed',
        )
      ) {
        return events;
      }
      await this.driver.sleep(300);
    }
    throw new Error(`the run in ${file} did not end within ${timeoutMs}ms`);
  }

  /**
   * D49bn: opens the chat again and steps back inside its frame.
   *
   * The panel is built from scratch, so its iframe arrives later than a fixed
   * sleep allows — measured at over five seconds in a full-suite run, where the
   * window still had the earlier cases' editors to restore. Retried rather than
   * guessed at, and a failure names what it was waiting for.
   */
  async reopenChat() {
    const { EditorView, Workbench } = await import('vscode-extension-tester');
    const view = new EditorView();
    await new Workbench().executeCommand('Plato: Open Chat');
    let titles = [];
    for (let i = 0; i < 5; i += 1) {
      await this.driver.sleep(1000);
      // Back to the workbench first, EVERY pass: the panel was closed while the
      // driver was inside its iframe, and a lookup made from a dead frame context
      // fails for a reason that has nothing to do with whether the panel exists.
      try {
        await this.webview.switchBack();
      } catch {
        /* already at the top level */
      }
      try {
        titles = await view.getOpenEditorTitles();
      } catch {
        titles = [];
      }
      const title = titles.find((t) => /plato/i.test(t));
      if (title !== undefined) {
        // Bring the tab to the front BEFORE looking for its iframe. A webview
        // panel that is not the visible tab has no iframe in the DOM, so the
        // lookup fails with a message about the VS Code version that has nothing
        // to do with what went wrong.
        try {
          await view.openEditor(title);
          await this.driver.sleep(1000);
        } catch {
          /* it may already be the active tab */
        }
        await this.switchToChatFrame();
        await this.driver.sleep(400);
        this.log('  reopened the chat panel');
        return;
      }
    }
    throw new Error(
      `the chat panel did not come back within 15s — open editors: ${titles.join(', ') || 'none'}`,
    );
  }

  /**
   * D49bo: waits for `want` NEW runs to finish on their own.
   *
   * The queue advances by itself, so nothing the spec does starts the second
   * run — it has to be waited for. A run counts as finished only when its
   * transcript carries an ending, because the file appears when the run STARTS.
   */
  async waitForRunsDone(before, want, timeoutMs = 60000) {
    const started = Date.now();
    const freshDone = () => {
      const fresh = this.transcripts().filter((f) => !before.has(f));
      const done = fresh.filter((f) => {
        try {
          const t = readFileSync(f, 'utf8');
          return t.includes('"run-completed"') || t.includes('"run-failed"');
        } catch {
          return false;
        }
      });
      return { fresh, done };
    };
    while (Date.now() - started < timeoutMs) {
      if (freshDone().done.length >= want) {
        await this.driver.sleep(900);
        return freshDone();
      }
      await this.driver.sleep(400);
    }
    return freshDone();
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
  async waitRunEnd(before, { plan = undefined, timeoutMs = 180000, tag = '', question = undefined, cancelOnQuestion = false, stuckStop = false, stuckGuidance = '', revealAnswer = undefined, modeAnswers = undefined, during = undefined } = {}) {
    const started = Date.now();
    let step = 0;
    let didDuring = false;
    let finished = null;
    let answered = 0;
    let cancelled = false;
    let stuckCards = 0;
    let revealCards = 0;
    this.questionSeen = false;
    this.stuckSeen = false;
    this.revealSeen = false;
    this.modeRequests = [];
    this.lastWatch = null;
    this.watchLines = 0;

    while (Date.now() - started < timeoutMs) {
      // D49bm/D49bo: the ONE moment a case gets to act on a run that is still in
      // flight — clicking Pause, queueing a follow-up, pressing Stop. It runs
      // once, on the first pass, while the model is still thinking. A case that
      // needs it must give the stub a `delayMs`, or the run is over before this
      // line runs at all.
      if (finished === null && !didDuring) {
        didDuring = true;
        if (during !== undefined) await during();
      }
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

      // D49cb: the model asked for a mode and the card is waiting. A declared
      // case answers it; an UNDECLARED one is told to stay, which is the safe
      // answer and the one that lets the run finish — the rule every other card
      // here follows, and the reason the run never parks until the clock runs out.
      const asked = finished === null ? await this.modeRequestState() : null;
      if (asked !== null) {
        const want = Array.isArray(modeAnswers) ? modeAnswers[this.modeRequests.length] : undefined;
        this.modeRequests.push({ tag, mode: asked.mode, answer: want === 'allow' ? 'allow' : 'deny' });
        if (want === 'allow' || want === 'deny') {
          this.log(`  mode card -> ${want} (${asked.mode})`);
        } else {
          this.log(`  UNEXPECTED mode card for ${asked.mode} — staying so the run can finish`);
        }
        await this.answerModeRequest(want === 'allow');
      }

      // D49bc: the run is parked on a protected file Plato cannot mask. A
      // declared case answers it the way a person would; an UNDECLARED one is
      // told NO, which is the safe answer and the one that lets the run finish —
      // the same rule every other card here follows, and for the same reason: a
      // card nobody answers parks the run until the clock runs out.
      if (finished === null && revealCards < 5 && (await this.revealOpen())) {
        revealCards += 1;
        this.revealSeen = true;
        if (revealAnswer === 'allow' || revealAnswer === 'deny') {
          this.log(`  the reveal card is up — answering "${revealAnswer}"`);
          await this.answerReveal(revealAnswer);
        } else {
          this.log('  UNEXPECTED reveal card — declining so the run can finish');
          await this.answerReveal('deny');
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
        const open = await this.openCardInfo();
        if (open !== null) {
          const tool = open.tool;
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

    this.revealCards = revealCards;
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

  /**
   * D49bt: open the Settings page by clicking the gear, the way a person does.
   *
   * The gear posts `openSettings`, the host answers with a full `settings`
   * payload, and the view adds `show-settings` to the body. Nothing here reaches
   * into the host: if the gear stopped working, or the payload failed to build,
   * the wait below would time out rather than a check quietly passing.
   */
  async openSettings(timeoutMs = 20000) {
    await this.clickElement(await this.driver.findElement(By.id('gear')));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const shown = await this.driver.executeScript(
        'return document.body.classList.contains("show-settings");',
      );
      if (shown) {
        // The sections are built synchronously by showSettings, but the MCP
        // section is appended late in that function — so wait for IT rather than
        // for the page, or a read can race the section it is looking for.
        const ready = await this.driver.executeScript(
          'return !!document.querySelector(\'#sbody .sec[data-sec="mcp"]\');',
        );
        if (ready) return true;
      }
      await this.driver.sleep(200);
    }
    return false;
  }

  /**
   * Open the MCP section the way a person would, by clicking its header.
   *
   * The sections start collapsed, and a `<details>` keeps its children in the DOM
   * whether or not they are drawn — so a read passes against a section nobody can
   * actually see. Opening it is what makes the screenshot evidence rather than
   * decoration, and it is the same click a user makes.
   */
  async expandMcpSection() {
    await this.driver.executeScript(`
      const sec = [...document.querySelectorAll('#sbody .sec')]
        .find((s) => s.getAttribute('data-sec') === 'mcp');
      if (sec && sec.tagName === 'DETAILS') sec.open = true;
    `);
    await this.driver.sleep(300);
  }

  /**
   * Press "Open mcp.json" in the MCP section, the way a user would.
   *
   * The host answers by calling `showTextDocument` on `~/.plato/mcp.json`, which
   * is also the only reliable way to get that file open from here: the quick-open
   * box would not take scripted keystrokes, and it is the product's own path
   * anyway — so pressing it tests the button as well as opening the file.
   */
  async clickMcpOpen() {
    await this.driver.executeScript(`
      const sec = [...document.querySelectorAll('#sbody .sec')]
        .find((s) => s.getAttribute('data-sec') === 'mcp');
      const btn = [...sec.querySelectorAll('.dhead button')]
        .find((b) => b.textContent === 'Open mcp.json');
      if (btn) btn.click();
    `);
    await this.driver.sleep(2500);
  }

  /** Back to the chat. The host is not told (it ignores `settings-closed`). */
  async closeSettings() {
    await this.clickElement(await this.driver.findElement(By.id('sback')));
    await this.driver.sleep(400);
  }

  /**
   * D49bz: the switch's hover hint, captured as a person sees it. The copy is
   * the thing being checked — a tooltip nobody can read is the defect this
   * answers.
   */
  async shotSettingsHint(name = 'settings-others-hint') {
    await this.openSettings();
    await this.driver.executeScript(`
      const sec = document.querySelector('.sec[data-sec="others"]');
      if (sec) sec.open = true;
    `);
    await this.driver.sleep(200);
    const help = await this.driver.findElement(
      By.css('.sec[data-sec="others"] .help'),
    );
    await this.driver.actions().move({ origin: help }).perform();
    await this.driver.sleep(500);
    await this.shot(name);
    await this.driver.actions().move({ origin: help, x: 0, y: 200 }).perform();
    await this.driver.sleep(200);
    await this.closeSettings();
  }

  /**
   * D49bz: the .gitignore switch in Plato's own settings page, driven the way a
   * person drives it — open the gear, click the switch, read it back, close.
   *
   * The host re-renders the page from the value it stored, so the state read
   * afterwards is the host's answer and not the click's. Returns that value.
   */
  async setRespectGitignore(value) {
    await this.openSettings();
    // The section is a collapsed <details> on first open, so its switch is in
    // the DOM but not reachable by a click. Opening it is setup, not evidence.
    await this.driver.executeScript(`
      const sec = document.querySelector('.sec[data-sec="others"]');
      if (sec) sec.open = true;
    `);
    await this.driver.sleep(200);
    const box = await this.driver.findElement(By.id('respect-gitignore'));
    if ((await box.isSelected()) !== value) {
      await this.clickElement(box);
      // The host writes the setting, re-pushes the payload and re-renders.
      await this.driver.sleep(900);
    }
    const after = await this.driver
      .findElement(By.id('respect-gitignore'))
      .isSelected();
    // The page as a person sees it, for the record: the switch must look like
    // the other sections' switches, not like something bolted on.
    await this.shot(`settings-others-${after ? 'on' : 'off'}`);
    await this.closeSettings();
    return after;
  }

  /**
   * The MCP section as it stands on screen, read from the DOM rather than from a
   * screenshot — the same fields `scripts/render/mcp.mjs` asserts on, so the two
   * witnesses can be compared.
   */
  async mcpSection() {
    return this.driver.executeScript(`
      const sec = [...document.querySelectorAll('#sbody .sec')]
        .find((s) => s.getAttribute('data-sec') === 'mcp');
      if (!sec) return null;
      const help = sec.querySelector('.dhead .help');
      let tip = null;
      if (help) {
        help.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const t = [...document.querySelectorAll('div')]
          .find((d) => d.style.position === 'fixed' && d.style.zIndex === '9999');
        tip = t && t.style.display === 'block' ? t.textContent : null;
      }
      return {
        open: sec.open,
        title: (sec.querySelector('summary') || {}).textContent.trim(),
        tip,
        starter: (sec.querySelector('.starter') || {}).textContent || null,
        buttons: [...sec.querySelectorAll('.dhead button')].map((b) => b.textContent),
        rows: [...sec.querySelectorAll('.plist-row')].map((r) => ({
          name: (r.querySelector('.plist-name') || {}).textContent,
          tag: (r.querySelector('.plist-tag') || {}).textContent || null,
          checked: r.querySelector('.beh input') ? r.querySelector('.beh input').checked : null,
        })),
      };
    `);
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
