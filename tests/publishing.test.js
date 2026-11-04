import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBriefingPackage, validateBriefingPackage } from '../src/publishing/briefing-package.js';
import { generateInteractiveChartHtml, generatePlotlyCode } from '../src/publishing/plotly-code.js';

const spec = {
  data: [{ type: 'scatter3d', mode: 'markers', x: [1, 2], y: ['A', 'B'], z: [3, 4] }],
  layout: { title: { text: 'Pipeline' }, scene: { xaxis: { title: { text: 'X' } } } },
  config: { responsive: true, displaylogo: false },
};

test('briefing package contains a story and only chart-ready data', () => {
  const result = buildBriefingPackage({
    plotSpec: spec,
    story: { title: 'Growth pockets', takeaway: 'Enterprise leads the mix.', freshness: 'Q3 FY26', metrics: [{ label: 'Pipeline', value: '$84M' }] },
    source: { fileName: 'secret.xlsx', sheetName: 'Deals', rowCount: 500 },
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.briefing.title, 'Growth pockets');
  assert.deepEqual(result.figure.data[0].x, [1, 2]);
  assert.equal(result.privacy.workbookIncluded, false);
  assert.equal(JSON.stringify(result).includes('secret.xlsx'), false);
  assert.equal(validateBriefingPackage(result).ok, true);
});

test('briefing validator rejects executable values and malformed figures', () => {
  const malformed = { schemaVersion: 1, briefing: {}, figure: { data: [{ x: [() => 1] }], layout: {}, config: {} } };
  assert.equal(validateBriefingPackage(malformed).ok, false);
});

test('generated Plotly code is standalone, readable, and faithfully embeds the figure', () => {
  const code = generatePlotlyCode(spec, { elementId: 'prism-chart' });
  assert.match(code, /Plotly\.newPlot/);
  assert.match(code, /scatter3d/);
  assert.match(code, /displaylogo/);
  assert.doesNotMatch(code, /function\s*\(/);
});

test('interactive HTML export embeds its runtime, chart, story, theme, and gesture controls', () => {
  const html = generateInteractiveChartHtml(spec, {
    plotlySource: 'window.Plotly={newPlot:function(){}};',
    theme: 'dark',
    story: {
      title: 'Pipeline concentration', takeaway: 'One segment leads the portfolio.',
      metrics: [{ label: 'Pipeline', value: '$84M' }],
      style: { fontFamily: 'editorial', accentColor: '#7C3AED', layout: 'narrative-left' },
    },
  });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /window\.Plotly=/);
  assert.match(html, /Pipeline concentration/);
  assert.match(html, /One segment leads the portfolio/);
  assert.match(html, /scrollZoom[^]*true/);
  assert.match(html, /displayModeBar[^]*true/);
  assert.match(html, /touch-action/);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});

test('interactive HTML export rejects an absent embedded Plotly runtime', () => {
  assert.throws(() => generateInteractiveChartHtml(spec, { plotlySource: '' }), /embedded Plotly runtime/i);
});
