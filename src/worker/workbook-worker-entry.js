import * as XLSX from 'xlsx';
import { parseWorkbook, sheetToDataset, chooseInitialSheet } from '../workbook.js';
import { recommendVisualizations } from '../charts/recommend.js';
import { buildChartSpec } from '../chart-builders.js';
import { compileFilter } from '../query/filter-compiler.js';
import { compileCalculation } from '../query/calculation-parser.js';
import { previewTypeOverride, applyTypeOverride, clearTypeOverride } from '../semantic/type-override.js';

let parsed = null;
let activeDataset = null;
let sourceBytes = null;
let sourceFileName = '';
let importOptions = {};

function publicDataset(dataset) {
  return {
    fields: dataset.fields,
    rows: dataset.rows.slice(0, 100),
    rowCount: dataset.rowCount,
    sheetName: dataset.sheetName,
    truncated: dataset.truncated,
    previewOnly: dataset.rowCount > 100,
    importOptions: dataset.importOptions,
    importDiagnostics: dataset.importDiagnostics,
    recommendations: recommendVisualizations(dataset.fields, dataset.rows),
  };
}

function fieldById(id, dataset = activeDataset) {
  return dataset.fields.find((field) => field.id === id);
}

function calculatedFieldMetadata(definition, values = [], invalidCount = 0) {
  return {
    id: definition.id, label: definition.label, sourceLabel: definition.label, type: definition.type,
    typeLabel: definition.type[0].toUpperCase() + definition.type.slice(1),
    semanticType: definition.type === 'text' ? 'category' : definition.type,
    roleKind: ['number', 'currency', 'percent'].includes(definition.type) ? 'measure' : 'dimension',
    defaultAggregation: ['number', 'currency', 'percent'].includes(definition.type) ? 'sum' : 'count',
    confidence: 1, nullable: invalidCount > 0, uniqueCount: new Set(values.map(String)).size,
    quality: { nullCount: invalidCount, invalidCount, distinctCount: new Set(values.map(String)).size }, calculated: true,
  };
}

function materializeCalculation(dataset, definition) {
  const compiled = compileCalculation(definition.expression, dataset.fields);
  let invalidCount = 0;
  for (const row of dataset.rows) {
    try {
      const value = compiled.evaluate(row);
      row[definition.id] = typeof value === 'number' && !Number.isFinite(value) ? null : value;
      if (row[definition.id] === null) invalidCount += 1;
    } catch { row[definition.id] = null; invalidCount += 1; }
  }
  const values = dataset.rows.map((row) => row[definition.id]).filter((value) => value !== null);
  const field = calculatedFieldMetadata(definition, values, invalidCount);
  dataset.fields.push(field);
  return { field, invalidCount };
}

function applyOverride(dataset, override) {
  const field = fieldById(override.fieldId, dataset);
  if (!field) throw new Error(`The field ${override.fieldId} is unavailable for a semantic override.`);
  const preview = previewTypeOverride(field, dataset.rows.map((row) => row[field.id]), override.semanticType);
  const updated = applyTypeOverride(field, preview);
  dataset.fields = dataset.fields.map((candidate) => candidate.id === field.id ? updated : candidate);
  return { field: updated, preview };
}

function filteredRows(filters, dataset = activeDataset) {
  const predicate = compileFilter(filters, dataset.fields);
  return dataset.rows.filter(predicate);
}

function validateProjectMutation(dataset, overrides, calculations) {
  const validationDataset = {
    fields: dataset.fields.filter((field) => !field.calculated).map((field) => clearTypeOverride(field)),
    rows: dataset.rows,
  };
  for (const override of overrides) applyOverride(validationDataset, override);
  for (const definition of calculations) {
    compileCalculation(definition.expression, validationDataset.fields);
    validationDataset.fields.push(calculatedFieldMetadata(definition));
  }
}

