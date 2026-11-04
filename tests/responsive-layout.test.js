import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('phone header uses a wrapping action grid instead of a horizontal scroller', () => {
  const phoneRules = css.match(/@media \(max-width: 680px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(phoneRules, /\.topbar-actions\s*\{[^}]*display:grid/);
  assert.match(phoneRules, /\.topbar-actions\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(phoneRules, /\.topbar-actions\s*\{[^}]*overflow-x:auto/);
});

test('studio exposes save, straight cameras, and persistent scroll affordances', () => {
  assert.match(html, /id="save-chart-button"/);
  assert.match(html, />Saved charts</);
  assert.match(html, /Straight front/);
  assert.doesNotMatch(html, /Apply recipe/);
  assert.match(css, /chart-type-list\{grid-template-columns:repeat\(4/);
  assert.match(css, /field-list,\.config-scroll\{overflow-y:scroll/);
  assert.match(css, /caret-color:#1d4ed8/);
});

test('inspector exposes the five chart-aware control areas and quality controls', () => {
  for (const id of ['tab-build', 'tab-appearance', 'tab-scene', 'tab-interaction', 'tab-quality']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="marker-mode-select"/);
  assert.match(html, /id="projection-select"/);
  assert.match(html, /id="aspect-mode-select"/);
  assert.match(html, /id="surface-controls"/);
  assert.match(html, /id="export-resolution-select"/);
  assert.match(html, /id="quality-status"/);
});

test('white-first shell exposes chart-level story authoring and presentation controls', () => {
  assert.match(html, /<html[^>]*data-theme="light"/);
  assert.doesNotMatch(html, /gradient-text/);
  for (const id of ['story-rail', 'capture-story-button', 'story-dialog', 'story-presenter', 'story-presenter-plot']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});

test('shell exposes explicit upload progress, interactive HTML export, and Story formatting controls', () => {
  for (const id of [
    'import-progress', 'import-progress-bar', 'import-status-text', 'export-html-button',
    'story-font-select', 'story-accent-input', 'story-layout-select', 'story-insight-list',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(css, /\.import-progress/);
  assert.match(css, /html\[data-theme=dark\][^]*\.story-rail/);
  assert.match(css, /\.topbar-overflow/);
});
