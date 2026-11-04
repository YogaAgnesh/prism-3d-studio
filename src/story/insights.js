const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function quantile(sorted, ratio) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function compact(value) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function traceValues(trace) {
  for (const key of ['z', 'marker.color', 'y', 'x']) {
    const source = key === 'marker.color' ? trace.marker?.color : trace[key];
    const values = Array.isArray(source) ? source.flat(Infinity) : [];
    if (values.filter(finite).length >= 3) return { key, values };
  }
  return null;
}

function pointLabel(trace, index) {
  for (const values of [trace.text, trace.hovertext, trace.customdata, trace.x, trace.y]) {
    const value = Array.isArray(values) ? values[index] : null;
    if (value !== null && value !== undefined && typeof value !== 'object') return String(value).slice(0, 80);
  }
  return `Point ${index + 1}`;
}

export function deriveChartInsights(spec) {
  const trace = spec?.data?.find((candidate) => traceValues(candidate));
  const selected = trace && traceValues(trace);
  if (!selected) return [];
  const indexed = selected.values.map((value, index) => ({ value, index })).filter((item) => finite(item.value));
  if (indexed.length < 3) return [];
  const sorted = indexed.map((item) => item.value).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const outliers = indexed.filter((item) => item.value < lower || item.value > upper);
  const axisTitle = spec.layout?.scene?.[`${selected.key === 'marker.color' ? 'z' : selected.key}axis`]?.title?.text || 'plotted measure';
  const insights = [];
  if (outliers.length) {
    const strongest = [...outliers].sort((a, b) => Math.abs(b.value - quantile(sorted, 0.5)) - Math.abs(a.value - quantile(sorted, 0.5)))[0];
    insights.push({
      id: 'outliers', title: 'Potential outlier detected',
      takeaway: `${pointLabel(trace, strongest.index)} sits outside the expected ${axisTitle} range at ${compact(strongest.value)}.`,
      metric: { label: 'Potential outliers', value: String(outliers.length) },
      method: '1.5× IQR rule on the rendered values',
    });
  }
  const minimum = sorted[0];
  const maximum = sorted.at(-1);
  insights.push({
    id: 'range', title: outliers.length ? 'Rendered range' : 'Distribution range',
    takeaway: `${indexed.length.toLocaleString()} rendered values span ${compact(minimum)} to ${compact(maximum)} on ${axisTitle}.`,
    metric: { label: 'Rendered points', value: indexed.length.toLocaleString() },
    method: 'Descriptive range of the rendered chart values',
  });
  return insights.slice(0, 3);
}
