import { coerceFieldValue, formatFieldValue } from '../data-types.js';
import { getPalette, toColorscale } from '../palettes.js';
import { encodeAxis } from './axis-encoding.js';
import { buildPlotlyConfig, buildSceneLayout } from './scene.js';
import { binSurfaceAxis } from './surface-binning.js';

function aggregate(values, operation) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return null;
  if (operation === 'average' || operation === 'mean') return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  if (operation === 'minimum' || operation === 'min') return Math.min(...valid);
  if (operation === 'maximum' || operation === 'max') return Math.max(...valid);
  if (operation === 'median') {
    const sorted = [...valid].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  if (operation === 'count') return valid.length;
  return valid.reduce((sum, value) => sum + value, 0);
}

function coordinateComparator(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function tickLabel(axis, value) {
  if (!axis.ticks) return String(value);
  const index = axis.ticks.values.indexOf(value);
  return index >= 0 ? axis.ticks.text[index] : String(value);
}

export function buildSurface3d(dataset, mappings, inputSettings = {}) {
  const settings = {
    palette: 'spectrum', aggregation: 'sum', opacity: 0.95,
    showSurface: true, showContours: true, projectContours: true, connectGaps: false,
    ...inputSettings,
  };
  const rows = dataset?.rows ?? [];
  let xAxis = encodeAxis(rows.map((row) => row?.[mappings.x.id]), mappings.x);
  let yAxis = encodeAxis(rows.map((row) => row?.[mappings.y.id]), mappings.y);
  if (settings.surfaceBinning) { xAxis = binSurfaceAxis(xAxis,settings.surfaceBins); yAxis = binSurfaceAxis(yAxis,settings.surfaceBins); }
  const cells = new Map();
  let excludedRows = 0;
  rows.forEach((row, index) => {
    const x = xAxis.values[index];
    const y = yAxis.values[index];
    const z = coerceFieldValue(row?.[mappings.z.id], mappings.z);
    if (x === null || y === null || !Number.isFinite(z)) {
      excludedRows += 1;
      return;
    }
    const key = JSON.stringify([x, y]);
    if (!cells.has(key)) cells.set(key, { x, y, z: [], color: [] });
    const cell = cells.get(key);
    cell.z.push(z);
    if (mappings.surfaceColor) {
      const color = coerceFieldValue(row?.[mappings.surfaceColor.id], mappings.surfaceColor);
      if (Number.isFinite(color)) cell.color.push(color);
    }
  });
  const xValues = [...new Set([...cells.values()].map((cell) => cell.x))].sort(coordinateComparator);
  const yValues = [...new Set([...cells.values()].map((cell) => cell.y))].sort(coordinateComparator);
  if (xValues.length*yValues.length > 2_500) throw new Error('The surface exceeds 2,500 grid cells. Enable numeric binning or filter its dimensions.');
  const cellLookup = new Map([...cells.values()].map((cell) => [JSON.stringify([cell.x, cell.y]), cell]));
  const z = yValues.map((y) => xValues.map((x) => {
    const cell = cellLookup.get(JSON.stringify([x, y]));
    return cell ? aggregate(cell.z, settings.aggregation) : null;
  }));
  const surfacecolor = mappings.surfaceColor ? yValues.map((y) => xValues.map((x) => {
    const cell = cellLookup.get(JSON.stringify([x, y]));
    return cell ? aggregate(cell.color, settings.surfaceColorAggregation ?? 'average') : null;
  })) : undefined;
  const customdata = yValues.map((y, yIndex) => xValues.map((x, xIndex) => [
    tickLabel(xAxis, x),
    tickLabel(yAxis, y),
    z[yIndex][xIndex] === null ? 'Missing' : formatFieldValue(z[yIndex][xIndex], mappings.z, {canonical:true}),
  ]));
  const lighting = {
    ambient: 0.65, diffuse: 0.75, specular: 0.35, roughness: 0.4, fresnel: 0.15,
    ...(settings.lighting ?? {}),
  };
  const gridCells = xValues.length * yValues.length;
  const missingCells = gridCells - cells.size;
  const duplicateCells = [...cells.values()].reduce((count, cell) => count + Math.max(0, cell.z.length - 1), 0);
  const colorTitle = mappings.surfaceColor?.label ?? mappings.z.label;
  return {
    data: [{
      type: 'surface',
      x: xValues,
      y: yValues,
      z,
      customdata,
      ...(surfacecolor ? { surfacecolor } : {}),
      colorscale: toColorscale(getPalette(settings.palette).colors),
      reversescale: Boolean(settings.reverseColorScale),
      cmin: Number.isFinite(Number(settings.colorMin)) ? Number(settings.colorMin) : undefined,
      cmax: Number.isFinite(Number(settings.colorMax)) ? Number(settings.colorMax) : undefined,
      opacity: Math.min(Math.max(Number(settings.opacity) || 0.95, 0.05), 1),
      hidesurface: !settings.showSurface,
      connectgaps: Boolean(settings.connectGaps),
      lighting,
      lightposition: settings.lightPosition ?? { x: 900, y: 700, z: 1_200 },
      contours: {
        z: {
          show: Boolean(settings.showContours),
          usecolormap: true,
          highlightcolor: settings.contourHighlightColor ?? '#FFFFFF',
          project: { z: Boolean(settings.projectContours) },
        },
      },
      colorbar: {
        title: { text: colorTitle }, thickness: 14, len: 0.62,
        tickformat: mappings.surfaceColor?.type === 'percent' ? '.0%' : undefined,
      },
      hovertemplate: `${mappings.x.label}: %{customdata[0]}<br>${mappings.y.label}: %{customdata[1]}<br>${mappings.z.label}: %{customdata[2]}<extra></extra>`,
    }],
    layout: buildSceneLayout({ mappings, settings, ticks: { x: xAxis.ticks, y: yAxis.ticks } }),
    config: buildPlotlyConfig(settings),
    stats: {
      sourceRows: rows.length,
      validRows: rows.length - excludedRows,
      excludedRows,
      groups: cells.size,
      gridCells,
      missingCells,
      duplicateCells,
      interpolated: Boolean(settings.connectGaps),
      gridDensity: gridCells ? cells.size / gridCells : 0,
      binned: Boolean(xAxis.binned || yAxis.binned),
    },
  };
}
