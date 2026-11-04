import { CHART_CONTRACTS } from './contracts.js';

const registry = new Map(CHART_CONTRACTS.map((contract) => [contract.id, contract]));
const aliases = new Map(CHART_CONTRACTS.map((contract) => [contract.legacyId, contract.id]));

export function listChartContracts() {
  return [...CHART_CONTRACTS];
}

export function getChartContract(chartType) {
  return registry.get(aliases.get(chartType) ?? chartType) ?? null;
}

export function evaluateRoleCompatibility(contract, roleId, field) {
  const role = contract?.roles?.find((candidate) => candidate.id === roleId);
  if (!role || !field) return { state: 'invalid', reason: 'Choose an existing field and chart role.' };
  const semanticType = field.semanticType ?? (field.type === 'text' ? 'category' : field.type);
  if (!role.accepts.includes(semanticType) && !role.accepts.includes(field.type)) {
    return { state: 'invalid', reason: `${field.label ?? 'This field'} is ${semanticType}, but ${role.label} needs ${role.accepts.join(', ')}.` };
  }
  if (role.maxCardinality && (field.uniqueCount ?? 0) > role.maxCardinality) {
    return {
      state: 'transform',
      reason: `${field.label} has ${field.uniqueCount.toLocaleString()} values; reduce it before rendering.`,
      suggestion: { type: 'topN', count: role.maxCardinality },
    };
  }
  if (semanticType === 'identifier' && ['x', 'y', 'series'].includes(roleId) && (field.uniqueCount ?? 0) > 100) {
    return { state: 'transform', reason: 'Identifiers need grouping or Top N for a readable chart.', suggestion: { type: 'topN', count: 30 } };
  }
  return { state: 'recommended', reason: `${field.label ?? 'Field'} is compatible with ${role.label}.` };
}

export function validateVisualizationSpec(spec, fields = []) {
  const contract = getChartContract(spec?.chartType);
  if (!contract) return { valid: false, errors: ['Choose a supported 3D chart.'], roles: {} };
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const roles = Object.fromEntries(contract.roles.map((role) => {
    const fieldId = spec.mappings?.[role.id];
    return [role.id, fieldId ? evaluateRoleCompatibility(contract, role.id, fieldMap.get(fieldId)) : { state: role.required ? 'invalid' : 'empty', reason: role.required ? `${role.label} is required.` : 'Optional role.' }];
  }));
  const errors = Object.entries(roles).filter(([, result]) => result.state === 'invalid').map(([roleId, result]) => ({ roleId, message: result.reason }));
  return { valid: errors.length === 0, errors, roles, contract };
}
