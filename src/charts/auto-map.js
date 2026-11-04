import { isFieldCompatible } from '../chart-schemas.js';

const ROLE_HINTS = Object.freeze({
  x: ['probability', 'stage', 'close period', 'date', 'amount'],
  y: ['advise amount', 'implement amount', 'geography', 'sector', 'amount'],
  z: ['split amount', 'total global', 'implement amount', 'operate amount', 'amount', 'probability'],
  size: ['total global', 'split amount', 'amount'],
  color: ['stage', 'geography', 'industry', 'sector'],
  label: ['opportunity name', 'account name', 'client'],
  series: ['geography', 'stage', 'industry', 'sector', 'offering'],
  order: ['date', 'period', 'sequence', 'order'],
  surfaceColor: ['probability', 'score', 'amount'],
});

function compatible(field, role) {
  return isFieldCompatible(field.semanticType ?? field.type, role.accepts)
    || isFieldCompatible(field.type, role.accepts);
}

function hintScore(field, role) {
  const label = field.label.toLowerCase();
  const index = (ROLE_HINTS[role.id] ?? []).findIndex((hint) => label.includes(hint));
  return index < 0 ? 900 : index * 10;
}

function fieldScore(schema, role, field) {
  let score = hintScore(field, role);
  const semantic = field.semanticType ?? field.type;
  if (['identifier','freeText','url','email'].includes(semantic) && role.id !== 'label') score += 10_000;
  if ((field.uniqueCount ?? 2) <= 1 && !field.synthetic && role.id !== 'label') score += 5_000;
  if (schema.contractId === 'scatter3d' && ['x','y','z'].includes(role.id)) score += ['number','currency','percent','duration'].includes(semantic) ? -2_000 : 1_000;
  if (['columns3d','lollipop3d'].includes(schema.contractId) && ['x','series'].includes(role.id)) score += Math.min(5_000,field.uniqueCount ?? 0);
  if (schema.contractId === 'surface3d' && (role.id === 'x' || role.id === 'y')) {
    const isDimension = field.roleKind === 'dimension'
      || ['text', 'category', 'identifier', 'fiscalPeriod', 'date', 'dateTime', 'boolean', 'geography', 'freeText'].includes(field.semanticType ?? field.type);
    score += isDimension ? -1_000 : 0;
    score += Math.max(0, Number(field.uniqueCount) || 0);
    if ((field.semanticType ?? field.type) === 'identifier') score += 300;
    if (role.maxCardinality && (field.uniqueCount ?? 0) > role.maxCardinality) score += 2_000;
  }
  return score;
}

export function autoMapFields(schema, fields, existing = {}) {
  const mappings = { ...existing };
  const used = new Set(Object.values(mappings).map((field) => field.id));
  for (const role of schema.roles) {
    if (mappings[role.id]) continue;
    const candidates = fields.filter((field) => compatible(field, role) && !used.has(field.id) && (role.id === 'label' || !['identifier','freeText','url','email'].includes(field.semanticType)));
    candidates.sort((left, right) => fieldScore(schema, role, left) - fieldScore(schema, role, right));
    const chosen = candidates[0];
    if (chosen) {
      mappings[role.id] = chosen;
      used.add(chosen.id);
    }
  }
  return mappings;
}
