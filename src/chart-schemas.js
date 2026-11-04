import { CHART_CONTRACTS } from './charts/contracts.js';

export const TYPE_GROUPS = Object.freeze({
  measure: ['number', 'currency', 'percent', 'duration'],
  category: ['text', 'category', 'identifier', 'fiscalPeriod', 'date', 'dateTime', 'boolean', 'geography', 'freeText'],
  temporal: ['date', 'dateTime', 'fiscalPeriod'],
  coordinate: ['number', 'currency', 'percent', 'duration', 'date', 'dateTime', 'fiscalPeriod'],
  axis: ['text', 'category', 'identifier', 'number', 'currency', 'percent', 'duration', 'date', 'dateTime', 'fiscalPeriod', 'boolean', 'geography', 'freeText'],
  any: ['text', 'category', 'identifier', 'number', 'currency', 'percent', 'duration', 'date', 'dateTime', 'fiscalPeriod', 'boolean', 'geography', 'freeText'],
});

const ICON_BY_CONTRACT = Object.freeze({
  scatter3d: 'bubble',
  columns3d: 'columns',
  lollipop3d: 'lollipop',
  surface3d: 'surface',
});

export const CHART_SCHEMAS = Object.freeze(Object.fromEntries(CHART_CONTRACTS.map((contract) => [
  contract.legacyId,
  Object.freeze({
    id: contract.legacyId,
    contractId: contract.id,
    label: contract.label,
    shortLabel: contract.shortLabel,
    description: contract.description,
    icon: ICON_BY_CONTRACT[contract.id],
    features: contract.features,
    roles: Object.freeze(contract.roles.map((role) => Object.freeze({
      id: role.id,
      label: role.label,
      required: role.required,
      accepts: role.accepts,
      ...(role.maxCardinality ? { maxCardinality: role.maxCardinality } : {}),
    }))),
  }),
])));

function expandAcceptedTypes(acceptedTypes = []) {
  return new Set(acceptedTypes.flatMap((type) => TYPE_GROUPS[type] ?? [type]));
}

export function isFieldCompatible(fieldType, acceptedTypes = []) {
  return expandAcceptedTypes(acceptedTypes).has(fieldType);
}

export function roleFor(chartType, roleId) {
  return CHART_SCHEMAS[chartType]?.roles.find((role) => role.id === roleId) ?? null;
}

export function compatibleRoles(chartType, fieldType) {
  return (CHART_SCHEMAS[chartType]?.roles ?? [])
    .filter((role) => isFieldCompatible(fieldType, role.accepts))
    .map((role) => role.id);
}

export function validateMappings(chartType, mappings = {}) {
  const schema = CHART_SCHEMAS[chartType];
  if (!schema) return { valid: false, errors: ['Choose a supported 3D chart style.'], missing: [], incompatible: [] };
  const missing = schema.roles.filter((role) => role.required && !mappings[role.id]).map((role) => role.id);
  const incompatible = schema.roles
    .filter((role) => mappings[role.id]
      && !isFieldCompatible(mappings[role.id].semanticType ?? mappings[role.id].type, role.accepts)
      && !isFieldCompatible(mappings[role.id].type, role.accepts))
    .map((role) => role.id);
  const errors = [
    ...missing.map((roleId) => `${roleFor(chartType, roleId).label} is required.`),
    ...incompatible.map((roleId) => `${mappings[roleId].label} is not compatible with ${roleFor(chartType, roleId).label}.`),
  ];
  return { valid: errors.length === 0, errors, missing, incompatible };
}
