import { formatAxisTitle } from './axis-encoding.js';

export const CAMERA_PRESETS = Object.freeze({
  perspective: { eye: { x: 1.55, y: 1.55, z: 1.15 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  isometric: { eye: { x: 1.35, y: 1.35, z: 1.35 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  front: { eye: { x: 0, y: 2.5, z: 0 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  rear: { eye: { x: 0, y: -2.5, z: 0 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  left: { eye: { x: -2.5, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  right: { eye: { x: 2.5, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  top: { eye: { x: 0, y: 0, z: 2.5 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
});

function tokensFor(theme) {
  return theme === 'light'
    ? { title: '#0F172A', text: '#25324A', axis: '#334155', grid: 'rgba(51,65,85,.24)', zero: 'rgba(15,23,42,.38)', scene: 'rgba(241,245,249,.72)' }
    : { title: '#F7F8FF', text: '#C7CFE8', axis: '#9AA7C7', grid: 'rgba(160,174,215,.19)', zero: 'rgba(255,255,255,.22)', scene: '#151B2E' };
}

function finiteRange(settings, axisId) {
  const min = Number(settings[`${axisId}Min`]);
  const max = Number(settings[`${axisId}Max`]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return undefined;
  return settings[`reverse${axisId.toUpperCase()}`] ? [max, min] : [min, max];
}

function buildAxis(axisId, field, settings, ticks) {
  const tokens = tokensFor(settings.theme);
  const range = finiteRange(settings, axisId);
  const showGrid = settings.showGrid ?? settings.grid ?? true;
  const showZeroLine = settings.showZeroLine ?? true;
  const title = settings[`${axisId}Title`] || formatAxisTitle(field);
  return {
    visible: true,
    showline: true,
    showticklabels: true,
    title: { text: title, font: { color: tokens.text, size: 13 } },
    color: tokens.axis,
    linecolor: tokens.axis,
    gridcolor: showGrid ? tokens.grid : 'rgba(0,0,0,0)',
    showgrid: showGrid,
    zeroline: showZeroLine,
    zerolinecolor: tokens.zero,
    showbackground: settings.showAxisPlanes ?? true,
    backgroundcolor: tokens.scene,
    showspikes: settings.showSpikes ?? false,
    autorange: range ? false : settings[`reverse${axisId.toUpperCase()}`] ? 'reversed' : true,
    ...(range ? { range } : {}),
    ...(ticks ? { tickmode: 'array', tickvals: ticks.values, ticktext: ticks.text } : {}),
  };
}

function positiveRatio(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function buildSceneLayout({ mappings = {}, settings = {}, ticks = {} } = {}) {
  const tokens = tokensFor(settings.theme);
  const plotBackground = settings.plotBackground ?? (settings.theme === 'light' ? '#FFFFFF' : '#0E1220');
  const background = settings.background ?? (settings.theme === 'light' ? '#F7F9FD' : '#090B14');
  const projection = settings.projection ?? (settings.perspective === false ? 'orthographic' : 'perspective');
  const preset = settings.authoredCamera ?? CAMERA_PRESETS[settings.camera] ?? CAMERA_PRESETS.perspective;
  const aspectmode = ['auto', 'cube', 'data', 'manual'].includes(settings.aspectmode) ? settings.aspectmode : 'cube';
  const aspectratio = aspectmode === 'manual'
    ? { x: positiveRatio(settings.aspectX), y: positiveRatio(settings.aspectY), z: positiveRatio(settings.aspectZ) }
    : undefined;
  return {
    title: {
      text: settings.title ?? '3D visualization', x: 0.035, y: 0.965, xanchor: 'left',
      font: { family: '-apple-system, BlinkMacSystemFont, SF Pro Display, SF Pro Text, Segoe UI Variable, Segoe UI, sans-serif', size: 22, color: tokens.title },
    },
    paper_bgcolor: background,
    plot_bgcolor: plotBackground,
    font: { family: '-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI Variable, Segoe UI, sans-serif', color: tokens.text },
    margin: { l: 18, r: 18, t: 64, b: 18 },
    showlegend: settings.showLegend ?? true,
    legend: { orientation: 'h', x: 0.02, y: 0.01, bgcolor: 'rgba(0,0,0,0)', font: { size: 11 } },
    scene: {
      bgcolor: plotBackground,
      dragmode: settings.dragmode ?? 'orbit',
      aspectmode,
      ...(aspectratio ? { aspectratio } : {}),
      camera: { ...preset, projection: { type: projection } },
      xaxis: buildAxis('x', mappings.x, settings, ticks.x),
      yaxis: buildAxis('y', mappings.y ?? mappings.series, settings, ticks.y),
      zaxis: buildAxis('z', mappings.z, settings, ticks.z),
    },
  };
}

export function buildPlotlyConfig(settings = {}) {
  const width = Number.isFinite(Number(settings.exportWidth)) ? Number(settings.exportWidth) : 1920;
  const height = Number.isFinite(Number(settings.exportHeight)) ? Number(settings.exportHeight) : 1080;
  return {
    responsive: true,
    displaylogo: false,
    scrollZoom: settings.scrollZoom ?? true,
    displayModeBar: settings.displayModeBar ?? true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
    toImageButtonOptions: { format: 'png', filename: 'prism-3d-chart', width, height, scale: 1 },
  };
}
