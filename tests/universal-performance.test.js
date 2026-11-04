import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
import * as XLSX from 'xlsx';
import {parseWorkbook,chooseInitialSheet} from '../src/workbook.js';
import {recommendVisualizations} from '../src/charts/recommend.js';
import {buildChartSpec} from '../src/chart-builders.js';
import {compileFilter} from '../src/query/filter-compiler.js';

test('profiles and queries representative 50,000 by 20 numeric and mixed tables within bounded budgets', () => {
  const results=[];
  for (const mode of ['numeric','mixed']) {
    const headers=Array.from({length:20},(_,i)=>'Measure '+i);
    const source=[headers.join(','),...Array.from({length:50_000},(_,r)=>headers.map((_,c)=> mode==='mixed' && c%4===0 ? 'Group '+r%10 : (r*(c+1))%997+'.25').join(','))].join('\n');
    const before=process.memoryUsage(); const started=performance.now();
    const parsed=parseWorkbook(new TextEncoder().encode(source).buffer,'performance.csv',XLSX);
    const d=chooseInitialSheet(parsed,XLSX); const profileMs=performance.now()-started;
    assert.equal(d.rowCount,50_000); assert.equal(d.fields.length,20);
    const rec=recommendVisualizations(d.fields,d.rows)[0];
    const mappings=Object.fromEntries(Object.entries(rec.mappings).map(([role,id])=>[role,d.fields.find(f=>f.id===id)]));
    const queryStart=performance.now();
    const predicate=compileFilter({kind:'condition',fieldId:d.fields[1].id,operator:'gt',value:500},d.fields);
    const rows=d.rows.filter(predicate);
    const spec=buildChartSpec('bubble',{...d,rows},mappings,rec.settings);
    const queryMs=performance.now()-queryStart;
    assert.ok(spec.stats.renderedPoints<=8000);
    assert.ok(profileMs<10_000,`${mode} profile ${profileMs.toFixed()}ms`);
    assert.ok(queryMs<2_000,`${mode} query ${queryMs.toFixed()}ms`);
    results.push({mode,rows:50_000,columns:20,sourceBytes:Buffer.byteLength(source),profileMs:Math.round(profileMs),queryMs:Math.round(queryMs),heapDeltaMiB:Math.round((process.memoryUsage().heapUsed-before.heapUsed)/1024/1024),rendered:spec.stats.renderedPoints});
  }
  writeFileSync(new URL('../artifacts/universal-performance.json',import.meta.url),JSON.stringify({date:'2026-10-05',runtime:process.version,os:os.version(),cpu:os.cpus()[0].model,results},null,2));
});
