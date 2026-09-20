import { test, expect } from '@playwright/test';

test('tool dashboard replaces the old school modules and opens Group Writer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Ideen brauchen/ })).toBeVisible();
  await expect(page.locator('.tool-card')).toHaveCount(4);
  await expect(page.getByText('Stundenplan')).toHaveCount(0);
  await page.getByRole('button', { name: 'Group Writer öffnen' }).click();
  await expect(page.getByLabel('Dokumenttitel')).toBeVisible();
  await expect(page.getByLabel('Gemeinsames Dokument')).toBeVisible();
  const mobile = page.viewportSize()!.width < 900;
  if (mobile) await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await expect(page.getByRole('button', { name: 'Text importieren' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Als HTML exportieren' })).toHaveCount(0);
  if (mobile) await page.keyboard.press('Escape');
  await page.locator('input[type="file"][accept*=".txt"]').setInputFiles({
    name: 'ideen.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Unsere importierte Idee\n\nGemeinsam weiterdenken.'),
  });
  await expect(page.getByLabel('Gemeinsames Dokument')).toContainText('Unsere importierte Idee');
  await page.getByRole('button', { name: 'Teilen' }).click();
  await expect(page.getByRole('heading', { name: 'Per Link oder QR-Code teilen' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR-Code zum Arbeitsbereich' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('project page uses the Scool Tools brand and accepts ideas', async ({ page }) => {
  await page.goto('/#about');
  await expect(page).toHaveTitle(/Scool Tools/);
  await expect(page.getByText('Ideen gerne unten eintragen.')).toBeVisible();
  await page.getByLabel('Deine Idee').fill('Ein Quiz-Tool wäre toll.');
  await page.getByRole('button', { name: 'Idee einreichen' }).click();
  await expect(page.getByText('Danke! Deine Idee wurde eingereicht.')).toBeVisible();
  await expect(page.getByLabel('Deine Idee')).toHaveValue('');
});

test('imprint shows the KidsLab legal entity and register details', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Impressum' }).last().click();

  await expect(page).toHaveURL(/#impressum$/);
  await expect(page.getByRole('heading', { name: 'Impressum', exact: true })).toBeVisible();
  await expect(page.getByText('KidsLab gGmbH', { exact: true })).toBeVisible();
  await expect(page.getByText('Neidhartstr. 2')).toBeVisible();
  await expect(page.getByText('Gregor Walter')).toBeVisible();
  await expect(page.getByText('Registernummer: 34884')).toBeVisible();
  await expect(page.getByRole('link', { name: /Vollständiges KidsLab-Impressum/ })).toHaveAttribute('href', 'https://kidslab.de/ueber-kidslab/impressum/');
});

test('mobile sidebar keeps every tool reachable on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();

  const sidebar = page.locator('.sidebar');
  const navigation = page.locator('.navigation');
  const sidebarScrollable = await sidebar.evaluate(element => element.scrollHeight > element.clientHeight);
  const navigationHasNestedScroll = await navigation.evaluate(element => element.scrollHeight > element.clientHeight);

  expect(sidebarScrollable).toBe(true);
  expect(navigationHasNestedScroll).toBe(false);

  for (const name of ['Excalidraw', 'Group Writer', 'Ampel-Tool', 'Fokus-Timer']) {
    const tool = navigation.getByLabel(name, { exact: true });
    await tool.scrollIntoViewIfNeeded();
    await expect(tool).toBeInViewport({ ratio: 1 });
  }
});

test('whiteboard supports view links and theme/sidebar preferences', async ({ page }, testInfo) => {
  await page.goto('/');
  const mobile = testInfo.project.name === 'mobile';
  if (mobile) {
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  } else {
    await page.getByRole('button', { name: 'Navigation einklappen' }).click();
    await expect(page.locator('.app')).toHaveClass(/sidebar-collapsed/);
    await page.getByRole('button', { name: 'Navigation ausklappen' }).click();
  }
  await page.getByRole('button', { name: 'Dunkles Design' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Alle Tools' }).click();
  await page.getByRole('button', { name: 'Excalidraw öffnen' }).click();
  await expect(page.getByLabel('Whiteboard-Titel')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="main-menu-trigger"]')).toBeHidden();
  if (mobile) await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await expect(page.getByRole('button', { name: 'Als PNG exportieren' })).toBeVisible();
  await page.getByRole('button', { name: 'Zeichnung zentrieren' }).click();
  await page.getByRole('button', { name: 'Teilen' }).click();
  await page.getByRole('button', { name: 'Nur ansehen' }).click();
  const viewerUrl = await page.getByLabel('Freigabelink').inputValue();
  expect(viewerUrl).not.toContain('?key=');
});

test('focus timer supports presets, custom minutes and pause', async ({ page }) => {
  await page.goto('/#fokus');
  await expect(page.getByRole('heading', { name: 'Fokus-Timer' })).toBeVisible();
  await page.getByRole('button', { name: '5 Min.', exact: true }).click();
  await page.getByRole('button', { name: 'Eine Minute hinzufügen' }).click();
  await expect(page.getByText('06:00')).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Weiter' })).toBeVisible();
});

test('recent projects offer context actions, duplication and deletion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'The desktop test covers the native right-click interaction.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Group Writer öffnen' }).click();
  await expect(page.getByLabel('Dokumenttitel')).toBeVisible();

  await page.goto('/#start');
  const original = page.locator('.recent-item').filter({ hasText: 'Unbenanntes Dokument' });
  await expect(original).toHaveCount(1);
  await original.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Duplizieren' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Umbenennen' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Endgültig löschen' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
  await expect(page.getByLabel('Dokumenttitel')).toHaveValue('Kopie von Unbenanntes Dokument');

  await page.goto('/#start');
  const duplicate = page.locator('.recent-item').filter({ hasText: 'Kopie von Unbenanntes Dokument' });
  await expect(duplicate).toHaveCount(1);
  await duplicate.click({ button: 'right' });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('menuitem', { name: 'Endgültig löschen' }).click();
  await expect(duplicate).toHaveCount(0);
  await expect(original).toHaveCount(1);
});

test('writer changes appear immediately on a second device and in view-only mode', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'One desktop run covers the shared live connection.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Group Writer öffnen' }).click();
  await expect(page.getByLabel('Gemeinsames Dokument')).toBeVisible();

  const viewer = await context.newPage();
  await viewer.goto(page.url().replace(/\?key=.*$/, ''));
  await expect(viewer.getByText('Dieses Dokument ist schreibgeschützt.')).toBeVisible();

  await page.getByLabel('Gemeinsames Dokument').fill('Diese Änderung ist sofort auf dem zweiten Gerät sichtbar.');
  await expect(viewer.getByLabel('Gemeinsames Dokument')).toContainText('sofort auf dem zweiten Gerät', { timeout: 2_000 });
  await viewer.close();
});
