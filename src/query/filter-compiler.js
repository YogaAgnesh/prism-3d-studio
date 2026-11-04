import { coerceFieldValue } from '../data-types.js';

const GROUPS = new Set(['and', 'or']);
const OPERATORS = new Set([
  'equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith',
  'in', 'notIn', 'isBlank', 'isNotBlank', 'gt', 'gte', 'lt', 'lte', 'between',
  'before', 'after', 'on',
]);

export function normalizeFilterAst(node) {
  if (!node) return { kind: 'group', conjunction: 'and', children: [] };
  if (node.kind === 'group') {
    const conjunction = String(node.conjunction ?? 'and').toLowerCase();
    if (!GROUPS.has(conjunction)) throw new Error(`Unsupported filter conjunction: ${conjunction}`);
    return { kind: 'group', conjunction, children: (node.children ?? []).map(normalizeFilterAst) };
  }
  if (node.kind !== 'condition' || !node.fieldId || !OPERATORS.has(node.operator)) {
    throw new Error('A filter condition requires a field and supported operator.');
  }
  return { kind: 'condition', fieldId: node.fieldId, operator: node.operator, value: node.value, value2: node.value2, valueCanonical: node.valueCanonical === true };
}

function blank(value) {
  return value === null || value === undefined || value === '';
}

function comparable(value, field, canonical = false) {
  if (blank(value)) return null;
  const type = field?.type ?? 'text';
  const coerced = coerceFieldValue(value, canonical ? {...field,interpretation:{...field.interpretation,percentScale:'fraction'}} : field);
  if (coerced instanceof Date) return coerced.valueOf();
  if (['number', 'currency', 'percent'].includes(type)) return coerced;
  return String(coerced ?? value).toLocaleLowerCase();
}

function conditionPredicate(condition, field) {
  if (!field) throw new Error(`Unknown filter field: ${condition.fieldId}`);
  const { operator } = condition;
  const expected = comparable(condition.value, field, condition.valueCanonical);
  const expected2 = comparable(condition.value2, field, condition.valueCanonical);
  const list = Array.isArray(condition.value) ? condition.value.map((value) => comparable(value, field, condition.valueCanonical)) : [];
  return (row) => {
    const raw = row?.[field.id];
    if (operator === 'isBlank') return blank(raw);
    if (operator === 'isNotBlank') return !blank(raw);
    const actual = comparable(raw, field);
    if (actual === null) return false;
    if (operator === 'equals' || operator === 'on') return actual === expected;
    if (operator === 'notEquals') return actual !== expected;
    if (operator === 'contains') return String(actual).includes(String(expected));
    if (operator === 'notContains') return !String(actual).includes(String(expected));
    if (operator === 'startsWith') return String(actual).startsWith(String(expected));
    if (operator === 'endsWith') return String(actual).endsWith(String(expected));
    if (operator === 'in') return list.includes(actual);
    if (operator === 'notIn') return !list.includes(actual);
    if (operator === 'gt' || operator === 'after') return actual > expected;
    if (operator === 'gte') return actual >= expected;
    if (operator === 'lt' || operator === 'before') return actual < expected;
    if (operator === 'lte') return actual <= expected;
    if (operator === 'between') return actual >= Math.min(expected, expected2) && actual <= Math.max(expected, expected2);
    return false;
  };
}

export function compileFilter(ast, fields = []) {
  const normalized = normalizeFilterAst(ast);
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  function compile(node) {
    if (node.kind === 'condition') return conditionPredicate(node, fieldMap.get(node.fieldId));
    const children = node.children.map(compile);
    if (children.length === 0) return () => true;
    return node.conjunction === 'and'
      ? (row) => children.every((predicate) => predicate(row))
      : (row) => children.some((predicate) => predicate(row));
  }
  return compile(normalized);
}

export function countFilterConditions(ast) {
  const node = normalizeFilterAst(ast);
  return node.kind === 'condition' ? 1 : node.children.reduce((sum, child) => sum + countFilterConditions(child), 0);
}
