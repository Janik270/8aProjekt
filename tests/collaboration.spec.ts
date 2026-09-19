import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('names, text carets and simultaneous typing are visible to other participants', async ({ browser, request }, testInfo) => {
  const created = await (await request.post('/api/workspaces', { data: { type: 'writer' } })).json();
  const contexts = await Promise.all([browser.newContext(testInfo.project.use), browser.newContext(testInfo.project.use)]);
  const [alice, bob] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of [alice, bob]) page.on('pageerror', error => errors.push(error.message));
  const url = `/#writer/${created.id}?key=${created.editKey}`;
  try {
    await Promise.all([alice.goto(url), bob.goto(url)]);
    await alice.getByLabel('Dein Name').fill('Anna');
    await bob.getByLabel('Dein Name').fill('Ben');
    await expect(alice.getByLabel('Teilnehmende')).toContainText('Ben');
    await expect(bob.getByLabel('Teilnehmende')).toContainText('Anna');
    const a = alice.getByLabel('Gemeinsames Dokument');
    const b = bob.getByLabel('Gemeinsames Dokument');
    await a.fill('Start ');
    await expect(b).toContainText('Start');
    await a.press('ControlOrMeta+End');
    await b.click();
    await b.press('ControlOrMeta+End');
    await expect(alice.locator('.collaboration-carets__label')).toContainText('Ben');
    await expect(bob.locator('.collaboration-carets__label')).toContainText('Anna');
    await Promise.all([alice.keyboard.insertText('Apfel '), bob.keyboard.insertText('Birne ')]);
    for (const editor of [a, b]) {
      await expect(editor).toContainText('Apfel');
      await expect(editor).toContainText('Birne');
    }
    await bob.getByLabel('Dein Name').fill('Benedikt');
    await expect(alice.getByLabel('Teilnehmende')).toContainText('Benedikt');
    await expect(alice.getByLabel('Teilnehmende')).not.toContainText('Ben (');
    await bob.reload();
    await expect(bob.getByLabel('Dein Name')).toHaveValue('Benedikt');
    await expect(bob.getByLabel('Gemeinsames Dokument')).toContainText('Apfel');
    await bob.close();
    await expect(alice.getByLabel('Teilnehmende')).not.toContainText('Benedikt');
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('whiteboard streams unfinished drawing, preserves both drawings and shares names', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Drawing uses desktop mouse input.');
  const created = await (await request.post('/api/workspaces', { data: { type: 'whiteboard' } })).json();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [alice, bob] = await Promise.all(contexts.map(context => context.newPage()));
  const url = `/#whiteboard/${created.id}?key=${created.editKey}`;
  await bob.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    const labels = new Set<string>();
    (window as unknown as { drawnLabels: Set<string> }).drawnLabels = labels;
    CanvasRenderingContext2D.prototype.fillText = function (...args) { labels.add(args[0]); return original.apply(this, args); };
  });
  try {
    await Promise.all([alice.goto(url), bob.goto(url)]);
    await alice.getByLabel('Dein Name').fill('Anna');
    await bob.getByLabel('Dein Name').fill('Ben');
    await expect(bob.getByLabel('Teilnehmende')).toContainText('Anna');
    await expect(alice.locator('.excalidraw')).toBeVisible();
    await expect(bob.locator('.excalidraw')).toBeVisible();
    await alice.getByTestId('toolbar-rectangle').locator('..').click();
    await alice.mouse.move(650, 420);
    await alice.mouse.down();
    await alice.mouse.move(750, 510, { steps: 6 });
    // The drawing must reach storage and peers before releasing the mouse.
    await expect.poll(async () => {
      const workspace = await (await request.get(`/api/workspaces/${created.id}`)).json();
      return JSON.parse(workspace.content).elements.filter((element: { isDeleted: boolean; width: number }) => !element.isDeleted && element.width > 50).length;
    }).toBe(1);
    const intermediateDownload = bob.waitForEvent('download');
    await bob.getByRole('button', { name: 'Excalidraw-Datei', exact: true }).click();
    const intermediatePath = await (await intermediateDownload).path();
    const intermediate = JSON.parse(await readFile(intermediatePath!, 'utf8'));
    expect(intermediate.elements.some((element: { width: number }) => element.width > 50)).toBe(true);
    await bob.getByTestId('toolbar-rectangle').locator('..').click();
    await bob.mouse.move(850, 420);
    await bob.mouse.down();
    await bob.mouse.move(960, 520, { steps: 6 });
    await Promise.all([alice.mouse.up(), bob.mouse.up()]);
    await expect.poll(async () => {
      const workspace = await (await request.get(`/api/workspaces/${created.id}`)).json();
      return JSON.parse(workspace.content).elements.filter((element: { isDeleted: boolean }) => !element.isDeleted).length;
    }).toBe(2);
    await alice.getByLabel('Whiteboard-Titel').fill('Gemeinsame Skizze');
    await expect(bob.getByLabel('Whiteboard-Titel')).toHaveValue('Gemeinsame Skizze');
    // Excalidraw draws remote pointer labels on the interactive canvas.
    await alice.mouse.move(700, 550);
    await expect.poll(() => bob.evaluate(() => (window as unknown as { drawnLabels: Set<string> }).drawnLabels.has('Anna'))).toBe(true);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('writer reconnects and merges changes made during a connection loss', async ({ page, request }) => {
  const created = await (await request.post('/api/workspaces', { data: { type: 'writer' } })).json();
  let disconnect: (() => void) | undefined;
  let block = false;
  await page.routeWebSocket('**/live', socket => {
    if (block) { socket.close(); return; }
    const server = socket.connectToServer();
    disconnect = () => { block = true; server.close(); socket.close(); };
  });
  await page.goto(`/#writer/${created.id}?key=${created.editKey}`);
  await expect(page.locator('.live-status')).toHaveText('Live verbunden');
  const editor = page.getByLabel('Gemeinsames Dokument');
  disconnect!();
  await expect(page.locator('.live-status')).toContainText('Offline');
  await editor.fill('Auch offline bleibt dieser Text erhalten.');
  block = false;
  await expect(page.locator('.live-status')).toHaveText('Live verbunden');
  await page.reload();
  await expect(page.getByLabel('Gemeinsames Dokument')).toContainText('Auch offline bleibt dieser Text erhalten.');
});

test('a shared link stays out of recents and can be saved to an account for another device', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The account window is covered once on desktop.');
  const created = await (await request.post('/api/workspaces', { data: { type: 'writer' } })).json();
  const firstContext = await browser.newContext();
  const first = await firstContext.newPage();
  try {
    await first.goto(`/#writer/${created.id}?key=${created.editKey}`);
    await expect(first.getByLabel('Gemeinsames Dokument')).toBeVisible();
    expect(await first.evaluate(() => JSON.parse(localStorage.getItem('8a-recent-workspaces') || '[]'))).toEqual([]);

    await first.getByRole('button', { name: 'Anmelden oder Konto erstellen' }).click();
    await first.getByRole('tab', { name: 'Konto erstellen' }).click();
    await first.getByLabel('Benutzername').fill('Browser Konto');
    await first.getByLabel('Passwort').fill('browser-passwort');
    await first.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
    await expect(first.getByRole('heading', { name: 'Browser Konto' })).toBeVisible();
    await first.getByRole('button', { name: 'Im Konto speichern' }).click();
    await expect(first.getByRole('button', { name: 'Gespeichert' })).toBeDisabled();
  } finally { await firstContext.close(); }

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    await second.goto('/');
    await second.getByRole('button', { name: 'Anmelden oder Konto erstellen' }).click();
    await second.getByLabel('Benutzername').fill('browser konto');
    await second.getByLabel('Passwort').fill('browser-passwort');
    await second.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(second.getByText('1 gespeichertes Projekt')).toBeVisible();
    await second.getByRole('button', { name: 'Unbenanntes Dokument Dokument' }).click();
    await expect(second.getByLabel('Gemeinsames Dokument')).toBeEditable();
    await expect(second).toHaveURL(new RegExp(`writer/${created.id}\\?key=`));
  } finally { await secondContext.close(); }
});

test('projects created while signed in are automatically stored in the account', async ({ page }, testInfo) => {
  await page.goto('/');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await page.getByRole('button', { name: 'Anmelden oder Konto erstellen' }).click();
  await page.getByRole('tab', { name: 'Konto erstellen' }).click();
  await page.getByLabel('Benutzername').fill(testInfo.project.name === 'mobile' ? 'Mobile Projekte' : 'Eigene Projekte');
  await page.getByLabel('Passwort').fill('eigenes-passwort');
  await page.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontofenster schließen' }).click();
  await page.getByRole('button', { name: 'Group Writer öffnen' }).click();
  await expect(page.getByLabel('Gemeinsames Dokument')).toBeVisible();
  await page.getByRole('button', { name: 'Konto öffnen', exact: true }).click();
  await expect(page.getByText('1 gespeichertes Projekt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gespeichert' })).toBeDisabled();
});
