const SEMANTIC_TYPES = Object.freeze([
  'category', 'identifier', 'number', 'currency', 'percent', 'date',
  'dateTime', 'boolean', 'fiscalPeriod', 'duration', 'geography', 'url', 'email', 'freeText',
]);

export { SEMANTIC_TYPES };

export function createField(input = {}) {
  if (!input.id || !input.label) throw new Error('A field requires a stable id and label.');
  const semanticType = SEMANTIC_TYPES.includes(input.semanticType) ? input.semanticType : 'category';
  return Object.freeze({
    id: input.id,
    label: input.label,
    sourceLabel: input.sourceLabel ?? input.label,
    physicalType: input.physicalType ?? 'text',
    semanticType,
    type: input.type ?? legacyTypeFor(semanticType),
    roleKind: input.roleKind ?? (['number', 'currency', 'percent', 'duration'].includes(semanticType) ? 'measure' : 'dimension'),
    defaultAggregation: input.defaultAggregation ?? (['number', 'currency', 'percent', 'duration'].includes(semanticType) ? 'sum' : 'count'),
    confidence: Number.isFinite(input.confidence) ? input.confidence : 0,
    format: input.format ?? 'General',
    nullable: Boolean(input.nullable),
    uniqueCount: input.uniqueCount ?? 0,
    quality: input.quality ?? { nullCount: 0, invalidCount: 0, distinctCount: input.uniqueCount ?? 0 },
    ...input,
  });
}

export function legacyTypeFor(semanticType) {
  if (['number', 'duration'].includes(semanticType)) return 'number';
  if (semanticType === 'currency') return 'currency';
  if (semanticType === 'percent') return 'percent';
  if (['date', 'dateTime'].includes(semanticType)) return 'date';
  if (semanticType === 'boolean') return 'boolean';
  return 'text';
}
