import { profileColumn } from './semantic/profile-column.js';
import { MAX_ROWS, MAX_COLUMNS, MAX_WORKBOOK_BYTES, MAX_CELL_LENGTH, MAX_SOURCE_ROWS, SUPPORTED_FILE_PATTERN, SUPPORTED_FILE_MESSAGE, normalizeImportOptions } from './import/limits.js';
import { parseTextWorkbook } from './import/tabular.js';

function requireEngine(engine) {
  if (!engine?.read || !engine?.utils) {
    throw new Error('The local spreadsheet engine is unavailable. Reload the application and try again.');
  }
  return engine;
}

function normalizedHeader(value, index, used) {
  const base = String(value ?? '').trim() || `Column ${index + 1}`;
  let label = base;
  let suffix = 2;
  while (used.has(label.toLowerCase())) {
    label = `${base} (${suffix})`;
    suffix += 1;
  }
  used.add(label.toLowerCase());
  return label;
}

export function parseWorkbook(arrayBuffer, fileName, engine = globalThis.XLSX, inputOptions = {}) {
  const xlsx = requireEngine(engine);
  const options = normalizeImportOptions(inputOptions);
  if (!SUPPORTED_FILE_PATTERN.test(fileName ?? '')) {
    throw new Error(SUPPORTED_FILE_MESSAGE);
  }
  if (arrayBuffer.byteLength > MAX_WORKBOOK_BYTES) throw new Error('This file exceeds the 250 MB local import limit.');
  if (!arrayBuffer || typeof arrayBuffer.byteLength !== 'number' || arrayBuffer.byteLength === 0) {
    throw new Error('The selected file is empty or could not be read.');
  }

  let workbook;
  try {
    workbook = parseTextWorkbook(arrayBuffer, fileName, xlsx, options) ?? xlsx.read(arrayBuffer, {
      type: 'array',
      cellDates: true,
      cellNF: true,
      cellText: true,
      dense: false,
      raw: true,
      cellHTML: false,
      bookVBA: false,
    });
  } catch (error) {
    throw new Error(`The spreadsheet could not be parsed: ${error?.message ?? 'unknown format error'}`);
  }

  const sheetNames = workbook.SheetNames.filter((name) => workbook.Sheets[name]);
  if (sheetNames.length === 0) throw new Error('The workbook does not contain any readable sheets.');
  return { workbook, sheetNames, fileName };
}