function applyProjectMutation(dataset, overrides, calculations) {
  validateProjectMutation(dataset, overrides, calculations);
  const calculatedIds = dataset.fields.filter((field) => field.calculated).map((field) => field.id);
  if (calculatedIds.length) {
    for (const row of dataset.rows) for (const fieldId of calculatedIds) delete row[fieldId];
  }
  dataset.fields = dataset.fields.filter((field) => !field.calculated).map((field) => clearTypeOverride(field));
  for (const override of overrides) applyOverride(dataset, override);
  for (const definition of calculations) materializeCalculation(dataset, definition);
}

globalThis.onmessage = ({ data }) => {
  const { requestId, type } = data ?? {};
  try {
    if (type === 'load') {
      const nextOptions = data.options ?? {};
      const loaded = parseWorkbook(data.bytes, data.fileName, XLSX, nextOptions);
      const dataset = data.sheetName ? sheetToDataset(loaded.workbook,data.sheetName,XLSX,nextOptions) : chooseInitialSheet(loaded,XLSX,nextOptions);
      sourceBytes = data.bytes;
      sourceFileName = data.fileName;
      importOptions = nextOptions;
      parsed = { sheetNames: loaded.sheetNames, fileName: loaded.fileName };
      const selectedSheet = dataset.sheetName;
      activeDataset = dataset;
      globalThis.postMessage({ requestId, ok: true, parsed: { sheetNames: parsed.sheetNames, fileName: parsed.fileName }, dataset: publicDataset(dataset), selectedSheet });
      return;
    }
    if (type === 'sheet') {
      if (!parsed || !sourceBytes) throw new Error('Open a workbook before selecting a sheet.');
      const nextOptions = data.options ?? importOptions;
      const loaded = parseWorkbook(sourceBytes, sourceFileName, XLSX, nextOptions);
      const candidate = sheetToDataset(loaded.workbook, data.sheetName, XLSX, nextOptions);
      activeDataset = candidate;
      importOptions = nextOptions;
      globalThis.postMessage({ requestId, ok: true, dataset: publicDataset(activeDataset), selectedSheet: data.sheetName });
      return;
    }
    if (type === 'count') {
      globalThis.postMessage({ requestId, ok: true, count: filteredRows(data.filters).length });
      return;
    }
    if (type === 'query') {
      const rows = filteredRows(data.filters);
      const mappings = Object.fromEntries(Object.entries(data.mappings ?? {}).map(([role, fieldId]) => [role, fieldById(fieldId)]).filter(([, field]) => field));
      const spec = buildChartSpec(data.chartType, { ...activeDataset, rows, rowCount: rows.length }, mappings, data.settings);
      globalThis.postMessage({ requestId, ok: true, spec, filteredRows: rows.length });
      return;
    }
    if (type === 'override') {
      const result = applyOverride(activeDataset, data.override);
      globalThis.postMessage({ requestId, ok: true, ...result });
      return;
    }
    if (type === 'previewOverride') {
      const field = fieldById(data.fieldId);
      if (!field) throw new Error('The selected field is unavailable.');
      const preview = previewTypeOverride(field, activeDataset.rows.map((row) => row[field.id]), data.semanticType);
      globalThis.postMessage({ requestId, ok: true, preview });
      return;
    }
    if (type === 'resetOverride') {
      const field = fieldById(data.fieldId);
      if (!field) throw new Error('The selected field is unavailable.');
      const restored = clearTypeOverride(field);
      activeDataset.fields = activeDataset.fields.map((candidate) => candidate.id === field.id ? restored : candidate);
      globalThis.postMessage({ requestId, ok: true, field: restored });
      return;
    }
    if (type === 'calculation') {
      const result = materializeCalculation(activeDataset, data.definition);
      globalThis.postMessage({ requestId, ok: true, ...result, previewValues: activeDataset.rows.slice(0, 100).map((row) => row[data.definition.id]) });
      return;
    }
    if (type === 'applyProject') {
      applyProjectMutation(activeDataset, data.overrides ?? [], data.calculations ?? []);
      globalThis.postMessage({ requestId, ok: true, dataset: publicDataset(activeDataset) });
      return;
    }
    throw new Error('Unsupported workbook worker request.');
  } catch (error) {
    globalThis.postMessage({ requestId, ok: false, error: error?.message ?? 'Workbook processing failed.' });
  }
};
