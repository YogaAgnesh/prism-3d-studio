export const MEASURE_TYPES = Object.freeze(['number', 'currency', 'percent', 'duration']);
export const DIMENSION_TYPES = Object.freeze(['category', 'identifier', 'fiscalPeriod', 'date', 'dateTime', 'boolean', 'geography', 'freeText', 'text']);
export const COORDINATE_TYPES = Object.freeze([...MEASURE_TYPES, ...DIMENSION_TYPES]);

function role(id, label, accepts, required = true, options = {}) {
  return Object.freeze({ id, label, accepts: Object.freeze(accepts), required, ...options });
}

export const CHART_CONTRACTS = Object.freeze([
  { id: 'scatter3d', legacyId: 'bubble', version: 3, label: '3D Bubble', shortLabel: 'Bubble', description: 'Explore relationships across three spatial coordinates.', features: ['marker', 'axes', 'scene', 'hover', 'interaction'], roles: [role('x', 'X axis', COORDINATE_TYPES), role('y', 'Y axis', COORDINATE_TYPES), role('z', 'Z axis', MEASURE_TYPES), role('size', 'Size', MEASURE_TYPES, false), role('color', 'Color', [...MEASURE_TYPES, ...DIMENSION_TYPES], false), role('label', 'Label', DIMENSION_TYPES, false)], budgets: { maxMarks: 8_000 } },
  { id: 'columns3d', legacyId: 'columns', version: 1, label: '3D Columns', shortLabel: 'Columns', description: 'Compare aggregated values across two categorical dimensions.', features: ['column', 'axes', 'scene', 'hover'], roles: [role('x', 'X category', DIMENSION_TYPES), role('series', 'Series', DIMENSION_TYPES, false), role('z', 'Height', MEASURE_TYPES)], budgets: { maxMarks: 60 } },
  { id: 'lollipop3d', legacyId: 'lollipop', version: 1, label: '3D Lollipop', shortLabel: 'Lollipop', description: 'Rank categories with lighter stems and markers.', features: ['line', 'marker', 'axes', 'scene', 'hover'], roles: [role('x', 'X category', DIMENSION_TYPES), role('series', 'Series', DIMENSION_TYPES, false), role('z', 'Height', MEASURE_TYPES), role('color', 'Color', DIMENSION_TYPES, false)], budgets: { maxMarks: 100 } },
  { id: 'surface3d', legacyId: 'surface', version: 2, label: '3D Surface', shortLabel: 'Surface', description: 'Reveal peaks and valleys across a matrix.', features: ['surface', 'lighting', 'contours', 'axes', 'scene', 'hover', 'interaction'], roles: [role('x', 'X dimension', COORDINATE_TYPES, true, { maxCardinality: 50 }), role('y', 'Y dimension', COORDINATE_TYPES, true, { maxCardinality: 50 }), role('z', 'Surface height', MEASURE_TYPES), role('surfaceColor', 'Surface color', MEASURE_TYPES, false)], budgets: { maxMarks: 2_500 } },
].map((contract) => Object.freeze({ ...contract, roles: Object.freeze(contract.roles), budgets: Object.freeze(contract.budgets) })));
