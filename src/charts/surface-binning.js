export function binSurfaceAxis(axis, count = 20) {
  if (axis.axisType !== 'linear') return axis;
  const bins = Math.max(2,Math.min(50,Math.floor(Number(count) || 20)));
  let min = Infinity, max = -Infinity;
  for (const value of axis.values) if (Number.isFinite(value)) { min=Math.min(min,value); max=Math.max(max,value); }
  if (!(max > min)) return axis;
  const width = (max-min)/bins;
  const labels = Array.from({length:bins},(_,i) => `${Number((min+i*width).toPrecision(5))} to ${Number((min+(i+1)*width).toPrecision(5))}${i===bins-1 ? ' (inclusive)' : ' (upper exclusive)'}`);
  return { ...axis, values:axis.values.map(v => Number.isFinite(v) ? Math.min(bins-1,Math.floor((v-min)/width)) : null), ticks:{values:labels.map((_,i)=>i),text:labels}, binned:true };
}
