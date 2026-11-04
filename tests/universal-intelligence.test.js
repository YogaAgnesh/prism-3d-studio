import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { coerceFieldValue, parseNumericValue, formatFieldValue } from '../src/data-types.js';
import { profileColumn } from '../src/semantic/profile-column.js';
import { recommendVisualizations } from '../src/charts/recommend.js';
import { parseWorkbook, chooseInitialSheet } from '../src/workbook.js';
import { buildChartSpec } from '../src/chart-builders.js';
import { compileFilter } from '../src/query/filter-compiler.js';
import { compileCalculation } from '../src/query/calculation-parser.js';
import { buildSurface3d } from '../src/charts/build-surface3d.js';

const profile = (label, values, interpretation) => profileColumn({id:label,label,interpretation}, values.map(value => ({value})));
test('strict numeric conversion handles exponents and rejects embedded text', () => {
  assert.equal(parseNumericValue('1.2e3'), 1200);
  assert.equal(parseNumericValue('invoice 123'), null);
  assert.equal(parseNumericValue('12.3.4'), null);
  assert.equal(coerceFieldValue('unknown', {type:'boolean'}), null);
  assert.equal(coerceFieldValue('FALSE', {type:'boolean'}), false);
});
test('identifiers preserve leading zeros and integers exceeding safe precision', () => {
  assert.equal(profile('Code', ['00123', '00124']).semanticType, 'identifier');
  assert.equal(profile('Key', ['9007199254740993', '9007199254740994']).type, 'text');
  assert.equal(profile('Key', ['-9007199254740993', '-9007199254740992']).type, 'text');
});
test('canonical aggregates and filter thresholds are not scaled twice', () => {
  const field={id:'rate',label:'Rate',type:'percent',interpretation:{percentScale:'whole'}};
  assert.equal(formatFieldValue(0.5,field,{canonical:true}),'50%');
  const predicate=compileFilter({kind:'condition',fieldId:'rate',operator:'gt',value:0.25,valueCanonical:true},[field]);
  assert.equal(predicate({rate:25}),false);
  assert.equal(predicate({rate:75}),true);
});
test('locale/date/percent controls share conversion rules with filters', () => {
  const interpretation = {numericLocale:'decimal-comma',dateOrder:'dmy',percentScale:'whole'};
  assert.equal(coerceFieldValue('1.234,50', {type:'number',interpretation}), 1234.5);
  assert.equal(coerceFieldValue('2026-02-30', {type:'date'}), null);
  assert.equal(coerceFieldValue('01/02/2026', {type:'date'}), null);
  assert.equal(coerceFieldValue('01/02/2026', {type:'date',interpretation}).toISOString().slice(0,10), '2026-02-01');
  assert.equal(coerceFieldValue('25', {type:'percent',interpretation}), 0.25);
  const f = profile('Temperature', ['1.234,50','2.345,50'], interpretation);
  assert.equal(f.type, 'number');
  assert.equal(compileFilter({kind:'condition',fieldId:f.id,operator:'gt',value:1500},[f])({[f.id]:'2.345,50'}), true);
});
test('generic measurements and rates default to average, mixed currencies remain text', () => {
  assert.equal(profile('Temperature', [20,30]).defaultAggregation, 'average');
  assert.equal(profile('Rate', [0.1,0.2]).defaultAggregation, 'average');
  assert.equal(profile('Revenue USD', [20,30]).defaultAggregation, 'sum');
  const mixed = profile('Revenue', ['$10','€20']);
  assert.equal(mixed.type, 'text');
  assert.match(mixed.warnings.join(' '), /currenc/i);
});
test('three varying numeric fields receive a domain-neutral relationship chart', () => {
  const fields = ['Temperature','Pressure','Velocity'].map((name,i) => ({...profile(name,[i+1,i+2,i+3]),id:'c'+i}));
  const candidates = recommendVisualizations(fields);
  assert.equal(candidates[0].chartType, 'scatter3d');
  assert.equal(new Set(Object.values(candidates[0].mappings)).size, 3);
  assert.doesNotMatch(candidates[0].title, /opportunit|sales/i);
  assert.equal(recommendVisualizations([...fields,profile('Sensor',['A','B','A'])])[0].chartType,'scatter3d');
  assert.equal(recommendVisualizations([profile('Constant',[2,2,2])]).length, 0);
});
test('category-only tables materialize an explicit count measure and reconcile full rows', () => {
  const p = parseWorkbook(new TextEncoder().encode('Department,Status\nLab,Open\nLab,Closed\nOffice,Open').buffer, 'tickets.csv', XLSX);
  const d = chooseInitialSheet(p, XLSX);
  const count = d.fields.find(f => f.synthetic);
  assert.equal(count.label,'Record count');
  const rec = recommendVisualizations(d.fields,d.rows)[0];
  assert.equal(rec.settings.aggregation,'count');
  const mappings = Object.fromEntries(Object.entries(rec.mappings).map(([k,id]) => [k,d.fields.find(f => f.id === id)]));
  const chart = buildChartSpec('columns',d,mappings,rec.settings);
  assert.equal(chart.stats.sourceRows,3);
  assert.equal(chart.stats.groups,3);
});
test('surfaces require observed grid density and do not suggest a sparse invented grid', () => {
  const fields = [profile('Group',['A','B','C']),profile('Band',['X','Y','Z']),profile('Measure',[1,2,3])];
  const rows = Array.from({length:3},(_,i) => ({Group:['A','B','C'][i],Band:['X','Y','Z'][i],Measure:i+1}));
  assert.equal(recommendVisualizations(fields,rows).some(r => r.chartType==='surface3d'),false);
});
test('calculations use the same localized typed values as chart axes', () => {
  const f = profile('Temperature',['1.234,50','2.345,50'],{numericLocale:'decimal-comma'});
  const calc = compileCalculation('[Temperature] * 2',[f]);
  assert.equal(calc.evaluate({Temperature:'1.234,50'}),2469);
});
test('surface grids enforce budgets and explicit binning reconciles all source rows', () => {
  const rows = Array.from({length:100},(_,i) => ({x:i,y:i,z:i+1}));
  const mappings = Object.fromEntries(['x','y','z'].map(id => [id,{id,label:id,type:'number',semanticType:'number'}]));
  assert.throws(() => buildSurface3d({rows},mappings), /2,500|binning/i);
  const spec = buildSurface3d({rows},mappings,{surfaceBinning:true,surfaceBins:10,aggregation:'count'});
  assert.equal(spec.stats.binned,true);
  assert.equal(spec.stats.gridCells,100);
  assert.equal(spec.data[0].z.flat().filter(v => v !== null).reduce((a,b) => a+b,0),100);
  assert.match(spec.layout.scene.xaxis.ticktext[0], /to/);
});
test('boolean synonyms use the same category coordinates and aggregate groups', () => {
  const p=parseWorkbook(new TextEncoder().encode('Flag,Value\ntrue,10\nyes,20\nfalse,30\nno,40').buffer,'flags.csv',XLSX);
  const d=chooseInitialSheet(p,XLSX);
  const mappings={x:d.fields[0],z:d.fields[1]};
  const chart=buildChartSpec('columns',d,mappings,{aggregation:'sum'});
  assert.equal(chart.stats.groups,2);
  const surface=buildSurface3d({rows:d.rows.map(row=>({...row,band:'A'}))},{...mappings,y:{id:'band',label:'Band',type:'text'}});
  assert.equal(surface.stats.groups,2);
});
