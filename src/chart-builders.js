import { aggregateRows } from './aggregate.js';
import { coerceFieldValue, formatFieldValue } from './data-types.js';
import { getPalette, categoricalColors, toColorscale } from './palettes.js';
import { buildPlotlyConfig, buildSceneLayout } from './charts/scene.js';
import { buildScatter3d } from './charts/build-scatter3d.js';
import { buildSurface3d } from './charts/build-surface3d.js';

const MAX_SCATTER_POINTS = 8_000;
const MAX_CATEGORY_GROUPS = 60;

const DEFAULT_SETTINGS = Object.freeze({
  title: 'Sales opportunity landscape',
  palette: 'spectrum',
  aggregation: 'sum',
  background: '#F6F8FC',
  plotBackground: '#FFFFFF',
  grid: true,
  opacity: 0.9,
  markerScale: 1,
  camera: 'perspective',
  perspective: true,
  reverseX: false,
  reverseY: false,
  reverseZ: false,
  pointLimit: MAX_SCATTER_POINTS,
  groupLimit: MAX_CATEGORY_GROUPS,
});

function valueFor(row, field) {
  const value = coerceFieldValue(row?.[field.id], field);
  return value instanceof Date ? value.toISOString() : value;
}

function categoryFor(row, field) {
  const value = row?.[field.id];
  if (value === null || value === undefined || value === '') return 'Unspecified';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function normalizeSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...settings };
}

