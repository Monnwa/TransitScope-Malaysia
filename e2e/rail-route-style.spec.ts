import { expect, test, type Page } from "@playwright/test";

const colours = { MONORAIL: '#8BCB88', 'LRT-PH': '#8B5A3C', 'LRT-KJ': '#E75480' };
const search = (page: Page) => page.getByRole('textbox', { name: 'Search vehicles, routes or stations' });
const popup = (page: Page) => page.locator('.rail-station-popup-shell');

async function expectRoutes(page: Page, selected: string[] = []) {
  await expect.poll(() => page.locator('.rail-alignment').evaluateAll((paths, ids) => paths.length > 0 && paths.every(path => {
    const active = ids.some(id => path.classList.contains(id));
    return getComputedStyle(path).strokeOpacity === (!ids.length || active ? '1' : '0.18') && getComputedStyle(path).opacity === '1';
  }), selected)).toBe(true);
}

async function choose(page: Page, name: string) {
  await search(page).fill(name);
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) }).getByRole('button', { name: 'View details' }).click();
  await expect(popup(page)).toHaveCount(1);
  await expect(popup(page).locator('strong')).toHaveText(name);
  await expect(popup(page)).toHaveCount(1);
  await expect(popup(page)).toHaveCSS('opacity', '1');
}

test('rail opacity, colours, station/search selection and non-rail regressions', async ({ page, isMobile }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize(isMobile ? { width: 375, height: 844 } : { width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-11-17T09:41:25Z'));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Train lines', exact: true })).toHaveCount(0);
  await expect(page.locator('.rail-map-group').getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.rail-alignment')).toHaveCount(8);
  await expectRoutes(page);
  await expect(page.locator('.linkbike-marker')).toHaveCount(27);
  await expect(page.locator('.micromobility-marker')).toHaveCount(48);
  await expect(page.locator('.bus-vehicle-icon')).toHaveCount(4);
  const busStyles = await page.locator('.bus-network-route').evaluateAll(paths => paths.map(path => [path.getAttribute('stroke'), path.getAttribute('stroke-opacity')]));
  expect(busStyles).toHaveLength(2);
  for (const [id, colour] of Object.entries(colours)) {
    await expect(page.locator(`.rail-alignment.${id}`).first()).toHaveAttribute('stroke', colour);
  }
  await page.locator('.leaflet-container').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('initial-full-opacity-colours.png') });

  // Exact search completion is a programmatic selection using the same state as map clicks.
  await search(page).fill('Raja Chulan');
  await expect(popup(page).locator('strong')).toHaveText('Raja Chulan');
  await expect(popup(page)).toHaveCSS('opacity', '1');
  await expectRoutes(page, ['MONORAIL']);
  await page.locator('.leaflet-container').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('normal-station-monorail.png') });
  await popup(page).getByRole('button', { name: 'Close popup' }).click();
  await expectRoutes(page);

  // Click the same native marker after clearing search selection.
  const raja = page.locator('.rail-station');
  await expect(raja).toHaveCount(1);
  await raja.click();
  await expectRoutes(page, ['MONORAIL']);
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole('button', { name: 'Close popup' }).click();
  await expectRoutes(page);
  await search(page).fill('');

  await choose(page, 'Putra Heights');
  await expectRoutes(page, ['LRT-KJ', 'LRT-PH']);
  await expect(popup(page)).toContainText('Interchange');
  await page.locator('.leaflet-container').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('interchange-putra-heights.png') });
  await choose(page, 'Tun Razak Exchange');
  await expectRoutes(page, ['MRT1', 'MRT2']);
  await popup(page).getByRole('button', { name: 'Close popup' }).click();
  await expectRoutes(page);
  await expect(page.locator('.rail-station')).toHaveCount(1);
  await page.locator('.rail-station').click({ timeout: 5000 });
  await expectRoutes(page, ['MRT1', 'MRT2']);
  await choose(page, 'KLCC');
  await expectRoutes(page, ['LRT-KJ']);

  await search(page).fill('MRT TAMAN MIDAH PINTU A');
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'MRT TAMAN MIDAH PINTU A', exact: true }) }).getByRole('button', { name: 'View details' }).first().click();
  await expectRoutes(page);
  await page.getByRole('button', { name: 'Reset dashboard', exact: true }).click();
  await expectRoutes(page);
  await expect(page.locator('.linkbike-marker')).toHaveCount(27);
  await expect(page.locator('.micromobility-marker')).toHaveCount(48);
  expect(await page.locator('.bus-network-route').evaluateAll(paths => paths.map(path => [path.getAttribute('stroke'), path.getAttribute('stroke-opacity')]))).toEqual(busStyles);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
