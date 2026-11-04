export function hydrateChartState(state, chartId, resolveField, contractToLegacy = {}) {
  const chart = state.charts.find((candidate) => candidate.id === chartId);
  if (!chart) return null;
  state.activeChartId = chartId;
  state.chartType = contractToLegacy[chart.chartType] ?? chart.chartType;
  state.mappings = Object.fromEntries(Object.entries(chart.mappings ?? {})
    .map(([role, fieldId]) => [role, resolveField(fieldId)])
    .filter(([, field]) => field));
  state.settings = { ...state.settings, ...chart.settings, title: chart.title };
  return chart;
}
