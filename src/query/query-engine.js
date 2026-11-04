import { aggregateRows } from '../aggregate.js';
import { compileFilter } from './filter-compiler.js';
import { compileCalculation } from './calculation-parser.js';

export function executeQuery(spec = {}) {
  const sourceRows = spec.rows ?? [];
  const sourceFields = spec.fields ?? [];
  const compiledCalculations = (spec.calculations ?? []).map((definition) => ({
    definition,
    compiled: compileCalculation(definition.expression, sourceFields),
  }));
  let invalidCalculations = 0;
  const calculatedRows = sourceRows.map((source) => {
    const row = { ...source };
    for (const { definition, compiled } of compiledCalculations) {
      try {
        const value = compiled.evaluate(row);
        row[definition.id] = typeof value === 'number' && !Number.isFinite(value) ? null : value;
        if (row[definition.id] === null) invalidCalculations += 1;
      } catch {
        row[definition.id] = null;
        invalidCalculations += 1;
      }
    }
    return row;
  });
  const calculatedFields = compiledCalculations.map(({ definition }) => ({
    id: definition.id,
    label: definition.label,
    type: definition.type ?? 'number',
    semanticType: definition.type ?? 'number',
    roleKind: ['number', 'currency', 'percent'].includes(definition.type ?? 'number') ? 'measure' : 'dimension',
  }));
  const allFields = [...sourceFields, ...calculatedFields];
  const predicate = compileFilter(spec.filters, allFields);
  const filtered = calculatedRows.filter(predicate);
  const aggregated = aggregateRows(
    filtered,
    spec.dimensions ?? [],
    spec.measure,
    spec.aggregation ?? 'sum',
    spec.limit ?? Infinity,
  );
  return {
    ...aggregated,
    rows: filtered,
    fields: allFields,
    diagnostics: {
      sourceRows: sourceRows.length,
      calculatedRows: calculatedRows.length,
      filteredRows: filtered.length,
      excludedRows: sourceRows.length - filtered.length,
      invalidCalculations,
      omittedGroups: aggregated.omittedGroups,
    },
  };
}
