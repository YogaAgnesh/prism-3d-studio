const MAX_DEPTH = 24;
const MAX_ARRAY_ITEMS = 100_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function clean(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('Briefing package is too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new Error('A chart array exceeds the publishing limit.');
    return value.map((item) => clean(item, depth + 1));
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Briefing packages may contain JSON values only.');
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error('Unsafe package key.');
    output[key] = clean(item, depth + 1);
  }
  return output;
}

function text(value, fallback = '') {
  return String(value ?? fallback).trim().slice(0, 2_000);
}

export function buildBriefingPackage({ plotSpec, story = {}, source = {} }) {
  if (!plotSpec || !Array.isArray(plotSpec.data) || !plotSpec.data.length) throw new Error('A rendered chart is required.');
  return clean({
    schemaVersion: 1,
    runtime: { plotly: '3.1.0', prism: '1.0.0' },
    briefing: {
      title: text(story.title, plotSpec.layout?.title?.text || 'Untitled briefing'),
      takeaway: text(story.takeaway),
      freshness: text(story.freshness),
      context: text(story.context),
      metrics: (story.metrics ?? []).slice(0, 6).map((metric) => ({ label: text(metric.label), value: text(metric.value), note: text(metric.note) })),
      chapters: (story.chapters ?? []).slice(0, 8).map((chapter) => ({ title: text(chapter.title), body: text(chapter.body), camera: chapter.camera ?? null })),
    },
    figure: { data: plotSpec.data, layout: plotSpec.layout ?? {}, config: plotSpec.config ?? {} },
    explore: { enabled: story.explore !== false },
    privacy: {
      workbookIncluded: false,
      sourceRowsIncluded: false,
      publishedRows: plotSpec.data.reduce((count, trace) => Math.max(count, trace.x?.length ?? trace.z?.length ?? 0), 0),
      sourceRowCount: Number(source.rowCount) || null,
    },
    createdAt: new Date().toISOString(),
  });
}

export function validateBriefingPackage(value) {
  try {
    const cleaned = clean(value);
    const valid = cleaned?.schemaVersion === 1
      && typeof cleaned.briefing?.title === 'string'
      && Array.isArray(cleaned.figure?.data)
      && cleaned.figure.data.length > 0
      && cleaned.figure.layout && typeof cleaned.figure.layout === 'object';
    return valid ? { ok: true, value: cleaned } : { ok: false, message: 'Invalid Prism briefing package.' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}
