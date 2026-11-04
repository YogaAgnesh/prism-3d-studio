import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveChartInsights } from '../src/story/insights.js';

test('derives deterministic outlier and range suggestions from rendered chart values', () => {
  const insights = deriveChartInsights({
    data: [{
      type: 'scatter3d',
      x: ['A', 'B', 'C', 'D', 'E'], y: [1, 2, 3, 4, 5], z: [10, 11, 12, 13, 120],
      text: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega'],
    }],
    layout: { scene: { zaxis: { title: { text: 'Pipeline (USD)' } } } },
  });

  assert.equal(insights.length >= 2, true);
  assert.match(insights[0].title, /outlier/i);
  assert.match(insights[0].takeaway, /Omega|120/);
  assert.equal(insights[0].metric.label, 'Potential outliers');
  assert.equal(insights[0].metric.value, '1');
  assert.equal(insights.every((item) => item.method && item.takeaway), true);
});

test('returns a useful distribution summary when no statistical outlier exists', () => {
  const insights = deriveChartInsights({ data: [{ type: 'scatter3d', z: [10, 11, 12, 13] }] });
  assert.match(insights[0].title, /range|distribution/i);
  assert.equal(insights[0].metric.value, '4');
});

test('does not invent insights for charts without enough numeric evidence', () => {
  assert.deepEqual(deriveChartInsights({ data: [{ x: ['A'], y: ['B'] }] }), []);
});

test('analyzes nested surface matrices as rendered numeric evidence', () => {
  const insights = deriveChartInsights({
    data: [{ type: 'surface', z: [[10, 11, 12], [13, 14, 100]] }],
    layout: { scene: { zaxis: { title: { text: 'Revenue' } } } },
  });
  assert.equal(insights.length >= 1, true);
  assert.match(insights.map((item) => item.takeaway).join(' '), /Revenue/);
});
