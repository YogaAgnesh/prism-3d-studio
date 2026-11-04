import { coerceFieldValue } from '../data-types.js';

const NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'duration']);
const DATE_TYPES = new Set(['date', 'dateTime']);
const CATEGORICAL_SEMANTICS = new Set(['category', 'identifier', 'fiscalPeriod', 'boolean', 'geography', 'freeText', 'text']);

function fiscalKey(value) {
  const text = String(value ?? '');
  const year = text.match(/FY\s*(\d{2,4})/i)?.[1];
  const period = text.match(/(?:P|PERIOD)\s*(\d{1,2})/i)?.[1];
  if (!year) return null;
  return Number(year) * 100 + Number(period ?? 0);
}

function canonicalCategory(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (field?.type === 'boolean' || field?.semanticType === 'boolean') { const boolean=coerceFieldValue(value,{...field,type:'boolean'}); return boolean === null ? null : boolean ? 'True' : 'False'; }
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  return String(value);
}

function semanticType(field) {
  return field?.semanticType ?? field?.type ?? 'text';
}

function isCategorical(field) {
  return field?.type === 'text' || field?.type === 'boolean' || CATEGORICAL_SEMANTICS.has(semanticType(field));
}

export function sortCoordinateValues(values, field) {
  const type = semanticType(field);
  return [...values].sort((left, right) => {
    if (type === 'fiscalPeriod') return (fiscalKey(left) ?? Number.POSITIVE_INFINITY) - (fiscalKey(right) ?? Number.POSITIVE_INFINITY);
    if (DATE_TYPES.has(field?.type) || DATE_TYPES.has(type)) return new Date(left).valueOf() - new Date(right).valueOf();
    if (NUMERIC_TYPES.has(field?.type) || NUMERIC_TYPES.has(type)) return Number(left) - Number(right);
    return 0;
  });
}

function encodeCategories(values, field) {
  const canonical = values.map((value) => canonicalCategory(value, field));
  const unique = [...new Set(canonical.filter((value) => value !== null))];
  const ordered = semanticType(field) === 'fiscalPeriod' ? sortCoordinateValues(unique, field) : unique;
  const positions = new Map(ordered.map((value, index) => [value, index]));
  return {
    values: canonical.map((value) => value === null ? null : positions.get(value)),
    ticks: { values: ordered.map((_, index) => index), text: ordered },
    axisType: 'category-encoded',
    diagnostics: {
      invalidCount: canonical.filter((value) => value === null).length,
      uniqueCount: ordered.length,
      encodedCategorically: true,
    },
  };
}

function encodeDates(values, field) {
  let invalidCount = 0;
  const encoded = values.map((value) => {
    if (value === null || value === undefined || value === '') {
      invalidCount += 1;
      return null;
    }
    const date = coerceFieldValue(value, { ...field, type: 'date' });
    if (!(date instanceof Date) || !Number.isFinite(date.valueOf())) {
      invalidCount += 1;
      return null;
    }
    return date.toISOString();
  });
  return {
    values: encoded,
    ticks: undefined,
    axisType: 'date',
    diagnostics: { invalidCount, uniqueCount: new Set(encoded.filter(Boolean)).size, encodedCategorically: false },
  };
}

function encodeNumbers(values, field) {
  let invalidCount = 0;
  const encoded = values.map((value) => {
    if (value === null || value === undefined || value === '') {
      invalidCount += 1;
      return null;
    }
    const number = coerceFieldValue(value, field);
    if (!Number.isFinite(number)) {
      invalidCount += 1;
      return null;
    }
    return number;
  });
  return {
    values: encoded,
    ticks: undefined,
    axisType: 'linear',
    diagnostics: { invalidCount, uniqueCount: new Set(encoded.filter((value) => value !== null)).size, encodedCategorically: false },
  };
}

export function encodeAxis(values, field) {
  const type = semanticType(field);
  if (DATE_TYPES.has(field?.type) || DATE_TYPES.has(type)) return encodeDates(values, field);
  if (NUMERIC_TYPES.has(field?.type) || NUMERIC_TYPES.has(type)) return encodeNumbers(values, field);
  if (isCategorical(field)) return encodeCategories(values, field);
  return encodeCategories(values, field);
}

export function formatAxisTitle(field, transform = {}) {
  const label = field?.label || 'Axis';
  const aggregation = transform.aggregation
    ? `${transform.aggregation.charAt(0).toUpperCase()}${transform.aggregation.slice(1).toLowerCase()}`
    : '';
  const unitParts = [field?.currency, transform.displayUnit].filter(Boolean);
  return `${label}${aggregation ? ` — ${aggregation}` : ''}${unitParts.length ? ` (${unitParts.join(' ')})` : ''}`;
}
