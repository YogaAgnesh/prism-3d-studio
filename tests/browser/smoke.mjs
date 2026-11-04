import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const artifact = path.join(projectRoot, 'dist', '3d-viz-studio.html');
assert.ok(existsSync(artifact), 'Run npm run build before the browser smoke test.');
mkdirSync(path.join(projectRoot, 'artifacts'), { recursive: true });

const bundledModules = 'C:\\Users\\yagnesh\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';
const { chromium } = await import(pathToFileURL(path.join(bundledModules, 'playwright', 'index.mjs')).href);
const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = browserCandidates.find(existsSync);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const pageErrors = [];
const remoteRequests = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('request', (request) => {
  if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
});

try {
  await page.addInitScript(() => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function delayedArrayBuffer() {
      return new Promise((resolve, reject) => window.setTimeout(() => originalArrayBuffer.call(this).then(resolve, reject), 180));
    };
  });
  await page.goto(pathToFileURL(artifact).href, { waitUntil: 'load' });
  await page.getByRole('heading', { name: /give your data/i }).waitFor();
  await page.screenshot({ path: path.join(projectRoot, 'artifacts', 'empty-state.png'), fullPage: true });

  await page.setInputFiles('#file-input', path.join(projectRoot, 'tests', 'fixtures', 'salesforce-sample.csv'));
  assert.equal(await page.getByRole('button', { name: 'File selected' }).isDisabled(), true);
  await page.locator('#import-progress:not(.hidden)').waitFor();
  assert.match(await page.locator('#import-file-name').innerText(), /salesforce-sample\.csv/i);
  assert.equal(await page.locator('#import-progress [role="progressbar"]').getAttribute('aria-valuenow'), null);
  await page.locator('#studio-view:not(.hidden)').waitFor();
  await page.locator('#chart-status .status-ready').waitFor({ timeout: 30_000 });
  assert.match(await page.locator('#source-meta').innerText(), /4 rows · 7 fields/);
  assert.equal(await page.locator('.mapping-slot.filled').count() >= 3, true);
  assert.equal(await page.locator('#chart-type-list [role="radio"]').count(), 4);
  for (const chartName of ['3D Bubble', '3D Columns', '3D Lollipop', '3D Surface']) {
    const chartButton = page.getByRole('radio', { name: chartName });
    assert.equal(await chartButton.isVisible(), true);
    await chartButton.click();
    await page.locator('#chart-status .status-ready').waitFor({ timeout: 30_000 });
  }
  await page.getByRole('radio', { name: '3D Bubble' }).click();
  await page.locator('#chart-status .status-ready').waitFor({ timeout: 30_000 });

  await page.locator('#filter-field-select').selectOption({ label: 'Split Amount (USD)' });
  await page.locator('#filter-operator-select').selectOption('between');
  await page.locator('#filter-value-input').fill('$1.5M');
  await page.locator('#filter-value-2-input').fill('$2.5M');
  const addFilterButton = page.getByRole('button', { name: 'Add filter' });
  await addFilterButton.scrollIntoViewIfNeeded();
  const addFilterHitTarget = await addFilterButton.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, targetId: target?.id, targetClass: target?.className };
  });
  assert.equal(addFilterHitTarget.targetId, 'add-filter-button');
  await addFilterButton.click();
  await page.locator('#filter-result').filter({ hasText: '2 of 4 rows included' }).waitFor();

  await page.getByRole('button', { name: 'Calculated field' }).click();
  await page.locator('#calculation-name').fill('Weighted Pipeline');
  await page.locator('#calculation-expression').fill('[Split Amount (USD)] * [Probability (%)]');
  await page.locator('#calculation-type').selectOption('currency');
  await page.getByRole('button', { name: 'Create field' }).click();
  await page.locator('.field-item', { hasText: 'Weighted Pipeline' }).waitFor();

  await page.getByRole('button', { name: 'Save chart' }).click();
  assert.equal(await page.locator('.chart-tray-item').count(), 2);

  await page.getByRole('tab', { name: 'Axes & Scene' }).click();
  await page.locator('#camera-select').selectOption('front');
  assert.equal(await page.locator('#perspective-toggle').isChecked(), false);

  // Import must hydrate the first saved chart without first overwriting it
  // with the chart that happened to be active before the import.
  const savedFirstTitle = await page.locator('.chart-tray-item').first().locator('strong').innerText();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.locator('#chart-title-input').fill('Second chart — active before import');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project' }).click();
  const download = await downloadPromise;
  const projectPath = await download.path();
  assert.ok(projectPath);
  await page.locator('#chart-title-input').fill('Unsaved mutation');
  await page.setInputFiles('#project-input', projectPath);
  await page.locator('.toast', { hasText: 'Project opened' }).waitFor();
  await page.locator('.chart-tray-item').first().click();
  assert.equal(await page.locator('#chart-title-input').inputValue(), savedFirstTitle);

  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.locator('[data-palette="sunset"]').click();
  assert.equal(await page.locator('[data-palette="sunset"]').getAttribute('class'), 'palette-option active');

  await page.getByRole('button', { name: /preview data/i }).click();
  await page.locator('#preview-drawer.open').waitFor();
  assert.equal(await page.locator('#preview-table tbody tr').count(), 4);
  await page.getByRole('button', { name: /close preview/i }).click();

  await page.getByRole('tab', { name: 'Build' }).click();
  await page.locator('#clear-filters-button').click();
  await page.locator('#chart-status').filter({ hasText: '4 of 4 rows' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Capture scene' }).click();
  await page.locator('.story-insight-card').first().waitFor();
  await page.locator('#story-font-select').selectOption('editorial');
  await page.locator('#story-layout-select').selectOption('metrics-first');
  await page.locator('#story-accent-input').fill('#7c3aed');
  await page.locator('#story-title-input').fill('FY27 pipeline concentration');
  await page.locator('#story-takeaway-input').fill('The strongest opportunities concentrate in two portfolio segments.');
  await page.locator('#story-metric-label-1').fill('Pipeline');
  await page.locator('#story-metric-value-1').fill('$8.4M');
  await page.getByRole('button', { name: 'Save chapter' }).click();
  await page.locator('.story-chapter', { hasText: 'FY27 pipeline concentration' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Present' }).isEnabled(), true);
  await page.getByRole('button', { name: 'Present' }).click();
  await page.locator('#story-presenter:not(.hidden)').waitFor();
  assert.equal(await page.locator('#story-presenter').getAttribute('data-story-font'), 'editorial');
  assert.equal(await page.locator('#story-presenter').getAttribute('data-story-layout'), 'metrics-first');
  await page.screenshot({ path: path.join(projectRoot, 'artifacts', 'story-presenter.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close presentation' }).click();

  await page.screenshot({ path: path.join(projectRoot, 'artifacts', 'populated-studio-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.waitForFunction(() => document.querySelector('#plot')?.layout?.paper_bgcolor === '#090B14', null, { timeout: 30_000 });
  const darkSurfaces = await page.evaluate(() => ['.topbar', '.story-rail', '.config-panel'].map((selector) => getComputedStyle(document.querySelector(selector)).backgroundColor));
  assert.equal(darkSurfaces.every((color) => !['rgb(255, 255, 255)', 'rgba(255, 255, 255, 0.92)'].includes(color)), true);
  await page.screenshot({ path: path.join(projectRoot, 'artifacts', 'populated-studio-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('#export-html-button').isVisible(), true);
  const htmlDownloadPromise = page.waitForEvent('download');
  await page.locator('#export-html-button').click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlDownloadPath = await htmlDownload.path();
  const exportedHtml = readFileSync(htmlDownloadPath, 'utf8');
  assert.match(exportedHtml, /Plotly\.newPlot/);
  assert.match(exportedHtml, /scrollZoom[^]*true/);
  assert.doesNotMatch(exportedHtml, /<script[^>]+src=/i);
  const exportedArtifactPath = path.join(projectRoot, 'artifacts', 'interactive-chart-export.html');
  writeFileSync(exportedArtifactPath, exportedHtml, 'utf8');
  const exportedPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const exportedRemoteRequests = [];
  const exportedErrors = [];
  exportedPage.on('pageerror', (error) => exportedErrors.push(error.message));
  exportedPage.on('console', (message) => { if (message.type() === 'error') exportedErrors.push(message.text()); });
  exportedPage.on('request', (request) => { if (/^https?:/i.test(request.url())) exportedRemoteRequests.push(request.url()); });
  await exportedPage.goto(pathToFileURL(exportedArtifactPath).href, { waitUntil: 'load' });
  try {
    await exportedPage.locator('#prism-chart .plot-container').waitFor({ timeout: 30_000 });
  } catch (error) {
    throw new Error(`Exported HTML did not initialize: ${exportedErrors.join(' | ') || error.message}`);
  }
  assert.deepEqual(exportedErrors, []);
  assert.deepEqual(exportedRemoteRequests, []);
  await exportedPage.close();
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(remoteRequests, []);
  writeFileSync(path.join(projectRoot, 'artifacts', 'browser-smoke-verification.json'), JSON.stringify({date:'2026-10-05',status:'passed',browser:browser.version(),checks:'four WebGL chart styles, filters, calculated fields, saved charts, project round trips, stories, themes, offline interactive exports',errors:pageErrors,remoteRequests:remoteRequests.length,exportErrors:exportedErrors,exportRemoteRequests:exportedRemoteRequests.length},null,2));
  console.log('Browser smoke test passed: import progress, four WebGL charts, filters, saved charts, formatted Story Builder, dark theme, and offline interactive HTML export.');
} finally {
  await browser.close();
}