function normalizedSizes(values, scale) {
  const usable = values.map((value) => typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : 0);
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  if (min === max) return usable.map(() => 18 * scale);
  return usable.map((value) => (10 + Math.sqrt((value - min) / (max - min)) * 28) * scale);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicSample(items, limit, signature) {
  if (items.length <= limit) return items;
  return items.map((item, index) => ({ item, index, score: hashString(`${signature(item)}|${index}`) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map(({ item }) => item);
}

function categoricalAxis(field) {
  return ['text', 'boolean'].includes(field?.type) || ['category', 'identifier', 'fiscalPeriod', 'geography', 'freeText'].includes(field?.semanticType);
}

function encodeBubbleAxis(rendered, field, key) {
  if (!categoricalAxis(field)) return { values: rendered.map((point) => point[key]), ticks: undefined };
  const categories = [...new Set(rendered.map((point) => String(point[key])))];
  return {
    values: rendered.map((point) => categories.indexOf(String(point[key]))),
    ticks: { values: categories.map((_, index) => index), text: categories },
  };
}

function buildBubble(dataset, mappings, settings) {
  const validRows = dataset.rows.map((row) => ({
    row,
    x: valueFor(row, mappings.x),
    y: valueFor(row, mappings.y),
    z: valueFor(row, mappings.z),
  })).filter(({ x, y, z }) => x !== null && y !== null && z !== null);
  const pointLimit = Math.max(100, Math.min(MAX_SCATTER_POINTS, Math.floor(settings.pointLimit)));
  const rendered = deterministicSample(validRows, pointLimit, ({ x, y, z }) => `${x}|${y}|${z}`);
  const sizeValues = rendered.map(({ row }) => mappings.size ? valueFor(row, mappings.size) : 1);
  const colorValues = rendered.map(({ row }) => mappings.color ? row[mappings.color.id] : mappings.z ? valueFor(row, mappings.z) : 1);
  const colorIsMeasure = mappings.color && ['number', 'currency', 'percent'].includes(mappings.color.type);
  const markerColor = colorIsMeasure
    ? colorValues.map((value) => Number(value))
    : categoricalColors(colorValues, settings.palette);
  const xAxis = encodeBubbleAxis(rendered, mappings.x, 'x');
  const yAxis = encodeBubbleAxis(rendered, mappings.y, 'y');
  const markerSize = mappings.size ? normalizedSizes(sizeValues, settings.markerScale) : 14 * settings.markerScale;

  const trace = {
    type: 'scatter3d',
    mode: 'markers',
    name: mappings.label?.label ?? 'Opportunities',
    x: xAxis.values,
    y: yAxis.values,
    z: rendered.map(({ z }) => z),
    text: rendered.map(({ row }) => mappings.label ? formatFieldValue(row[mappings.label.id], mappings.label) : ''),
    customdata: rendered.map(({ row }) => [
      mappings.x ? formatFieldValue(row[mappings.x.id], mappings.x) : '',
      mappings.y ? formatFieldValue(row[mappings.y.id], mappings.y) : '',
      mappings.z ? formatFieldValue(row[mappings.z.id], mappings.z) : '',
    ]),
    marker: {
      size: markerSize,
      color: markerColor,
      colorscale: colorIsMeasure ? toColorscale(getPalette(settings.palette).colors) : undefined,
      showscale: Boolean(colorIsMeasure),
      colorbar: colorIsMeasure ? { title: mappings.color.label, thickness: 12, len: 0.55 } : undefined,
      opacity: Math.min(settings.opacity, 0.94),
      line: { color: 'rgba(0,0,0,0)', width: 0 },
    },
    hovertemplate: '<b>%{text}</b><br>' +
      `${mappings.x.label}: %{customdata[0]}<br>` +
      `${mappings.y.label}: %{customdata[1]}<br>` +
      `${mappings.z.label}: %{customdata[2]}<extra></extra>`,
  };

  return {
    data: [trace, {
      type: 'scatter3d', mode: 'markers', x: xAxis.values, y: yAxis.values, z: rendered.map(({ z }) => z),
      marker: { size: Array.isArray(markerSize) ? markerSize.map((size) => size * 1.28) : markerSize * 1.28, color: markerColor, opacity: 0.10, line: { width: 0 } },
      hoverinfo: 'skip', showlegend: false,
    }],
    layout: buildSceneLayout({ mappings, settings, ticks: { x: xAxis.ticks, y: yAxis.ticks } }),
    config: buildPlotlyConfig(settings),
    stats: {
      sourceRows: dataset.rows.length,
      validRows: validRows.length,
      renderedPoints: rendered.length,
      excludedRows: dataset.rows.length - validRows.length,
      downsampled: rendered.length < validRows.length,
      sampledOutRows: validRows.length - rendered.length,
      samplingStrategy: rendered.length < validRows.length ? 'deterministic-hash' : 'none',
    },
  };
}

function aggregateForChart(dataset, mappings, settings, secondDimension) {
  const dimensions = [mappings.x.id];
  if (secondDimension) dimensions.push(secondDimension.id);
  return aggregateRows(dataset.rows, dimensions, mappings.z.id, settings.aggregation, Math.max(10, Math.min(MAX_CATEGORY_GROUPS, Math.floor(settings.groupLimit))), mappings.z, [mappings.x,secondDimension]);
}

function categoriesFrom(groups, keyIndex) {
  return [...new Set(groups.map((group) => group.key[keyIndex]))];
}

function categoryComparator(field) {
  return (left, right) => {
    const fiscal = (value) => { const match = String(value).match(/FY\s*(\d+).*?P\s*(\d+)/i); return match ? Number(match[1]) * 100 + Number(match[2]) : null; };
    if (field?.semanticType === 'fiscalPeriod') return (fiscal(left) ?? Infinity) - (fiscal(right) ?? Infinity);
    if (field?.type === 'date' || field?.semanticType === 'dateTime') return (new Date(left).valueOf() || 0) - (new Date(right).valueOf() || 0);
    if (['number', 'currency', 'percent', 'duration'].includes(field?.semanticType ?? field?.type)) return Number(left) - Number(right);
    return 0;
  };
}

function aggregationStats(dataset, aggregation) {
  return {
    sourceRows: dataset.rows.length,
    groups: aggregation.groups.length,
    omittedGroups: aggregation.omittedGroups,
    groupStrategy: aggregation.omittedGroups > 0 ? 'top-by-absolute-value' : 'all-groups',
  };
}

function addCylinder(mesh, x, y, height, color) {
  const baseIndex = mesh.x.length;
  const base = Math.min(0, height);
  const top = Math.max(0, height);
  const sides = 14;
  const radius = 0.29;
  for (let side = 0; side < sides; side += 1) {
    const angle = (side / sides) * Math.PI * 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    mesh.x.push(px, px); mesh.y.push(py, py); mesh.z.push(base, top); mesh.vertexcolor.push(color, color);
  }
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    const a = baseIndex + side * 2; const b = baseIndex + next * 2;
    mesh.i.push(a, a + 1); mesh.j.push(b, b); mesh.k.push(a + 1, b + 1);
  }
  const bottomCenter = mesh.x.length; mesh.x.push(x); mesh.y.push(y); mesh.z.push(base); mesh.vertexcolor.push(color);
  const topCenter = mesh.x.length; mesh.x.push(x); mesh.y.push(y); mesh.z.push(top); mesh.vertexcolor.push(color);
  for (let side = 0; side < sides; side += 1) { const next = (side + 1) % sides; mesh.i.push(bottomCenter, topCenter); mesh.j.push(baseIndex + next * 2, baseIndex + side * 2 + 1); mesh.k.push(baseIndex + side * 2, baseIndex + next * 2 + 1); }
}

function categoryTicks(xCategories, yCategories) {
  return {
    x: { values: xCategories.map((_, index) => index), text: xCategories },
    y: { values: yCategories.map((_, index) => index), text: yCategories },
  };
}

function buildColumns(dataset, mappings, settings) {
  const aggregation = aggregateForChart(dataset, mappings, settings, mappings.series);
  const xCategories = categoriesFrom(aggregation.groups, 0);
  const yCategories = mappings.series ? categoriesFrom(aggregation.groups, 1) : ['All'];
  const palette = getPalette(settings.palette).colors;
  const mesh = { x: [], y: [], z: [], i: [], j: [], k: [], vertexcolor: [] };
  const topX = [];
  const topY = [];
  const topZ = [];
  const text = [];

  aggregation.groups.forEach((group, index) => {
    const x = xCategories.indexOf(group.key[0]);
    const y = mappings.series ? yCategories.indexOf(group.key[1]) : 0;
    addCylinder(mesh, x, y, group.value, palette[index % palette.length]);
    topX.push(x);
    topY.push(y);
    topZ.push(group.value);
    text.push(`${group.key.join(' · ')}<br>${mappings.z.label}: ${formatFieldValue(group.value, mappings.z, {canonical:true})}`);
  });

  return {
    data: [
      {
        type: 'mesh3d',
        ...mesh,
        name: mappings.z.label,
        flatshading: false,
        opacity: settings.opacity,
        hoverinfo: 'skip',
        lighting: { ambient: 0.62, diffuse: 0.72, specular: 0.42, roughness: 0.32, fresnel: 0.12 },
        lightposition: { x: 900, y: 700, z: 1200 },
      },
      {
        type: 'scatter3d',
        mode: 'markers',
        x: topX,
        y: topY,
        z: topZ,
        text,
        marker: { size: 3, color: 'rgba(255,255,255,.01)' },
        hovertemplate: '%{text}<extra></extra>',
        showlegend: false,
      },
    ],
    layout: buildSceneLayout({ mappings: { ...mappings, y: mappings.series }, settings, ticks: categoryTicks(xCategories, yCategories) }),
    config: buildPlotlyConfig(settings),
    stats: aggregationStats(dataset, aggregation),
  };
}

function buildLollipop(dataset, mappings, settings) {
  const aggregation = aggregateForChart(dataset, mappings, settings, mappings.series);
  const xCategories = categoriesFrom(aggregation.groups, 0);
  const yCategories = mappings.series ? categoriesFrom(aggregation.groups, 1) : ['All'];
  const x = [];
  const y = [];
  const z = [];
  const markerX = [];
  const markerY = [];
  const markerZ = [];
  const text = [];

  aggregation.groups.forEach((group) => {
    const xIndex = xCategories.indexOf(group.key[0]);
    const yIndex = mappings.series ? yCategories.indexOf(group.key[1]) : 0;
    x.push(xIndex, xIndex, null);
    y.push(yIndex, yIndex, null);
    z.push(0, group.value, null);
    markerX.push(xIndex);
    markerY.push(yIndex);
    markerZ.push(group.value);
    text.push(`${group.key.join(' · ')}<br>${formatFieldValue(group.value, mappings.z, {canonical:true})}`);
  });
  const markerColors = categoricalColors(aggregation.groups.map((group) => group.key.join(' · ')), settings.palette);

  return {
    data: [
      {
        type: 'scatter3d',
        mode: 'lines',
        x, y, z,
        line: { color: 'rgba(148,163,184,.48)', width: 2.5 },
        hoverinfo: 'skip',
        showlegend: false,
      },
      {
        type: 'scatter3d',
        mode: 'markers',
        x: markerX,
        y: markerY,
        z: markerZ,
        text,
        marker: {
          size: 9 * settings.markerScale,
          color: markerColors,
          colorscale: toColorscale(getPalette(settings.palette).colors),
          opacity: settings.opacity,
          line: { color: 'rgba(0,0,0,0)', width: 0 },
        },
        hovertemplate: '%{text}<extra></extra>',
        name: mappings.z.label,
      },
      {
        type: 'scatter3d', mode: 'markers', x: markerX, y: markerY, z: markerZ,
        marker: { size: 15 * settings.markerScale, color: markerColors, opacity: 0.10, line: { width: 0 } },
        hoverinfo: 'skip', showlegend: false,
      },
    ],
    layout: buildSceneLayout({ mappings: { ...mappings, y: mappings.series }, settings, ticks: categoryTicks(xCategories, yCategories) }),
    config: buildPlotlyConfig(settings),
    stats: aggregationStats(dataset, aggregation),
  };
}

function matrixFor(aggregation, xField, yField) {
  const xCategories = categoriesFrom(aggregation.groups, 0).sort(categoryComparator(xField));
  const yCategories = categoriesFrom(aggregation.groups, 1).sort(categoryComparator(yField));
  const z = yCategories.map(() => xCategories.map(() => null));
  aggregation.groups.forEach((group) => {
    z[yCategories.indexOf(group.key[1])][xCategories.indexOf(group.key[0])] = group.value;
  });
  return { xCategories, yCategories, z };
}

function buildSurface(dataset, mappings, settings) {
  const aggregation = aggregateForChart(dataset, mappings, settings, mappings.y);
  const matrix = matrixFor(aggregation, mappings.x, mappings.y);
  const xValues = matrix.xCategories.map((_, index) => index);
  const yValues = matrix.yCategories.map((_, index) => index);
  return {
    data: [{
      type: 'surface',
      x: xValues,
      y: yValues,
      z: matrix.z,
      colorscale: toColorscale(getPalette(settings.palette).colors),
      opacity: settings.opacity,
      connectgaps: false,
      colorbar: { title: mappings.z.label, thickness: 12, len: 0.58 },
      contours: { z: { show: true, usecolormap: true, highlightcolor: '#FFFFFF', project: { z: true } } },
      hovertemplate: `${mappings.x.label}: %{x}<br>${mappings.y.label}: %{y}<br>${mappings.z.label}: %{z:,.2f}<extra></extra>`,
    }],
    layout: buildSceneLayout({ mappings, settings, ticks: categoryTicks(matrix.xCategories, matrix.yCategories) }),
    config: buildPlotlyConfig(settings),
    stats: aggregationStats(dataset, aggregation),
  };
}

function buildRibbons(dataset, mappings, settings) {
  const aggregation = aggregateForChart(dataset, mappings, settings, mappings.series);
  const matrix = matrixFor(aggregation, mappings.x, mappings.series);
  const colors = getPalette(settings.palette).colors;
  const xValues = matrix.xCategories.map((_, index) => index);
  const data = matrix.yCategories.map((series, seriesIndex) => {
    const color = colors[seriesIndex % colors.length];
    const zRow = matrix.z[seriesIndex];
    return {
      type: 'surface',
      name: series,
      x: [xValues, xValues],
      y: [xValues.map(() => seriesIndex - 0.28), xValues.map(() => seriesIndex + 0.28)],
      z: [zRow, [...zRow]],
      colorscale: [[0, color], [1, color]],
      showscale: false,
      opacity: settings.opacity,
      connectgaps: false,
      hovertemplate: `${series}<br>${mappings.z.label}: %{z:,.2f}<extra></extra>`,
    };
  });
  return {
    data,
    layout: buildSceneLayout({ mappings: { ...mappings, y: mappings.series }, settings, ticks: categoryTicks(matrix.xCategories, matrix.yCategories) }),
    config: buildPlotlyConfig(settings),
    stats: aggregationStats(dataset, aggregation),
  };
}

function buildLine(dataset, mappings, settings) {
  const aggregation = aggregateForChart(dataset, mappings, settings, mappings.series);
  const matrix = matrixFor(aggregation, mappings.x, mappings.series);
  const colors = getPalette(settings.palette).colors;
  const traces = matrix.yCategories.map((series, seriesIndex) => {
    const points = matrix.z[seriesIndex]
      .map((value, xIndex) => ({ value, xIndex }))
      .filter(({ value }) => value !== null && Number.isFinite(value));
    return {
      type: 'scatter3d',
      mode: 'lines+markers',
      name: series,
      x: points.map(({ xIndex }) => xIndex),
      y: points.map(() => seriesIndex),
      z: points.map(({ value }) => value),
      text: points.map(({ xIndex, value }) => `${matrix.xCategories[xIndex]} · ${series}<br>${formatFieldValue(value, mappings.z, {canonical:true})}`),
      line: { color: colors[seriesIndex % colors.length], width: 7 },
      marker: { color: colors[seriesIndex % colors.length], size: 5 * settings.markerScale, line: { color: '#fff', width: 0.7 } },
      hovertemplate: '%{text}<extra></extra>',
    };
  });
  return {
    data: traces,
    layout: buildSceneLayout({ mappings: { ...mappings, y: mappings.series }, settings, ticks: categoryTicks(matrix.xCategories, matrix.yCategories) }),
    config: buildPlotlyConfig(settings),
    stats: aggregationStats(dataset, aggregation),
  };
}

function buildMesh(dataset, mappings, settings) {
  const points = dataset.rows.map((row) => ({
    x: valueFor(row, mappings.x), y: valueFor(row, mappings.y), z: valueFor(row, mappings.z), row,
  })).filter(({ x, y, z }) => [x, y, z].every((value) => typeof value === 'number' && Number.isFinite(value)));
  const pointLimit = Math.max(100, Math.min(5_000, Math.floor(settings.pointLimit)));
  const limited = deterministicSample(points, pointLimit, ({ x, y, z }) => `${x}|${y}|${z}`);
  return {
    data: [{
      type: 'mesh3d',
      x: limited.map((point) => point.x),
      y: limited.map((point) => point.y),
      z: limited.map((point) => point.z),
      intensity: limited.map((point) => mappings.color ? valueFor(point.row, mappings.color) : point.z),
      colorscale: toColorscale(getPalette(settings.palette).colors),
      opacity: settings.opacity,
      alphahull: 0,
      flatshading: false,
      lighting: { ambient: 0.45, diffuse: 0.75, specular: 0.55, roughness: 0.35, fresnel: 0.2 },
      colorbar: { title: mappings.color?.label ?? mappings.z.label, thickness: 12, len: 0.58 },
      hovertemplate: `${mappings.x.label}: %{x}<br>${mappings.y.label}: %{y}<br>${mappings.z.label}: %{z}<extra></extra>`,
    }],
    layout: buildSceneLayout({ mappings, settings }),
    config: buildPlotlyConfig(settings),
    stats: { sourceRows: dataset.rows.length, validRows: points.length, renderedPoints: limited.length, excludedRows: dataset.rows.length - points.length, downsampled: limited.length < points.length, sampledOutRows: points.length - limited.length, samplingStrategy: limited.length < points.length ? 'deterministic-hash' : 'none' },
  };
}

export function buildChartSpec(chartType, dataset, mappings, inputSettings = {}) {
  const settings = normalizeSettings(inputSettings);
  if (!dataset?.rows?.length) throw new Error('Import a spreadsheet with at least one data row.');
  if (chartType === 'bubble' || chartType === 'scatter3d') return buildScatter3d(dataset, mappings, settings);
  if (chartType === 'columns') return buildColumns(dataset, mappings, settings);
  if (chartType === 'lollipop') return buildLollipop(dataset, mappings, settings);
  if (chartType === 'surface' || chartType === 'surface3d') return buildSurface3d(dataset, mappings, settings);
  throw new Error(`Unsupported chart type: ${chartType}`);
}
