import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import { parseWorkbook, sheetToDataset } from '../src/workbook.js';

function makeWorkbookBytes() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Account Name', 'Split Amount (USD)', 'Probability (%)', 'Expected Close Date', 'GPS Client Account'],
    ['Acme Corp', 1250000, 0.72, new Date('2026-09-30T00:00:00Z'), true],
    ['Northwind', 845000, 0.4, new Date('2026-11-15T00:00:00Z'), false],
  ], { cellDates: true });
  sheet.B2.z = '$#,##0.00';
  sheet.B3.z = '$#,##0.00';
  sheet.C2.z = '0%';
  sheet.C3.z = '0%';
  sheet.D2.z = 'dd-mmm-yyyy';
  sheet.D3.z = 'dd-mmm-yyyy';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Pipeline');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Region'], ['US']]), 'Lookup');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellDates: true });
}

test('parses workbook bytes locally and lists available sheets', () => {
  const parsed = parseWorkbook(makeWorkbookBytes(), 'salesforce-pipeline.xlsx', XLSX);
  assert.deepEqual(parsed.sheetNames, ['Pipeline', 'Lookup']);
  assert.equal(parsed.fileName, 'salesforce-pipeline.xlsx');
});

test('creates row objects and preserves Salesforce column labels', () => {
  const parsed = parseWorkbook(makeWorkbookBytes(), 'salesforce-pipeline.xlsx', XLSX);
  const dataset = sheetToDataset(parsed.workbook, 'Pipeline', XLSX);

  assert.equal(dataset.rowCount, 2);
  assert.deepEqual(dataset.fields.map((field) => field.label), [
    'Account Name',
    'Split Amount (USD)',
    'Probability (%)',
    'Expected Close Date',
    'GPS Client Account',
  ]);
  assert.equal(dataset.rows[0].c0, 'Acme Corp');
  assert.equal(dataset.rows[1].c1, 845000);
});

test('uses cell formats to infer workbook field semantics', () => {
  const parsed = parseWorkbook(makeWorkbookBytes(), 'salesforce-pipeline.xlsx', XLSX);
  const dataset = sheetToDataset(parsed.workbook, 'Pipeline', XLSX);
  const types = Object.fromEntries(dataset.fields.map((field) => [field.label, field.type]));

  assert.deepEqual(types, {
    'Account Name': 'text',
    'Split Amount (USD)': 'currency',
    'Probability (%)': 'percent',
    'Expected Close Date': 'date',
    'GPS Client Account': 'boolean',
  });
});

test('reads worksheet cells directly without materializing a full sheet matrix', () => {
  const parsed = parseWorkbook(makeWorkbookBytes(), 'salesforce-pipeline.xlsx', XLSX);
  const boundedEngine = {
    ...XLSX,
    utils: {
      ...XLSX.utils,
      sheet_to_json: () => { throw new Error('full matrix materialization is forbidden'); },
    },
  };

  const dataset = sheetToDataset(parsed.workbook, 'Pipeline', boundedEngine);
  assert.equal(dataset.rowCount, 2);
  assert.equal(dataset.rows[0].c0, 'Acme Corp');
});

test('rejects unsupported file extensions and empty sheets with actionable messages', () => {
  assert.throws(() => parseWorkbook(new ArrayBuffer(0), 'pipeline.pdf', XLSX), /xlsx.*ndjson/i);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
  assert.throws(() => sheetToDataset(workbook, 'Empty', XLSX), /does not contain tabular data/i);
});

test('rejects worksheets beyond the 50,000-row boundary instead of silently truncating', () => {
  const rowCount = 50_001;
  const engine = {
    read: () => ({}),
    utils: {
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: rowCount, c: 0 } }),
      encode_cell: ({ r, c }) => `${r}:${c}`,
    },
  };
  const sheet = new Proxy({ '!ref': `A1:A${rowCount + 1}` }, {
    get(target, property) {
      if (property in target) return target[property];
      const [row, column] = String(property).split(':').map(Number);
      if (column !== 0 || !Number.isInteger(row)) return undefined;
      return { v: row === 0 ? 'Opportunity ID' : row, t: row === 0 ? 's' : 'n' };
    },
  });
  const workbook = { Sheets: { Sales: sheet } };
  assert.throws(() => sheetToDataset(workbook, 'Sales', engine), /more than the supported 50,000 data rows/i);
});

test('rejects worksheets wider than the certified 100-column boundary', () => {
  const engine = { read: () => ({}), utils: { decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 100 } }), encode_cell: ({ r, c }) => `${r}:${c}` } };
  assert.throws(() => sheetToDataset({ Sheets: { Wide: { '!ref': 'A1:CW2' } } }, 'Wide', engine), /100 columns/i);
});
