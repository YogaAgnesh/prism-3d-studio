import { MAX_COLUMNS, MAX_CELL_LENGTH, MAX_SOURCE_ROWS } from './limits.js';

function checkScalar(value) {
  if (typeof value === 'string' && value.length > MAX_CELL_LENGTH) throw new Error('A cell exceeds the 65,536-character safety limit.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('A JSON value is not a finite number.');
  return value;
}

// Delimiter detection only examines a small prefix. Quoted separators do not vote.
function detectDelimiter(text, extension) {
  if (extension === 'tsv') return '\t';
  const counts = new Map([',', ';', '\t', '|'].map(d => [d, 0]));
  let quoted = false;
  for (const c of text.slice(0, 8_192)) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { checkScalar(cell); row.push(cell); cell = ''; closed = false; if (row.length > MAX_COLUMNS) throw new Error('The table contains more than 100 columns.'); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > MAX_SOURCE_ROWS) throw new Error('The source exceeds the 200,000 physical-row safety limit. Remove unused or blank rows.'); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === delimiter) pushCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"' && !cell && !closed) quoted = true;
    else if (closed && !/\s/.test(c)) throw new Error('Unexpected content after a closing quote. Check the delimiter.');
    else if (!closed) cell += c;
    if (cell.length > MAX_CELL_LENGTH) throw new Error('A cell exceeds the 65,536-character safety limit.');
  }
  if (quoted) throw new Error('Unterminated quoted field in delimited file.');
  if (cell || row.length || closed) pushRow();
  return rows;
}

function flatten(record, prefix = null, result = new Map(), depth = 0) {
  if (depth > 8) throw new Error('JSON objects exceed the eight-level nesting limit.');
  for (const [key, value] of Object.entries(record)) {
    const path = prefix !== null ? `${prefix}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}` : key.replace(/~/g, '~0').replace(/\//g, '~1');
    if (Array.isArray(value)) throw new Error(`Nested array at ${path}. Select or flatten a table before import.`);
    if (value !== null && typeof value === 'object') flatten(value, path, result, depth + 1);
    else result.set(path, checkScalar(value));
  }
  if (result.size > MAX_COLUMNS) throw new Error('The table contains more than 100 columns.');
  return result;
}

function recordsToRows(records) {
  if (records.length > MAX_SOURCE_ROWS) throw new Error('The source exceeds the 200,000 physical-row safety limit.');
  const labels = new Set();
  const flattened = records.map((record, i) => {
    if (!record || Array.isArray(record) || typeof record !== 'object') throw new Error(`JSON row ${i + 1} must be an object.`);
    const values = flatten(record);
    for (const key of values.keys()) labels.add(key);
    if (labels.size > MAX_COLUMNS) throw new Error('The table contains more than 100 columns.');
    return values;
  });
  const header = [...labels];
  return [header, ...flattened.map(record => header.map(key => record.get(key) ?? null))];
}

function matrixToSheet(rows, engine, diagnostics) {
  const sheet = Object.create(null);
  let width = 0;
  rows.forEach((row, r) => {
    width = Math.max(width, row.length);
    row.forEach((value, c) => {
      if (value === null || value === undefined || value === '') return;
      sheet[engine.utils.encode_cell({ r, c })] = { v: value, t: typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's' };
    });
  });
  if (rows.length && width) sheet['!ref'] = engine.utils.encode_range({ s: {r:0,c:0}, e:{r:rows.length-1,c:width-1} });
  sheet['!prism'] = { ...diagnostics, rowWidths: rows.map(r => r.length) };
  return sheet;
}

export function parseTextWorkbook(bytes, name, engine, options) {
  const extension = name.split('.').pop().toLowerCase();
  if (!['csv', 'tsv', 'json', 'ndjson', 'jsonl'].includes(extension)) return null;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw new Error('Text files must use UTF-8 encoding. Re-save the file as UTF-8.'); }
  const sheets = Object.create(null);
  if (['csv','tsv'].includes(extension)) {
    const delimiter = options.delimiter === 'auto' ? detectDelimiter(text, extension) : options.delimiter;
    const rows = parseDelimited(text, delimiter);
    sheets.Data = matrixToSheet(rows, engine, { format: extension, delimiter });
  } else {
    let value;
    if (extension !== 'json') {
      value = [];
      for (const [i, line] of text.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        try { value.push(JSON.parse(line)); } catch { throw new Error(`Malformed JSON on line ${i + 1}.`); }
        if (value.length > MAX_SOURCE_ROWS) throw new Error('The source exceeds the physical-row safety limit.');
      }
    } else {
      try { value = JSON.parse(text); } catch { throw new Error('Malformed JSON. Choose an array of records or an object containing named tables.'); }
    }
    const tables = Array.isArray(value) ? [['Data', value]] : value && typeof value === 'object' ? Object.entries(value).filter(([,v]) => Array.isArray(v)) : [];
    if (!tables.length) throw new Error('JSON must contain an array of records or named array tables.');
    if (tables.length > 100) throw new Error('JSON contains more than 100 tables.');
    for (const [tableName, records] of tables) sheets[tableName] = matrixToSheet(recordsToRows(records), engine, { format: extension, structured: true });
  }
  return { SheetNames: Object.keys(sheets), Sheets: sheets };
}
