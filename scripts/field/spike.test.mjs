/**
 * Launch spike — the make-or-break check for the field-test harness.
 *
 * It proves three things and nothing else:
 *   1. a real VS Code window opens with the packaged extension installed,
 *   2. Plato's chat webview is reachable as a webview (not just as a tab), and
 *   3. the composer inside it accepts typed text and the send button exists.
 *
 * If this passes, driving the nine field tests is mechanical. If it fails, the
 * whole Layer 3 plan changes, so it is deliberately tiny.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { By, until } from 'selenium-webdriver';
import { VSBrowser, WebView, Workbench } from 'vscode-extension-tester';

const SHOTS = join(process.cwd(), 'tmp', 'field', 'shots');

async function shot(driver, name) {
  mkdirSync(SHOTS, { recursive: true });
  const png = await driver.takeScreenshot();
  const file = join(SHOTS, `${name}.png`);
  writeFileSync(file, png, 'base64');
  console.log(`SHOT ${file}`);
}

describe('field harness launch spike', function () {
  this.timeout(240000);

  it('opens Plato chat and reaches the composer', async () => {
    const driver = VSBrowser.instance.driver;

    await new Workbench().executeCommand('Plato: Open Chat');
    await driver.sleep(4000);
    await shot(driver, '01-chat-open');

    const webview = new WebView();
    await webview.switchToFrame();
    console.log('SWITCHED into webview frame');

    const q = await driver.wait(until.elementLocated(By.id('q')), 30000);
    console.log('FOUND composer #q');
    await q.sendKeys('spike: can you hear me?');
    await shot(driver, '02-typed');

    const go = await driver.findElement(By.id('go'));
    console.log('FOUND send button #go');
    await go.click();
    await driver.sleep(5000);
    await shot(driver, '03-sent');

    await webview.switchBack();
  });
});
