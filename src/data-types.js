const TYPE_LABELS = Object.freeze({
  text: 'Text',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  date: 'Date',
  boolean: 'Boolean',
});

const CURRENCY_PATTERNS = [
  { pattern: /₹|\bINR\b/i, code: 'INR' },
  { pattern: /€|\bEUR\b/i, code: 'EUR' },
  { pattern: /£|\bGBP\b/i, code: 'GBP' },
  { pattern: /¥|\bJPY\b/i, code: 'JPY' },
  { pattern: /\$|\bUSD\b/i, code: 'USD' },
];

const DATE_FORMAT_PATTERN = /(^|[^\\])[ymdhis]+|mmm|yyyy|dd/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{1,2}-\d{1,2}(?:[T\s].*)?$/;

export { TYPE_LABELS };

export function currencyFromFormat(format = '') {
  return CURRENCY_PATTERNS.find(({ pattern }) => pattern.test(format))?.code ?? null;
}

export function isDateFormat(format = '') {
  const cleaned = String(format)
    .replace(/\[[^\]]+]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '');
  return DATE_FORMAT_PATTERN.test(cleaned) && !/%/.test(cleaned);
}

function classifyCell(cell, interpretation = {}) {
  const value = cell?.value;
  const format = String(cell?.format ?? 'General');

  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean' || cell?.rawType === 'b') return { type: 'boolean' };
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return { type: 'date' };

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (isDateFormat(format)) return { type: 'date' };
    const currency = currencyFromFormat(format);
    if (currency) return { type: 'currency', currency };
    if (/%/.test(format)) return { type: 'percent' };
    return { type: 'number' };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^(true|false|yes|no)$/i.test(trimmed)) return { type: 'boolean' };
    if (/^-?\d+(?:\.\d+)?%$/.test(trimmed)) return { type: 'percent' };
    const currency = currencyFromFormat(trimmed);
    if (currency && /\d/.test(trimmed)) return { type: 'currency', currency };
    if ((ISO_DATE_PATTERN.test(trimmed) || interpretation.dateOrder && interpretation.dateOrder !== 'iso') && parseDateValue(trimmed, interpretation)) return { type: 'date' };
    if (parseNumericValue(trimmed, interpretation) !== null) return { type: 'number' };
  }

  return { type: 'text' };
}

export function inferColumnType(cells = [], interpretation = {}) {
  const evidence = new Map();
  const formats = new Map();
  const currencies = new Map();
  let nonEmptyCount = 0;

  for (const cell of cells) {
    const classification = classifyCell(cell, interpretation);
    if (!classification) continue;
    nonEmptyCount += 1;
    evidence.set(classification.type, (evidence.get(classification.type) ?? 0) + 1);
    if (cell?.format) formats.set(cell.format, (formats.get(cell.format) ?? 0) + 1);
    if (classification.currency) {
      currencies.set(classification.currency, (currencies.get(classification.currency) ?? 0) + 1);
    }
  }

  if (nonEmptyCount === 0) {
    return { type: 'text', typeLabel: TYPE_LABELS.text, format: 'General', confidence: 0, nonEmptyCount: 0 };
  }

  const priority = ['date', 'currency', 'percent', 'boolean', 'number', 'text'];
  const [type, count] = priority
    .map((candidate) => [candidate, evidence.get(candidate) ?? 0])
    .sort((a, b) => b[1] - a[1] || priority.indexOf(a[0]) - priority.indexOf(b[0]))[0];
  const confidence = count / nonEmptyCount;
  const safeType = confidence >= 0.6 ? type : 'text';
  const format = [...formats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'General';
  const currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    type: safeType,
    typeLabel: TYPE_LABELS[safeType],
    format,
    confidence,
    nonEmptyCount,
    ...(safeType === 'currency' ? { currency: currency ?? 'USD' } : {}),
  };
}

export function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86_400_000);
}

export function parseNumericValue(value, interpretation = {}) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === '') return null;
  let text = String(value).trim();
  const accountingNegative = /^\(.*\)$/.test(text) || /-$/.test(text);
  if (accountingNegative) text = text.replace(/^\(|\)$/g, '').replace(/-$/, '').trim();
  text = text.replace(/^(?:[$₹€£¥]|USD|INR|EUR|GBP|JPY)\s*/i, '').replace(/\s*(?:USD|INR|EUR|GBP|JPY|%)$/i, '').trim();
  let normalized = text;
  if (interpretation.numericLocale === 'decimal-comma') {
    if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?(?:e[+-]?\d+)?$/i.test(text)) return null;
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes(',')) {
    if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return null;
    normalized = text.replace(/,/g, '');
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return accountingNegative ? -Math.abs(number) : number;
}

export function parseDateValue(value, interpretation = {}) {
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value : null;
  if (typeof value === 'number') return excelSerialToDate(value);
  const text = String(value).trim();
  let year, month, day;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](.*))?$/);
  if (iso) [,year,month,day] = iso;
  else {
    const local = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
    if (!local || !['dmy','mdy'].includes(interpretation.dateOrder)) return null;
    year = local[3]; month = local[interpretation.dateOrder === 'dmy' ? 2 : 1]; day = local[interpretation.dateOrder === 'dmy' ? 1 : 2];
  }
  const checked = new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
  if (checked.getUTCFullYear() !== Number(year) || checked.getUTCMonth() !== Number(month)-1 || checked.getUTCDate() !== Number(day)) return null;
  if (iso?.[4]) { const parsed = new Date(text); return Number.isFinite(parsed.valueOf()) ? parsed : null; }
  return checked;
}

export function coerceFieldValue(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (field?.type === 'date') {
    return parseDateValue(value, field.interpretation);
  }
  if (field?.type === 'currency' || field?.type === 'percent' || field?.type === 'number') {
    const number = parseNumericValue(value, field.interpretation);
    if (number === null) return null;
    return field.type === 'percent' && (/%/.test(String(value)) || field.interpretation?.percentScale === 'whole') ? number / 100 : number;
  }
  if (field?.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (/^(true|yes|1)$/i.test(String(value).trim())) return true;
    if (/^(false|no|0)$/i.test(String(value).trim())) return false;
    return null;
  }
  return String(value);
}

export function formatFieldValue(value, field = { type: 'text' }, {canonical = false} = {}) {
  const coerced = canonical ? value : coerceFieldValue(value, field);
  if (coerced === null) return '—';

  if (field.type === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: field.currency ?? 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(coerced);
  }
  if (field.type === 'percent') {
    return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(coerced);
  }
  if (field.type === 'number') {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(coerced);
  }
  if (field.type === 'date') {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(coerced);
  }
  if (field.type === 'boolean') return coerced ? 'Yes' : 'No';
  return String(coerced);
}
