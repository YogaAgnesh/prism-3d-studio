import { coerceFieldValue, formatFieldValue } from '../data-types.js';
import { categoricalColors, getPalette, toColorscale } from '../palettes.js';
import { encodeAxis, formatAxisTitle } from './axis-encoding.js';
import { buildPlotlyConfig, buildSceneLayout } from './scene.js';

const DEFAULT_POINT_LIMIT = 8_000;
const MEASURE_TYPES = new Set(['number', 'currency', 'percent', 'duration']);

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleIndexes(indexes, limit, signature) {
  if (indexes.length <= limit) return indexes;
  return indexes.map((index) => ({ index, score: hashString(`${signature(index)}|${index}`) }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map(({ index }) => index);
}

function normalizedSizes(values, scale, field) {
  const usable = values.map((value) => {
    const coerced = coerceFieldValue(value, field);
    return Number.isFinite(coerced) ? Math.abs(coerced) : 0;
  });
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  if (min === max) return usable.map(() => 18 * scale);
  return usable.map((value) => (10 + Math.sqrt((value - min) / (max - min)) * 28) * scale);
}

function isMeasure(field) {
  return MEASURE_TYPES.has(field?.semanticType ?? field?.type) || MEASURE_TYPES.has(field?.type);
}

function valueAt(row, field) {
  return field ? row?.[field.id] : null;
}

export function buildScatter3d(dataset, mappings, inputSettings = {}) {
  const settings = {
    palette: 'spectrum', opacity: 0.9, markerScale: 1, markerMode: 'markers',
    pointLimit: DEFAULT_POINT_LIMIT, ...inputSettings,
  };
  const rows = dataset?.rows ?? [];
  const xAxis = encodeAxis(rows.map((row) => valueAt(row, mappings.x)), mappings.x);
  const yAxis = encodeAxis(rows.map((row) => valueAt(row, mappings.y)), mappings.y);
  const zAxis = encodeAxis(rows.map((row) => valueAt(row, mappings.z)), mappings.z);
  const validIndexes = rows.map((_, index) => index)
    .filter((index) => xAxis.values[index] !== null && yAxis.values[index] !== null && zAxis.values[index] !== null);
  const pointLimit = Math.max(100, Math.min(DEFAULT_POINT_LIMIT, Math.floor(Number(settings.pointLimit) || DEFAULT_POINT_LIMIT)));
  const renderedIndexes = sampleIndexes(validIndexes, pointLimit, (index) => `${xAxis.values[index]}|${yAxis.values[index]}|${zAxis.values[index]}`);
  const pick = (values) => renderedIndexes.map((index) => values[index]);
  const renderedRows = renderedIndexes.map((index) => rows[index]);
  const size = mappings.size
    ? normalizedSizes(renderedRows.map((row) => valueAt(row, mappings.size)), Number(settings.markerScale) || 1, mappings.size)
    : 14 * (Number(settings.markerScale) || 1);
  const continuousColor = mappings.color && isMeasure(mappings.color);
  const rawColors = renderedRows.map((row) => mappings.color ? valueAt(row, mappings.color) : valueAt(row, mappings.z));
  const markerColor = continuousColor ? rawColors.map((value) => coerceFieldValue(value, mappings.color)) : categoricalColors(rawColors, settings.palette);
  const mode = ['markers', 'lines', 'lines+markers'].includes(settings.markerMode) ? settings.markerMode : 'markers';
  const customdata = renderedRows.map((row) => [
    formatFieldValue(valueAt(row, mappings.x), mappings.x),
    formatFieldValue(valueAt(row, mappings.y), mappings.y),
    formatFieldValue(valueAt(row, mappings.z), mappings.z),
  ]);
  const trace = {
    type: 'scatter3d',
    mode,
    name: mappings.label?.label ?? mappings.z?.label ?? 'Observations',
    x: pick(xAxis.values),
    y: pick(yAxis.values),
    z: pick(zAxis.values),
    text: renderedRows.map((row) => mappings.label ? formatFieldValue(valueAt(row, mappings.label), mappings.label) : ''),
    customdata,
    line: mode.includes('lines') ? { width: Number(settings.lineWidth) || 4, color: settings.lineColor } : undefined,
    marker: mode.includes('markers') ? {
      size,
      sizemode: 'area',
      color: markerColor,
      symbol: settings.markerSymbol ?? 'circle',
      colorscale: continuousColor ? toColorscale(getPalette(settings.palette).colors) : undefined,
      reversescale: Boolean(settings.reverseColorScale),
      cmin: Number.isFinite(Number(settings.colorMin)) ? Number(settings.colorMin) : undefined,
      cmax: Number.isFinite(Number(settings.colorMax)) ? Number(settings.colorMax) : undefined,
      showscale: Boolean(continuousColor),
      colorbar: continuousColor ? { title: { text: formatAxisTitle(mappings.color) }, thickness: 14, len: 0.62 } : undefined,
      opacity: Math.min(Math.max(Number(settings.opacity) || 0.9, 0.05), 1),
      line: {
        color: settings.markerOutlineColor ?? 'rgba(255,255,255,0)',
        width: Number.isFinite(Number(settings.markerOutlineWidth)) ? Number(settings.markerOutlineWidth) : 0,
      },
    } : undefined,
    hovertemplate: `<b>%{text}</b><br>${mappings.x.label}: %{customdata[0]}<br>${mappings.y.label}: %{customdata[1]}<br>${mappings.z.label}: %{customdata[2]}<extra></extra>`,
  };
  const data = [trace];
  if (mode.includes('markers')) {
    data.push({
      type: 'scatter3d', mode: 'markers', x: trace.x, y: trace.y, z: trace.z,
      marker: { size: Array.isArray(size) ? size.map((entry) => entry * 1.24) : size * 1.24, sizemode: 'area', color: markerColor, opacity: 0.08, line: { width: 0 } },
      hoverinfo: 'skip', showlegend: false,
    });
  }
  return {
    data,
    layout: buildSceneLayout({ mappings, settings, ticks: { x: xAxis.ticks, y: yAxis.ticks, z: zAxis.ticks } }),
    config: buildPlotlyConfig(settings),
    stats: {
      sourceRows: rows.length,
      validRows: validIndexes.length,
      renderedPoints: renderedIndexes.length,
      excludedRows: rows.length - validIndexes.length,
      downsampled: renderedIndexes.length < validIndexes.length,
      sampledOutRows: validIndexes.length - renderedIndexes.length,
      samplingStrategy: renderedIndexes.length < validIndexes.length ? 'deterministic-hash' : 'none',
      axisDiagnostics: { x: xAxis.diagnostics, y: yAxis.diagnostics, z: zAxis.diagnostics },
    },
  };
}
