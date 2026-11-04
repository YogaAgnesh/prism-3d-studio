import { coerceFieldValue } from '../data-types.js';
import { legacyTypeFor } from './field-model.js';

export function previewTypeOverride(field, values = [], targetSemanticType) {
  const targetType = legacyTypeFor(targetSemanticType);
  const converted = [];
  let convertedCount = 0;
  let invalidCount = 0;
  let nullCount = 0;
  values.forEach((value) => {
    if (value === null || value === undefined || value === '') {
      converted.push(null);
      nullCount += 1;
      return;
    }
    const result = coerceFieldValue(value, { ...field, type: targetType });
    if (result === null) invalidCount += 1;
    else convertedCount += 1;
    converted.push(result);
  });
  return { targetSemanticType, targetType, converted, convertedCount, invalidCount, nullCount, totalCount: values.length };
}

export function applyTypeOverride(field, preview) {
  return {
    ...field,
    inferredType: field.inferredType ?? field.type,
    inferredSemanticType: field.inferredSemanticType ?? field.semanticType,
    type: preview.targetType,
    semanticType: preview.targetSemanticType,
    roleKind: ['number', 'currency', 'percent', 'duration'].includes(preview.targetSemanticType) ? 'measure' : 'dimension',
    override: {
      active: true,
      invalidCount: preview.invalidCount,
      convertedCount: preview.convertedCount,
      appliedAt: new Date().toISOString(),
    },
  };
}

export function clearTypeOverride(field) {
  if (!field?.override?.active) return field;
  const { override, inferredType, inferredSemanticType, ...rest } = field;
  return { ...rest, type: inferredType, semanticType: inferredSemanticType };
}
