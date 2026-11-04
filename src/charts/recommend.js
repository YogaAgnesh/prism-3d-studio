const NUMERIC = new Set(['number','currency','percent','duration']);
import { coerceFieldValue } from '../data-types.js';
import { binSurfaceAxis } from './surface-binning.js';
const EXCLUDED = new Set(['identifier','freeText','url','email']);
const kind = f => f.semanticType ?? f.type;
const coverage = f => f.statistics?.total ? f.statistics.valid / f.statistics.total : 1;

export function recommendVisualizations(fields = [], rows) {
  const measures = fields.filter(f => NUMERIC.has(kind(f)) && (f.synthetic || (f.uniqueCount ?? 2) > 1) && coverage(f) >= 0.6)
    .sort((a,b) => Number(Boolean(b.synthetic)) - Number(Boolean(a.synthetic)) || Number(kind(b)==='currency') - Number(kind(a)==='currency') || coverage(b)-coverage(a));
  const dimensions = fields.filter(f => !NUMERIC.has(kind(f)) && !EXCLUDED.has(kind(f)) && (f.uniqueCount ?? 2) > 1 && (f.uniqueCount ?? 2) <= 50 && coverage(f) >= 0.6)
    .sort((a,b) => (a.uniqueCount ?? 2) - (b.uniqueCount ?? 2) || coverage(b)-coverage(a));
  const results = [];
  const [dimension,series] = dimensions;
  const measure = measures[0];
  if (dimension && measure) {
    const aggregation = measure.synthetic ? 'count' : measure.defaultAggregation === 'sum' ? 'sum' : 'average';
    const mappings = {x:dimension.id,...(series ? {series:series.id} : {}),z:measure.id};
    results.push({chartType:'columns3d',score:94,title:`${measure.label} by ${dimension.label}`,reason:`Compare ${aggregation === 'count' ? 'record counts' : `${aggregation} ${measure.label}`} across ${dimension.label}${series ? ` and ${series.label}` : ' in a single series'}. All included rows contribute before the rendering limit.`,mappings,settings:{aggregation},warnings:series ? [] : ['One analytical category dimension; depth represents a single series.']});
    results.push({chartType:'lollipop3d',score:86,title:`${measure.label} ranking`,reason:`Rank ${dimension.label} using ${aggregation} ${measure.label}.`,mappings,settings:{aggregation},warnings:[]});
    if (series && rows) {
      const validRows = rows.filter(r => r[dimension.id] != null && r[series.id] != null && r[measure.id] != null);
      const pairs = new Set(validRows.map(r => JSON.stringify([String(r[dimension.id]),String(r[series.id])])));
      const grid = (dimension.uniqueCount ?? 0)*(series.uniqueCount ?? 0);
      if (grid <= 2500 && grid >= 4 && pairs.size / grid >= 0.5) results.push({chartType:'surface3d',score:72,title:`${measure.label} grid`,reason:`Observed values occupy ${Math.round(pairs.size/grid*100)}% of the ${dimension.label} × ${series.label} grid. Missing cells remain gaps. Category positions use encoded ordering.`,mappings:{x:dimension.id,y:series.id,z:measure.id},settings:{aggregation,connectGaps:false},warnings:['Categorical positions are encoded; neighboring categories do not imply continuous measurements.']});
    }
  }
  const continuous = measures.filter(f => !f.synthetic);
  if (continuous.length >= 3) {
    const axes = continuous.slice(0,3);
    results.push({chartType:'scatter3d',score:96,title:`${axes[0].label}, ${axes[1].label} and ${axes[2].label}`,reason:'Explore three varying numeric coordinates for relationships, clusters and outliers. No aggregation is applied; rendering may use a disclosed deterministic sample.',mappings:{x:axes[0].id,y:axes[1].id,z:axes[2].id},settings:{},warnings:[]});
    if (rows) {
      const x = binSurfaceAxis({axisType:'linear',values:rows.map(r=>coerceFieldValue(r[axes[0].id],axes[0]))},20);
      const y = binSurfaceAxis({axisType:'linear',values:rows.map(r=>coerceFieldValue(r[axes[1].id],axes[1]))},20);
      const pairs = new Set(rows.map((r,i)=> x.values[i] !== null && y.values[i] !== null && coerceFieldValue(r[axes[2].id],axes[2]) !== null ? JSON.stringify([x.values[i],y.values[i]]) : null).filter(Boolean));
      if (x.binned && y.binned && pairs.size/400 >= 0.5) results.push({chartType:'surface3d',score:75,title:`Binned ${axes[2].label} surface`,reason:`Apply 20 equal-width bins to ${axes[0].label} and ${axes[1].label}, showing average ${axes[2].label}. ${Math.round(pairs.size/4)}% of the binned grid is observed. Missing cells remain gaps.`,mappings:{x:axes[0].id,y:axes[1].id,z:axes[2].id},settings:{aggregation:'average',surfaceBinning:true,surfaceBins:20,connectGaps:false},warnings:['Binning groups continuous observations; values are aggregated, not individual measurements.']});
    }
  } else if (continuous.length && dimensions.length >= 2) {
    results.push({chartType:'scatter3d',score:68,title:`${continuous[0].label} observations`,reason:'Explore individual observations across two encoded category axes and one numeric coordinate. Category spacing is not a measured distance.',mappings:{x:dimensions[0].id,y:dimensions[1].id,z:continuous[0].id},settings:{},warnings:['X and Y are encoded categories, not continuous spatial coordinates.']});
  }
  return results.sort((a,b) => b.score-a.score || a.chartType.localeCompare(b.chartType));
}
