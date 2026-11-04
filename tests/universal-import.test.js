import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbook, sheetToDataset, chooseInitialSheet } from '../src/workbook.js';
import { validateImportFile } from '../src/security/validate-import.js';

const bytes = (s) => new TextEncoder().encode(s).buffer;
const load = (s, name, options = {}) => {
  const parsed = parseWorkbook(bytes(s), name, XLSX, options);
  return sheetToDataset(parsed.workbook, parsed.sheetNames[0], XLSX, options);
};

test('delimited imports preserve identifiers, scientific notation and quoted multiline content', () => {
  const d = load('Code;Temperature;Notes\r\n0012;1e3;"two; words\nsecond line"\r\n0013;20;"a ""quote"""', 'sensors.csv');
  assert.equal(d.rowCount, 2);
  assert.equal(d.rows[0].c0, '0012');
  assert.equal(d.rows[0].c1, '1e3');
  assert.equal(d.rows[1].c2, 'a "quote"');
  assert.equal(d.importDiagnostics.delimiter, ';');
});

test('TSV and headerless controls preserve first observation and complete columns', () => {
  const d = load('001\t2\t3\n002\t4\t5', 'positions.tsv', { headerless: true });
  assert.equal(d.rowCount, 2);
  assert.equal(d.fields[0].label, 'Column 1');
  const blank = load('Name,,\na,1,2', 'headers.csv');
  assert.deepEqual(blank.fields.map(f => f.label), ['Name', 'Column 2', 'Column 3']);
});

test('explicit header row bypasses report title and discloses irregular rows', () => {
  const d = load('Report\nName,Value\na,1\nb,2,extra', 'report.csv', { headerRow: 2 });
  assert.equal(d.fields[0].label, 'Name');
  assert.equal(d.rowCount, 2);
  assert.equal(d.importDiagnostics.irregularRows, 1);
});

test('JSON selectable tables flatten collision-safe nested scalar paths', () => {
  const p = parseWorkbook(bytes('{"measurements":[{"a":{"b":3},"a/b":4,"flag":true}],"inventory":[{"sku":"001","stock":2}]}'), 'tables.json', XLSX);
  assert.deepEqual(p.sheetNames, ['measurements', 'inventory']);
  const d = sheetToDataset(p.workbook, 'measurements', XLSX);
  assert.equal(d.fields.length, 3);
  assert.equal(new Set(d.fields.map(f => f.label)).size, 3);
  assert.deepEqual(Object.values(d.rows[0]), [3, 4, true]);
});

test('NDJSON reports malformed line and rejects nested arrays without silently multiplying rows', () => {
  assert.equal(load('{"x":1}\n\n{"x":2}', 'events.ndjson').rowCount, 2);
  assert.throws(() => load('{"x":1}\n{bad}', 'events.ndjson'), /line 2/i);
  assert.throws(() => load('[{"items":[1,2]}]', 'events.json'), /nested array/i);
  assert.throws(() => load('a,b\n"unterminated,2', 'bad.csv'), /unterminated/i);
});

test('accepts exactly 50,000 data rows and rejects 50,001 without masking cause', () => {
  const source = 'Value\n' + Array.from({length:50_000}, (_, i) => String(i)).join('\n');
  assert.equal(load(source, 'boundary.csv').rowCount, 50_000);
  const p = parseWorkbook(bytes(source + '\n50000'), 'boundary.csv', XLSX);
  assert.throws(() => chooseInitialSheet(p, XLSX), /50,000/i);
});

test('JSON prototype keys cannot pollute objects and wide inputs reject consistently', () => {
  const d = load('[{"__proto__":"display","constructor":1,"n":2}]', 'keys.json');
  assert.equal(d.fields[0].label, '__proto__');
  assert.equal({}.polluted, undefined);
  const wide = Object.fromEntries(Array.from({length:101}, (_, i) => ['v'+i, i]));
  assert.throws(() => load(JSON.stringify([wide]), 'wide.json'), /100 columns/i);
});
test('empty JSON property paths cannot overwrite another column', () => {
  const d = load('[{"":{"a":1},"a":2}]','empty-key.json');
  assert.equal(d.fields.length,2);
  assert.deepEqual(Object.values(d.rows[0]),[1,2]);
});
test('structured JSON with an empty property name preserves the first observation', () => {
  const single=load('[{"":1}]','empty-name.json');
  assert.equal(single.rowCount,1);
  assert.equal(single.fields[0].label,'Column 1');
  const multiple=load('[{"":1},{"":2}]','empty-name.json');
  assert.deepEqual(multiple.rows.map(r=>r.c0),[1,2]);
});

test('all documented file extensions pass input validation', () => {
  for (const ext of ['xlsx','xlsm','xls','ods','csv','tsv','json','ndjson','jsonl']) {
    assert.equal(validateImportFile({ name:'data.'+ext, size:50 }).ok, true, ext);
  }
});