export function sheetToDataset(workbook, sheetName, engine = globalThis.XLSX, inputOptions = {}) {
  const xlsx = requireEngine(engine);
  const options = normalizeImportOptions(inputOptions);
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) throw new Error(`The sheet “${sheetName}” was not found.`);

  const reference = sheet['!ref'];
  if (!reference || typeof xlsx.utils.decode_range !== 'function') throw new Error(`The sheet “${sheetName}” does not contain tabular data.`);
  const range = xlsx.utils.decode_range(reference);
  if (![range.s.r, range.s.c, range.e.r, range.e.c].every(Number.isSafeInteger) || range.s.r < 0 || range.s.c < 0 || range.e.r < range.s.r || range.e.c < range.s.c) throw new Error('The sheet range is invalid.');
  if (range.e.r - range.s.r + 1 > MAX_SOURCE_ROWS) throw new Error('The sheet exceeds the 200,000 physical-row safety limit. Remove unused or blank rows.');
  const usedColumnCount = range.e.c - range.s.c + 1;
  if (usedColumnCount > MAX_COLUMNS) throw new Error(`The sheet “${sheetName}” contains more than the certified 100 columns. Remove unused columns and try again.`);

  const cellAt = (rowIndex, columnIndex) => sheet[xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex })];
  const valueAt = (rowIndex, columnIndex) => cellAt(rowIndex, columnIndex)?.v ?? null;
  let headerRowIndex = -1;
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    let populated = false;
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const value = valueAt(rowIndex, columnIndex);
      if (value !== null && value !== undefined && value !== '') { populated = true; break; }
    }
    if (populated) { headerRowIndex = rowIndex; break; }
  }
  if (sheet['!prism']?.structured) headerRowIndex = range.s.r;
  if (headerRowIndex < 0) throw new Error(`The sheet “${sheetName}” does not contain tabular data.`);
  if (!sheet['!prism']?.structured && options.headerRow) headerRowIndex = options.headerRow - 1;
  if (headerRowIndex < range.s.r || headerRowIndex > range.e.r) throw new Error('The selected header row is outside the table.');

  const headerRow = Array.from({ length: usedColumnCount }, (_, index) => valueAt(headerRowIndex, range.s.c + index));
  const lastHeaderColumn = usedColumnCount - 1;
  if (lastHeaderColumn < 0) throw new Error(`The sheet “${sheetName}” does not contain tabular data.`);

  const usedHeaders = new Set();
  const headerless = options.headerless && !sheet['!prism']?.structured;
  const labels = Array.from({ length: lastHeaderColumn + 1 }, (_, index) => normalizedHeader(headerless ? null : headerRow[index], index, usedHeaders));
  if (labels.some(label => label.length > 1_000)) throw new Error('A column header exceeds the 1,000-character safety limit.');
  const rows = [];
  const sourceRowIndexes = [];
  let formulaMissing = 0;
  for (let sourceRowIndex = headerRowIndex + (headerless ? 0 : 1); sourceRowIndex <= range.e.r; sourceRowIndex += 1) {
    const row = {};
    let populated = false;
    for (let columnIndex = 0; columnIndex < labels.length; columnIndex += 1) {
      const value = valueAt(sourceRowIndex, range.s.c + columnIndex);
      if (typeof value === 'string' && value.length > MAX_CELL_LENGTH) throw new Error('A cell exceeds the 65,536-character safety limit.');
      if (cellAt(sourceRowIndex, range.s.c + columnIndex)?.f && value === null) { formulaMissing++; populated = true; }
      row[`c${columnIndex}`] = value;
      if (value !== null && value !== undefined && value !== '') populated = true;
    }
    if (!populated) continue;
    if (rows.length >= MAX_ROWS) {
      throw new Error(`The sheet “${sheetName}” contains more than the supported 50,000 data rows. Filter or split the source file and try again; Prism will not silently exclude records.`);
    }
    rows.push(row);
    sourceRowIndexes.push(sourceRowIndex);
  }

  if (rows.length === 0) throw new Error(`The sheet “${sheetName}” does not contain tabular data below its header row.`);

  const fields = labels.map((label, columnIndex) => {
    const fieldId = `c${columnIndex}`;
    const cells = sourceRowIndexes.map((sourceRowIndex, rowIndex) => {
      const sourceCell = cellAt(sourceRowIndex, range.s.c + columnIndex);
      return {
        value: rows[rowIndex][fieldId],
        formatted: sourceCell?.w,
        format: sourceCell?.z ?? 'General',
        rawType: sourceCell?.t,
      };
    });
    const inference = profileColumn({ id: fieldId, label, interpretation: options }, cells);
    const values = cells.map(({ value }) => value).filter((value) => value !== null && value !== undefined && value !== '');
    const uniqueCount = new Set(values.map((value) => value instanceof Date ? value.toISOString() : String(value))).size;

    return {
      ...inference,
      nullable: values.length < rows.length,
      uniqueCount,
      sample: values.slice(0, 3),
    };
  });

  if (!fields.some(field => field.roleKind === 'measure')) {
    let label = 'Record count';
    if (labels.includes(label)) label += ' (generated)';
    fields.push({ id: '__record_count', label, type: 'number', semanticType: 'number', roleKind: 'measure', synthetic: true, defaultAggregation: 'count', confidence: 1, uniqueCount: 1, quality: { nullCount:0, invalidCount:0, distinctCount:1 }, statistics:{ nonEmpty:rows.length,valid:rows.length,total:rows.length,min:1,max:1,varying:false }, sample:[1] });
    for (const row of rows) row.__record_count = 1;
  }
  return {
    fields,
    rows,
    rowCount: rows.length,
    sheetName,
    truncated: false,
    importOptions: options,
    importDiagnostics: {
      format: sheet['!prism']?.format ?? 'workbook',
      delimiter: sheet['!prism']?.delimiter,
      headerRow: headerRowIndex + 1, headerless,
      irregularRows: sheet['!prism']?.rowWidths?.slice(headerRowIndex + (headerless ? 0 : 1)).filter(width => width !== (sheet['!prism'].rowWidths[headerRowIndex] ?? usedColumnCount)).length ?? 0,
      formulaMissing,
    },
  };
}

export function chooseInitialSheet(parsed, engine = globalThis.XLSX, options = {}) {
  const errors = [];
  for (const sheetName of parsed.sheetNames) {
    try {
      return sheetToDataset(parsed.workbook, sheetName, engine, options);
    } catch (error) {
      errors.push(`${sheetName}: ${error.message}`);
      // Continue to the next sheet; the UI reports an error only if all sheets are empty.
    }
  }
  throw new Error(`No readable table. ${errors.join(' ').slice(0, 2_000)}`);
}
