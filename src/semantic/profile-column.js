import { coerceFieldValue, inferColumnType, currencyFromFormat } from '../data-types.js';
import { createField, legacyTypeFor } from './field-model.js';

const IDENTIFIER_NAME = /(^|\b)(id|identifier|swift|lookup)(\b|$)/i;
const FISCAL_NAME = /(fiscal|period\s*\(13p\)|close period)/i;
const FISCAL_VALUE = /^FY\d{2,4}(?:\s*[-/]\s*P\d{1,2})?$/i;
const GEO_NAME = /(geography|country|state|province|city|region|territory)/i;
const FREE_TEXT_NAME = /(description|comments?|notes?|summary)/i;
const CURRENCY_NAME = /(amount|revenue|value|sales|price|cost).*(usd|inr|eur|gbp|converted)|\((usd|inr|eur|gbp)\)/i;
const PERCENT_NAME = /(probability|percent|percentage|rate|margin|split\s*%|\(%\))/i;

function semanticFromEvidence(fieldInput, cells, inferred) {
  const label = String(fieldInput.label ?? '');
  const values = cells.map((cell) => cell?.value).filter((value) => value !== null && value !== undefined && value !== '');
  if (values.some(value => typeof value === 'string' && (/^[+-]?0\d+$/.test(value.trim()) || /^[+-]?\d{16,}$/.test(value.trim())) || typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value))) return 'identifier';
  if (IDENTIFIER_NAME.test(label)) return 'identifier';
  if (FISCAL_NAME.test(label) || (values.length && values.filter((value) => FISCAL_VALUE.test(String(value).trim())).length / values.length >= 0.7)) return 'fiscalPeriod';
  if (CURRENCY_NAME.test(label) && ['number', 'currency'].includes(inferred.type)) return 'currency';
  if (PERCENT_NAME.test(label) && ['number', 'percent'].includes(inferred.type)) return 'percent';
  if (inferred.type === 'text' && GEO_NAME.test(label)) return 'geography';
  if (inferred.type === 'text' && FREE_TEXT_NAME.test(label)) return 'freeText';
  if (values.length && values.filter((value) => /^https?:\/\//i.test(String(value))).length / values.length >= 0.8) return 'url';
  if (values.length && values.filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))).length / values.length >= 0.8) return 'email';
  if (inferred.type === 'text') return 'category';
  return inferred.type;
}

function qualityFor(cells, field) {
  let nullCount = 0;
  let invalidCount = 0;
  const distinct = new Set();
  for (const cell of cells) {
    const value = cell?.value;
    if (value === null || value === undefined || value === '') {
      nullCount += 1;
      continue;
    }
    distinct.add(value instanceof Date ? value.toISOString() : String(value));
    if (field.type !== 'text' && coerceFieldValue(value, field) === null) invalidCount += 1;
  }
  return { nullCount, invalidCount, distinctCount: distinct.size };
}

export function profileColumn(fieldInput, cells = []) {
  const inferred = inferColumnType(cells, fieldInput.interpretation);
  let semanticType = semanticFromEvidence(fieldInput, cells, inferred);
  const currencies = new Set(cells.map(cell => currencyFromFormat(`${typeof cell?.value === 'string' ? cell.value : ''} ${cell?.format ?? ''}`)).filter(Boolean));
  const warnings = [];
  if (currencies.size > 1) { semanticType = 'freeText'; warnings.push('Mixed currencies: values remain text until converted to one currency.'); }
  if (cells.some(cell => typeof cell?.value === 'number' && Number.isInteger(cell.value) && !Number.isSafeInteger(cell.value))) warnings.push('An integer exceeds safe precision in the source. Supply this field as text to preserve exact digits.');
  const legacyType = legacyTypeFor(semanticType);
  const quality = qualityFor(cells, { ...fieldInput, type: legacyType });
  const nonEmpty = Math.max(1, cells.length - quality.nullCount);
  const semanticEvidence = semanticType === 'fiscalPeriod'
    ? cells.filter((cell) => FISCAL_VALUE.test(String(cell?.value ?? '').trim())).length / nonEmpty
    : inferred.confidence;
  const roleKind = ['number', 'currency', 'percent', 'duration'].includes(semanticType) ? 'measure' : 'dimension';
  const additive = semanticType === 'currency' || /\b(amount|revenue|sales|cost|quantity|count|units|stock|volume)\b/i.test(fieldInput.label);
  const defaultAggregation = semanticType === 'identifier' ? 'distinctCount' : roleKind === 'measure' ? semanticType === 'percent' || !additive ? 'average' : 'sum' : 'count';
  const numericValues = roleKind === 'measure' ? cells.map(cell => coerceFieldValue(cell?.value, {...fieldInput,type:legacyType})).filter(Number.isFinite) : [];
  let min = Infinity, max = -Infinity;
  for (const value of numericValues) { min = Math.min(min,value); max = Math.max(max,value); }
  return createField({
    ...fieldInput,
    physicalType: inferred.type === 'text' ? 'text' : inferred.type === 'date' ? 'temporal' : inferred.type === 'boolean' ? 'boolean' : 'number',
    semanticType,
    type: legacyType,
    typeLabel: inferred.typeLabel,
    confidence: Math.max(inferred.confidence, semanticEvidence || 0),
    format: inferred.format,
    currency: inferred.currency ?? (/\bINR\b/i.test(fieldInput.label) ? 'INR' : /\bEUR\b/i.test(fieldInput.label) ? 'EUR' : /\bGBP\b/i.test(fieldInput.label) ? 'GBP' : CURRENCY_NAME.test(fieldInput.label) ? 'USD' : undefined),
    roleKind,
    defaultAggregation,
    sortStrategy: semanticType === 'fiscalPeriod' ? 'fiscal' : semanticType === 'date' ? 'temporal' : 'natural',
    uniqueCount: quality.distinctCount,
    nullable: quality.nullCount > 0,
    quality,
    warnings,
    statistics: { nonEmpty: cells.length - quality.nullCount, valid: cells.length - quality.nullCount - quality.invalidCount, total: cells.length, ...(numericValues.length ? { min, max, varying: min !== max } : {}) },
  });
}
