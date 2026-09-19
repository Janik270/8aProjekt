import { test, expect } from '@playwright/test';

test('teacher creates a class and sees a student traffic-light choice live', async ({ browser }, testInfo) => {
  const teacherContext = await browser.newContext(testInfo.project.use);
  const studentContext = await browser.newContext(testInfo.project.use);
  const teacher = await teacherContext.newPage();
  const student = await studentContext.newPage();
  const errors: string[] = [];
  teacher.on('pageerror', error => errors.push(`Lehrer: ${error.message}`));
  student.on('pageerror', error => errors.push(`Schüler: ${error.message}`));

  try {
    await teacher.goto('/#ampel');
    await expect(teacher.getByRole('heading', { name: 'Wie läuft eure Gruppenarbeit?' })).toBeVisible();
    await teacher.getByLabel('Klassenname').fill('Testklasse 8a');
    await teacher.getByRole('button', { name: 'Klasse erstellen', exact: true }).click();
    await expect(teacher.getByRole('heading', { name: 'Testklasse 8a' })).toBeVisible();
    await expect(teacher.getByRole('img', { name: /QR-Code für die Klasse/ })).toBeVisible();
    await expect(teacher.getByText('Noch niemand beigetreten')).toBeVisible();

    const studentUrl = teacher.url().replace(/\?key=.*$/, '');
    await student.goto(studentUrl);
    await expect(student.getByRole('heading', { name: 'Wie heißt du?' })).toBeVisible();
    await expect(student.locator('.sidebar')).toHaveCount(0);
    await expect(student.getByText('Group Writer')).toHaveCount(0);
    await expect(student.getByText('Excalidraw')).toHaveCount(0);
    await student.getByLabel('Name').fill('Mia');
    await student.getByRole('button', { name: 'Weiter' }).click();
    await expect(student.getByRole('heading', { name: 'Wie läuft es gerade?' })).toBeVisible();
    await student.getByRole('button', { name: /Grün Alles verstanden/ }).click();
    await expect(student.getByText('Deine Auswahl ist gespeichert.')).toBeVisible();

    const mia = teacher.locator('.student-status').filter({ hasText: 'Mia' });
    await expect(mia).toBeVisible({ timeout: 3_000 });
    await expect(mia).toHaveClass(/green/);
    await expect(mia.locator('.student-color')).toContainText('Grün');

    await student.getByRole('button', { name: /Rot Ich brauche Hilfe/ }).click();
    await expect(mia).toHaveClass(/red/, { timeout: 3_000 });
    await student.reload();
    await expect(student.getByRole('heading', { name: 'Wie läuft es gerade?' })).toBeVisible();
    await expect(student.getByRole('button', { name: /Rot Ich brauche Hilfe/ })).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([teacherContext.close(), studentContext.close()]);
  }
});
