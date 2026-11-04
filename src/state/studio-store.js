export const FIXED_TILE = Object.freeze({ width: 640, height: 420 });

export function createStudioState(overrides = {}) {
  return {
    version: 2,
    theme: 'light',
    mode: 'guided',
    view: 'focus',
    source: null,
    fields: [],
    charts: [],
    filters: [],
    calculations: [],
    story: { title: 'Untitled story', chapters: [], activeChapterId: null },
    activeChartId: null,
    ...overrides,
  };
}

export function addChartTile(state, input = {}) {
  const id = input.id ?? `chart-${state.charts.length + 1}`;
  const chart = {
    id,
    chartType: input.chartType ?? 'scatter3d',
    title: input.title ?? 'Untitled 3D chart',
    mappings: input.mappings ?? {},
    settings: input.settings ?? {},
    tile: { ...FIXED_TILE },
  };
  return { ...state, charts: [...state.charts, chart], activeChartId: id };
}

export function saveChartAndCreateDraft(state, snapshot) {
  const saved = state.charts.some((chart) => chart.id === snapshot.id)
    ? state.charts.map((chart) => chart.id === snapshot.id ? { ...snapshot, tile: { ...FIXED_TILE } } : chart)
    : [...state.charts, { ...snapshot, tile: { ...FIXED_TILE } }];
  let sequence = saved.length + 1;
  while (saved.some((chart) => chart.id === `chart-${sequence}`)) sequence += 1;
  const draft = { ...snapshot, id: `chart-${sequence}`, title: 'New chart', mappings: { ...snapshot.mappings }, settings: { ...snapshot.settings, title: 'New chart' }, tile: { ...FIXED_TILE } };
  return { ...state, charts: [...saved, draft], activeChartId: draft.id };
}

export function updateChartTile(state, chartId, patch) {
  return { ...state, charts: state.charts.map((chart) => chart.id === chartId ? { ...chart, ...patch, tile: { ...FIXED_TILE } } : chart) };
}

export function removeChartTile(state, chartId) {
  const charts = state.charts.filter((chart) => chart.id !== chartId);
  return { ...state, charts, activeChartId: state.activeChartId === chartId ? charts[0]?.id ?? null : state.activeChartId };
}

export function setTheme(state, theme) {
  if (!['light', 'dark'].includes(theme)) throw new Error('Theme must be light or dark.');
  return { ...state, theme };
}
