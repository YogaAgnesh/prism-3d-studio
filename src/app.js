import { buildChartSpec } from './chart-builders.js';
import { autoMapFields } from './charts/auto-map.js';
import { CHART_SCHEMAS, compatibleRoles, isFieldCompatible, validateMappings } from './chart-schemas.js';
import { formatFieldValue, parseNumericValue } from './data-types.js';
import { PALETTES } from './palettes.js';
import { chooseInitialSheet, parseWorkbook, sheetToDataset } from './workbook.js';
import { compileFilter } from './query/filter-compiler.js';
import { compileCalculation } from './query/calculation-parser.js';
import { previewTypeOverride, applyTypeOverride, clearTypeOverride } from './semantic/type-override.js';
import { assessChartHealth } from './charts/health.js';
import { getChartContract } from './charts/registry.js';
import { exportProject, importProject } from './state/project-io.js';
import { hydrateChartState } from './state/chart-activation.js';
import { saveChartAndCreateDraft } from './state/studio-store.js';
import { cameraRelayoutPatch, captureCamera } from './state/camera-state.js';
import { validateImportFile, validateProjectBytes } from './security/validate-import.js';
import { installNetworkGuard } from './security/network-guard.js';
import { createWorkbookWorkerClient } from './worker/workbook-worker-client.js';
import { buildBriefingPackage } from './publishing/briefing-package.js';
import { generateInteractiveChartHtml, generatePlotlyCode } from './publishing/plotly-code.js';
import { deriveChartInsights } from './story/insights.js';
import { advanceImport, completeImport, createImportState, failImport, startImport } from './import/import-status.js';
import { resolveThemeCanvas } from './theme/theme-settings.js';
import { normalizeImportOptions } from './import/limits.js';
import { DOMAIN_SAMPLES } from './import/samples.js';
import { recommendVisualizations } from './charts/recommend.js';
import {
  captureStoryChapter,
  createChapterSnapshot,
  createStoryState,
  moveStoryChapter,
  removeStoryChapter,
  selectStoryChapter,
  updateStoryChapter,
} from './story/story-state.js';

installNetworkGuard(globalThis, { allowSameOriginPublishing: __PRISM_HOSTED__ });

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const TYPE_ICONS = Object.freeze({ text: 'Aa', number: '123', currency: '$', percent: '%', date: 'D', boolean: '◐' });
const CONTRACT_TO_LEGACY = Object.freeze({ scatter3d: 'bubble', columns3d: 'columns', lollipop3d: 'lollipop', surface3d: 'surface' });
const LEGACY_TO_CONTRACT = Object.freeze(Object.fromEntries(Object.entries(CONTRACT_TO_LEGACY).map(([contract, legacy]) => [legacy, contract])));
const SAMPLE_CSV = `Opportunity Name,Stage,Geography,Probability (%),Advise Amount (converted),Implement Amount (converted),Operate Amount (converted),Total Global Opportunity Amount (USD),Expected Close Date,Parent Client Industry (US)
Atlas Modernization,Discover,North America,22%,"$1,280,000","$4,850,000","$2,100,000","$8,230,000",2026-09-30,Financial Services
Nimbus Cloud Program,Develop,Europe,46%,"$2,400,000","$7,650,000","$3,800,000","$13,850,000",2026-11-15,Technology
Horizon AI Factory,Propose,Asia Pacific,67%,"$3,150,000","$9,200,000","$4,600,000","$16,950,000",2026-10-20,Consumer
Northstar ERP,Close,North America,83%,"$1,950,000","$12,400,000","$5,100,000","$19,450,000",2026-08-28,Manufacturing
Aurora Data Estate,Develop,Europe,55%,"$2,780,000","$6,900,000","$3,250,000","$12,930,000",2026-12-05,Life Sciences
Pulse Experience,Discover,Latin America,31%,"$980,000","$3,600,000","$2,850,000","$7,430,000",2027-01-18,Consumer
Vertex Security,Propose,Asia Pacific,72%,"$1,650,000","$5,980,000","$4,100,000","$11,730,000",2026-09-12,Government
Summit Operations,Close,Europe,91%,"$2,100,000","$8,400,000","$6,250,000","$16,750,000",2026-08-22,Energy
Mosaic Commerce,Develop,North America,58%,"$1,480,000","$6,250,000","$3,950,000","$11,680,000",2026-10-31,Retail
Beacon Analytics,Propose,Asia Pacific,76%,"$2,550,000","$7,800,000","$4,750,000","$15,100,000",2026-09-25,Financial Services
Orbit Workforce,Discover,Europe,18%,"$760,000","$2,900,000","$1,850,000","$5,510,000",2027-02-12,Technology
Lumen Service Cloud,Close,North America,88%,"$1,820,000","$9,100,000","$5,700,000","$16,620,000",2026-08-26,Life Sciences`;

const state = {
  file: null,
  parsed: null,
  dataset: null,
  theme: 'light',
  mode: 'guided',
  chartType: 'bubble',
  mappings: {},
  activeRole: null,
  fieldSearch: '',
  settings: {
    title: 'Dataset landscape',
    palette: 'spectrum',
    aggregation: 'sum',
    background: '#F6F8FC',
    plotBackground: '#FFFFFF',
    opacity: 0.9,
    markerScale: 1,
    markerMode: 'markers',
    lineMode: 'lines+markers',
    lineWidth: 6,
    grid: true,
    camera: 'perspective',
    perspective: true,
    projection: 'perspective',
    aspectmode: 'cube',
    showSpikes: false,
    showZeroLine: true,
    showContours: true,
    projectContours: true,
    connectGaps: false,
    lighting: { ambient: 0.65, diffuse: 0.75, specular: 0.35, roughness: 0.4, fresnel: 0.15 },
    scrollZoom: true,
    displayModeBar: true,
    exportWidth: 1920,
    exportHeight: 1080,
    reverseX: false,
    reverseY: false,
    reverseZ: false,
    pointLimit: 8_000,
    groupLimit: 60,
  },
  plotSpec: null,
  renderTimer: null,
  filters: [],
  calculations: [],
  charts: [],
  story: createStoryState(),
  importStatus: createImportState(),
  importProgressTimer: null,
  activeChartId: null,
  editingFieldId: null,
  renderRevision: 0,
  workbookWorker: null,
  pendingWorker: null,
  importOptions: normalizeImportOptions(),
  importRevision: 0,
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function chartIcon(type) {
  const colors = ['#8B5CF6', '#22D3EE', '#F59E0B', '#FB7185'];
  if (type === 'bubble') return `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="10" cy="20" r="5" fill="${colors[0]}"/><circle cx="20" cy="12" r="7" fill="${colors[1]}" opacity=".9"/><circle cx="25" cy="23" r="3" fill="${colors[3]}"/></svg>`;
  if (type === 'line') return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24 11 15 18 19 27 7" fill="none" stroke="${colors[1]}" stroke-width="2.5"/><circle cx="5" cy="24" r="2.5" fill="${colors[0]}"/><circle cx="11" cy="15" r="2.5" fill="${colors[1]}"/><circle cx="18" cy="19" r="2.5" fill="${colors[2]}"/><circle cx="27" cy="7" r="2.5" fill="${colors[3]}"/></svg>`;
  if (type === 'columns') return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24V14h5v10z" fill="${colors[0]}"/><path d="M13.5 24V7h5v17z" fill="${colors[1]}"/><path d="M22 24V11h5v13z" fill="${colors[2]}"/><path d="M3 25h26" stroke="#8C96B3"/></svg>`;
  if (type === 'lollipop') return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 25V16M16 25V8M24 25V13" stroke="#7C86A4" stroke-width="2"/><circle cx="8" cy="14" r="3.5" fill="${colors[3]}"/><circle cx="16" cy="6" r="3.5" fill="${colors[1]}"/><circle cx="24" cy="11" r="3.5" fill="${colors[2]}"/></svg>`;
  if (type === 'surface') return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 22c5-1 6-10 11-9s5 8 9 6 4-5 7-4v8H3z" fill="url(#sg)"/><defs><linearGradient id="sg"><stop stop-color="${colors[0]}"/><stop offset=".5" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient></defs></svg>`;
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 23c5-8 8-8 13 0s8 6 13-2" fill="none" stroke="${colors[0]}" stroke-width="2.5"/><path d="M3 17c5-8 8-8 13 0s8 6 13-2" fill="none" stroke="${colors[1]}" stroke-width="2.5"/><path d="M3 11c5-6 8-6 13 0s8 5 13-1" fill="none" stroke="${colors[3]}" stroke-width="2.5"/></svg>`;
}

function showToast(title, message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = message;
  toast.append(strong, span);
  $('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 4600);
}

function renderImportStatus() {
  const status = state.importStatus;
  const button = $('#choose-file-button');
  const progress = $('#import-progress');
  const track = progress.querySelector('[role="progressbar"]');
  button.disabled = status.busy;
  button.textContent = status.busy ? 'File selected' : status.status === 'ready' ? 'Dataset connected' : 'Choose a dataset';
  $('#file-input').disabled = status.busy;
  $('#sample-data-button').disabled = status.busy;
  $('#sheet-select').disabled = status.busy;
  $('#source-import-settings').disabled = status.busy;
  $('#welcome-import-settings').disabled = status.busy;
  $('#new-file-button').disabled = status.busy;
  $('#dropzone').classList.toggle('is-loading', status.busy);
  $('#dropzone').setAttribute('aria-busy', String(status.busy));
  progress.classList.toggle('hidden', status.status === 'idle');
  progress.dataset.status = status.status;
  $('#import-file-name').textContent = status.fileName || 'Preparing spreadsheet';
  $('#import-progress-value').textContent = status.busy ? 'Working locally' : status.status === 'ready' ? 'Ready' : '';
  $('#import-status-text').textContent = status.error || status.message;
  $('#import-progress-bar').style.transform = `scaleX(${status.progress / 100})`;
  if (status.busy) track.removeAttribute('aria-valuenow'); else track.setAttribute('aria-valuenow', String(status.progress));
  $('#import-live').classList.toggle('hidden', !status.busy && status.status !== 'error');
  $('#import-live-text').textContent = `${status.fileName} · ${status.error || status.message}`;
  $('#cancel-import-button').textContent = status.busy ? 'Cancel import' : 'Dismiss';
}

function stopImportProgress() {
  if (state.importProgressTimer) window.clearInterval(state.importProgressTimer);
  state.importProgressTimer = null;
}

function beginImportProgress(fileName) {
  stopImportProgress();
  state.importStatus = startImport(state.importStatus, fileName);
  renderImportStatus();
}

function fieldById(fieldId) {
  return state.dataset?.fields.find((field) => field.id === fieldId) ?? null;
}

function parseScaledNumber(value, field) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  const multiplier = /b$/i.test(text) ? 1_000_000_000 : /m$/i.test(text) ? 1_000_000 : /k$/i.test(text) ? 1_000 : 1;
  const number = parseNumericValue(text.replace(/[kmb]$/i, ''), field?.interpretation);
  if (number === null) return value;
  if (field?.type === 'percent' && (/%/.test(text) || field.interpretation?.percentScale === 'whole')) return number / 100;
  return number * multiplier;
}

function parsedFilterValue(value, field, operator) {
  if (['in', 'notIn'].includes(operator)) return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (['number', 'currency', 'percent'].includes(field?.type)) return parseScaledNumber(value, field);
  return value;
}

function filterAst() {
  return { kind: 'group', conjunction: 'and', children: state.filters.map((filter) => ({
    kind: 'condition', fieldId: filter.fieldId, operator: filter.operator,
    value: filter.value, value2: filter.value2,
    valueCanonical: filter.valueCanonical === true,
  })) };
}

function filteredDataset() {
  if (!state.dataset || state.filters.length === 0) return state.dataset;
  const predicate = compileFilter(filterAst(), state.dataset.fields);
  const rows = state.dataset.rows.filter(predicate);
  return { ...state.dataset, rows, rowCount: rows.length };
}

function fieldOperators(field) {
  if (['number', 'currency', 'percent'].includes(field?.type)) return [
    ['between', 'Between'], ['gt', 'Greater than'], ['gte', 'Greater than or equal'], ['lt', 'Less than'], ['lte', 'Less than or equal'], ['equals', 'Equals'], ['isBlank', 'Is blank'], ['isNotBlank', 'Is not blank'],
  ];
  if (field?.type === 'date') return [
    ['between', 'Between'], ['after', 'After'], ['before', 'Before'], ['on', 'On'], ['isBlank', 'Is blank'], ['isNotBlank', 'Is not blank'],
  ];
  return [
    ['equals', 'Equals'], ['in', 'Is one of'], ['contains', 'Contains'], ['startsWith', 'Starts with'], ['notEquals', 'Does not equal'], ['notIn', 'Is not one of'], ['isBlank', 'Is blank'], ['isNotBlank', 'Is not blank'],
  ];
}

function formatFilterValue(value, field) {
  if (Array.isArray(value)) return value.join(', ');
  return ['number', 'currency', 'percent', 'date'].includes(field?.type) ? formatFieldValue(value, field, {canonical:typeof value === 'number'}) : String(value ?? '');
}

function renderFilterComposer() {
  if (!state.dataset) return;
  const fieldSelect = $('#filter-field-select');
  const selected = fieldSelect.value || state.dataset.fields[0]?.id;
  fieldSelect.innerHTML = state.dataset.fields.map((field) => `<option value="${escapeHtml(field.id)}">${escapeHtml(field.label)}</option>`).join('');
  fieldSelect.value = fieldById(selected) ? selected : state.dataset.fields[0]?.id ?? '';
  const field = fieldById(fieldSelect.value);
  const operatorSelect = $('#filter-operator-select');
  const oldOperator = operatorSelect.value;
  operatorSelect.innerHTML = fieldOperators(field).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  if ([...operatorSelect.options].some((option) => option.value === oldOperator)) operatorSelect.value = oldOperator;
  const noValue = ['isBlank', 'isNotBlank'].includes(operatorSelect.value);
  $('label[for="filter-value-input"]').classList.toggle('hidden', noValue);
  $('#filter-value-input').classList.toggle('hidden', noValue);
  $('#filter-second-value-wrap').classList.toggle('hidden', operatorSelect.value !== 'between');
  const semanticInputType = field?.type === 'date' ? 'date' : ['number', 'currency', 'percent'].includes(field?.type) ? 'text' : 'text';
  $('#filter-value-input').type = semanticInputType;
  $('#filter-value-2-input').type = semanticInputType;
  $('#filter-value-input').placeholder = field?.type === 'currency' ? 'e.g. $10M' : operatorSelect.value === 'in' ? 'Comma-separated values' : 'Enter a value';
}

async function renderFilters() {
  if (!state.dataset) return;
  $('#active-filters').innerHTML = state.filters.map((filter) => {
    const field = fieldById(filter.fieldId);
    const operatorLabel = fieldOperators(field).find(([value]) => value === filter.operator)?.[1] ?? filter.operator;
    const value = ['isBlank', 'isNotBlank'].includes(filter.operator) ? '' : ` · ${formatFilterValue(filter.value, field)}${filter.operator === 'between' ? ` — ${formatFilterValue(filter.value2, field)}` : ''}`;
    return `<div class="filter-chip"><div><strong>${escapeHtml(field?.label ?? filter.fieldId)}</strong><span>${escapeHtml(operatorLabel + value)}</span></div><button type="button" data-remove-filter="${escapeHtml(filter.id)}" aria-label="Remove filter">×</button></div>`;
  }).join('') || '<p class="section-copy">No active filters.</p>';
  $$('[data-remove-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filters = state.filters.filter((filter) => filter.id !== button.dataset.removeFilter);
    renderFilters(); scheduleChartRender();
  }));
  const signature = JSON.stringify(filterAst());
  $('#filter-result').textContent = state.filters.length ? 'Evaluating filters…' : `No filters · all ${state.dataset.rowCount.toLocaleString()} rows included`;
  const dataset = state.dataset;
  try {
    const included = state.workbookWorker ? (await state.workbookWorker.count(filterAst())).count : filteredDataset().rows.length;
    if (dataset !== state.dataset || signature !== JSON.stringify(filterAst())) return;
    $('#filter-result').textContent = `${state.filters.length} filter${state.filters.length === 1 ? '' : 's'} · ${included.toLocaleString()} of ${state.dataset.rowCount.toLocaleString()} rows included`;
  } catch (error) { if (dataset === state.dataset) $('#filter-result').textContent = error.message; }
}

function addFilter() {
  const field = fieldById($('#filter-field-select').value);
  const operator = $('#filter-operator-select').value;
  const noValue = ['isBlank', 'isNotBlank'].includes(operator);
  const rawValue = $('#filter-value-input').value;
  const rawValue2 = $('#filter-value-2-input').value;
  if (!field || (!noValue && !rawValue.trim()) || (operator === 'between' && !rawValue2.trim())) {
    showToast('Complete the filter', 'Choose a field, condition, and required value.', 'error');
    return;
  }
  state.filters.push({ id: `filter-${Date.now()}`, fieldId: field.id, operator, value: noValue ? null : parsedFilterValue(rawValue, field, operator), value2: operator === 'between' ? parsedFilterValue(rawValue2, field, operator) : undefined, valueCanonical:['number','currency','percent'].includes(field.type) });
  $('#filter-value-input').value = '';
  $('#filter-value-2-input').value = '';
  renderFilters(); scheduleChartRender();
}

function updateDataIntelligence() {
  if (!state.dataset) return;
  const fields = state.dataset.fields;
  const measures = fields.filter((field) => field.roleKind === 'measure').length;
  const dimensions = fields.length - measures;
  const warnings = fields.filter((field) => (field.quality?.invalidCount ?? 0) > 0).length;
  $('#data-intelligence-card').innerHTML = `<div><span class="panel-kicker">PRISMATIC INTELLIGENCE</span><strong>${measures} measures · ${dimensions} dimensions</strong><small>${warnings ? `${warnings} field${warnings === 1 ? '' : 's'} need attention` : 'Types and quality checks look ready'} · ${state.dataset.rowCount.toLocaleString()} rows profiled</small></div>`;
  const diagnostics = state.dataset.importDiagnostics ?? {};
  const notes = [...fields.flatMap(field => field.warnings ?? [])];
  if (diagnostics.irregularRows) notes.push(`${diagnostics.irregularRows} rows differ from the header width; all columns were retained.`);
  if (diagnostics.formulaMissing) notes.push(`${diagnostics.formulaMissing} formulas have no cached result. Recalculate in a spreadsheet application.`);
  const ambiguous = fields.filter(f => f.type === 'text' && f.sample?.some(v => /^\d+[/.\-]\d+[/.\-]\d+$/.test(String(v)) || /^\d+,\d{1,2}$/.test(String(v))));
  if (ambiguous.length) notes.push('Some values may need a numeric or date convention. Review import settings.');
  $('#source-diagnostics').textContent = `${String(diagnostics.format ?? 'local table').toUpperCase()} · ${diagnostics.headerless ? 'Generated headers' : `Header row ${diagnostics.headerRow ?? 1}`} · ${notes.join(' ') || 'Original values retained; field types can be corrected.'}`;
  renderRecommendations();
}

function renderRecommendations() {
  const candidates = state.dataset.recommendations ?? recommendVisualizations(state.dataset.fields);
  state.dataset.recommendations = candidates;
  $('#recommendations').innerHTML = candidates.length ? `<span class="panel-kicker">SUGGESTED VIEWS</span>${candidates.map((r,i) => `<button class="recommendation-option" type="button" data-recommendation="${i}" aria-pressed="${CONTRACT_TO_LEGACY[r.chartType] === state.chartType}"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.reason)}</small>${r.warnings?.length ? `<small>${escapeHtml(r.warnings.join(' '))}</small>` : ''}</button>`).join('')}` : '<p class="section-copy">This table has too few varying, usable dimensions for an automatic 3D view. Review types and mappings; Prism will not invent coordinates.</p>';
  $$('[data-recommendation]').forEach(button => button.addEventListener('click', () => applyRecommendation(candidates[Number(button.dataset.recommendation)])));
}

function applyRecommendation(recipe) {
  if (!recipe) { state.mappings = {}; renderMappings(); renderFields(); scheduleChartRender(); return; }
  state.chartType = CONTRACT_TO_LEGACY[recipe.chartType];
  state.settings = { ...state.settings, ...recipe.settings, title: recipe.title };
  state.mappings = Object.fromEntries(Object.entries(recipe.mappings).map(([role,id]) => [role,fieldById(id)]).filter(([,field]) => field));
  state.activeRole = null;
  syncSettingControls(); renderChartTypes(); renderMappings(); renderFields(); renderRecommendations(); scheduleChartRender();
}

function openTypeEditor(fieldId) {
  const field = fieldById(fieldId);
  if (!field) return;
  state.editingFieldId = fieldId;
  $('#type-dialog-title').textContent = field.label;
  $('#type-select').value = field.semanticType ?? field.type;
  $('#reset-type-button').classList.toggle('hidden', !field.override?.active);
  renderTypePreview();
  $('#type-dialog').showModal();
}

async function resetEditedType() {
  const field = fieldById(state.editingFieldId);
  if (!field?.override?.active) return;
  const restored = state.workbookWorker ? (await state.workbookWorker.resetOverride(field.id)).field : clearTypeOverride(field);
  state.dataset.fields = state.dataset.fields.map((candidate) => candidate.id === field.id ? restored : candidate);
  state.dataset.recommendations = recommendVisualizations(state.dataset.fields);
  state.mappings = Object.fromEntries(Object.entries(state.mappings).map(([role, mapped]) => [role, mapped.id === field.id ? restored : mapped]));
  $('#type-dialog').close();
  renderFieldLegend(); renderFields(); renderMappings(); renderFilterComposer(); updateDataIntelligence(); scheduleChartRender();
  showToast('Detected type restored', `${field.label} is using Prism’s original inference again.`);
}

async function renderTypePreview() {
  const field = fieldById(state.editingFieldId);
  if (!field) return;
  const target = $('#type-select').value;
  const preview = state.workbookWorker ? (await state.workbookWorker.previewOverride(field.id, target)).preview : previewTypeOverride(field, state.dataset.rows.map((row) => row[field.id]), target);
  if (target !== $('#type-select').value) return;
  $('#conversion-preview').innerHTML = `<strong>${preview.convertedCount.toLocaleString()} values convert cleanly</strong><br>${preview.nullCount.toLocaleString()} blanks remain blank · ${preview.invalidCount.toLocaleString()} invalid values become null<br><span>Detected: ${escapeHtml(field.semanticType ?? field.type)} · confidence ${Math.round((field.confidence ?? 0) * 100)}%</span>`;
}

async function applyEditedType(event) {
  event.preventDefault();
  const field = fieldById(state.editingFieldId);
  if (!field) return;
  const target = $('#type-select').value;
  const result = state.workbookWorker ? await state.workbookWorker.override(field.id, target) : { preview: previewTypeOverride(field, state.dataset.rows.map((row) => row[field.id]), target) };
  const updated = result.field ?? applyTypeOverride(field, result.preview);
  state.dataset.fields = state.dataset.fields.map((candidate) => candidate.id === field.id ? updated : candidate);
  state.dataset.recommendations = recommendVisualizations(state.dataset.fields);
  state.mappings = Object.fromEntries(Object.entries(state.mappings).map(([role, mapped]) => [role, mapped.id === field.id ? updated : mapped]));
  $('#type-dialog').close();
  renderFieldLegend(); renderFields(); renderMappings(); renderFilterComposer(); updateDataIntelligence(); scheduleChartRender();
  showToast('Type updated', `${field.label} is now interpreted as ${updated.semanticType}.`);
}

function openCalculationEditor() {
  $('#calculation-form').reset();
  $('#calculation-validation').className = 'validation-box';
  $('#calculation-validation').querySelector('p').textContent = 'Formula is checked before it is added.';
  $('#calculation-dialog').showModal();
}

function materializeCalculation(definition) {
  const compiled = compileCalculation(definition.expression, state.dataset.fields);
  let invalidCount = 0;
  state.dataset.rows.forEach((row) => {
    try {
      const value = compiled.evaluate(row);
      row[definition.id] = typeof value === 'number' && !Number.isFinite(value) ? null : value;
      if (row[definition.id] === null) invalidCount += 1;
    } catch { row[definition.id] = null; invalidCount += 1; }
  });
  const values = state.dataset.rows.map((row) => row[definition.id]).filter((value) => value !== null);
  const field = {
    id: definition.id, label: definition.label, sourceLabel: definition.label, type: definition.type,
    typeLabel: definition.type[0].toUpperCase() + definition.type.slice(1),
    semanticType: definition.type === 'text' ? 'category' : definition.type,
    roleKind: ['number', 'currency', 'percent'].includes(definition.type) ? 'measure' : 'dimension',
    defaultAggregation: ['number', 'currency', 'percent'].includes(definition.type) ? 'sum' : 'count',
    confidence: 1, nullable: invalidCount > 0, uniqueCount: new Set(values.map(String)).size,
    quality: { nullCount: invalidCount, invalidCount, distinctCount: new Set(values.map(String)).size },
    calculated: true,
  };
  state.dataset.fields = [...state.dataset.fields, field];
  return { field, invalidCount };
}

async function createCalculation(event) {
  event.preventDefault();
  const name = $('#calculation-name').value.trim();
  const expression = $('#calculation-expression').value.trim();
  const type = $('#calculation-type').value;
  try {
    if (!name) throw new Error('Give the calculated field a name.');
    const id = `calc_${state.calculations.length + 1}`;
    const definition = { id, label: name, expression, type };
    const result = state.workbookWorker ? await state.workbookWorker.calculation(definition) : materializeCalculation(definition);
    const { invalidCount } = result;
    if (state.workbookWorker) {
      state.dataset.fields = [...state.dataset.fields, result.field];
      state.dataset.rows.forEach((row, index) => { row[definition.id] = result.previewValues[index] ?? null; });
    }
    state.calculations.push(definition);
    $('#calculation-dialog').close();
    $('#field-count').textContent = state.dataset.fields.length;
    renderFieldLegend(); renderFields(); renderFilterComposer(); updateDataIntelligence();
    showToast('Calculated field created', `${name} is ready. ${invalidCount.toLocaleString()} rows returned null.`);
  } catch (error) {
    $('#calculation-validation').className = 'validation-box error';
    $('#calculation-validation').querySelector('p').textContent = error.message;
  }
}

function currentChartSnapshot(id = state.activeChartId ?? `chart-${state.charts.length + 1}`) {
  return {
    id,
    chartType: LEGACY_TO_CONTRACT[state.chartType] ?? state.chartType,
    title: state.settings.title,
    mappings: Object.fromEntries(Object.entries(state.mappings).map(([role, field]) => [role, field.id])),
    settings: { ...state.settings },
    tile: { width: 640, height: 420 },
  };
}

function syncActiveChart() {
  if (!state.activeChartId) return;
  const snapshot = currentChartSnapshot(state.activeChartId);
  state.charts = state.charts.map((chart) => chart.id === state.activeChartId ? snapshot : chart);
  renderChartTray();
}

function saveChart() {
  const next = saveChartAndCreateDraft({ charts: state.charts, activeChartId: state.activeChartId }, currentChartSnapshot());
  state.charts = next.charts;
  state.activeChartId = next.activeChartId;
  state.settings = { ...state.settings, title: 'New chart' };
  $('#chart-title-input').value = state.settings.title;
  $('#chart-toolbar-title').textContent = state.settings.title;
  renderChartTray();
  showToast('Chart saved', 'Your configured view is preserved below. Continue editing this working copy.');
  scheduleChartRender();
}

function activateChart(chartId, { syncCurrent = true } = {}) {
  if (syncCurrent) syncActiveChart();
  const chart = hydrateChartState(state, chartId, fieldById, CONTRACT_TO_LEGACY);
  if (!chart) return;
  syncSettingControls();
  renderChartTypes(); renderMappings(); renderFields(); renderChartTray(); scheduleChartRender();
}

function removeChart(chartId) {
  if (state.charts.length <= 1) { showToast('Keep one chart', 'A project needs at least one active chart.', 'error'); return; }
  state.charts = state.charts.filter((chart) => chart.id !== chartId);
  if (state.activeChartId === chartId) activateChart(state.charts[0].id);
  else renderChartTray();
}

function renderChartTray() {
  $('#chart-tray').innerHTML = state.charts.map((chart) => `<div class="chart-tray-item ${chart.id === state.activeChartId ? 'active' : ''}" data-chart-id="${escapeHtml(chart.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(chart.title)}"><span>${escapeHtml(getChartContract(chart.chartType)?.shortLabel ?? chart.chartType)}</span><strong>${escapeHtml(chart.title)}</strong><button type="button" data-remove-chart="${escapeHtml(chart.id)}" aria-label="Remove ${escapeHtml(chart.title)}">×</button></div>`).join('');
  $$('.chart-tray-item').forEach((item) => {
    item.addEventListener('click', (event) => { if (!event.target.closest('[data-remove-chart]')) activateChart(item.dataset.chartId); });
    item.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); activateChart(item.dataset.chartId); } });
  });
  $$('[data-remove-chart]').forEach((button) => button.addEventListener('click', () => removeChart(button.dataset.removeChart)));
}

function activeStoryChapter() {
  return state.story.chapters.find((chapter) => chapter.id === state.story.activeChapterId) ?? null;
}

function storyMetricsFromForm() {
  return [1, 2, 3].map((index) => ({
    label: $(`#story-metric-label-${index}`).value.trim(),
    value: $(`#story-metric-value-${index}`).value.trim(),
  })).filter((metric) => metric.label || metric.value);
}

function storyStyleFromForm() {
  return {
    fontFamily: $('#story-font-select').value,
    accentColor: $('#story-accent-input').value,
    textColor: $('#story-text-input').value,
    surfaceColor: $('#story-surface-input').value,
    layout: $('#story-layout-select').value,
  };
}

function applyStoryStyle(element, chapter) {
  const style = chapter?.style ?? {};
  element.dataset.storyFont = style.fontFamily ?? 'system';
  element.dataset.storyLayout = style.layout ?? 'narrative-left';
  element.style.setProperty('--story-accent', style.accentColor ?? '#175CD3');
  element.style.setProperty('--story-text', style.textColor ?? '#101828');
  element.style.setProperty('--story-surface', style.surfaceColor ?? '#FFFFFF');
}

function renderStoryInsights() {
  const list = $('#story-insight-list');
  const insights = deriveChartInsights(state.plotSpec);
  list.innerHTML = insights.length ? insights.map((insight, index) => `
    <article class="story-insight-card">
      <div><strong>${escapeHtml(insight.title)}</strong><p>${escapeHtml(insight.takeaway)}</p><small>${escapeHtml(insight.method)}</small></div>
      <button class="button button-ghost compact-button" type="button" data-use-insight="${index}">Use</button>
    </article>`).join('') : '<span class="story-insight-empty">No reliable signal was found in the rendered values. Add your own narrative or adjust the chart.</span>';
  $$('[data-use-insight]', list).forEach((button) => button.addEventListener('click', () => {
    const insight = insights[Number(button.dataset.useInsight)];
    if (!insight) return;
    $('#story-takeaway-input').value = insight.takeaway;
    if (!$('#story-metric-label-1').value) $('#story-metric-label-1').value = insight.metric.label;
    if (!$('#story-metric-value-1').value) $('#story-metric-value-1').value = insight.metric.value;
    showToast('Insight added', 'Review and edit the deterministic suggestion before saving the chapter.');
  }));
}

function renderStoryBuilder() {
  const chapters = state.story.chapters;
  const container = $('#story-chapters');
  container.innerHTML = chapters.length ? chapters.map((chapter, index) => `
    <div class="story-chapter ${chapter.id === state.story.activeChapterId ? 'active' : ''}" role="listitem">
      <button class="story-chapter-main" type="button" data-story-select="${escapeHtml(chapter.id)}" aria-label="Open chapter ${index + 1}: ${escapeHtml(chapter.title)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(chapter.title)}</strong></button>
      <div class="story-chapter-tools">
        <button type="button" data-story-move="-1" data-story-id="${escapeHtml(chapter.id)}" aria-label="Move ${escapeHtml(chapter.title)} earlier" ${index === 0 ? 'disabled' : ''}>‹</button>
        <button type="button" data-story-move="1" data-story-id="${escapeHtml(chapter.id)}" aria-label="Move ${escapeHtml(chapter.title)} later" ${index === chapters.length - 1 ? 'disabled' : ''}>›</button>
        <button type="button" data-story-edit="${escapeHtml(chapter.id)}" aria-label="Edit ${escapeHtml(chapter.title)}">Edit</button>
      </div>
    </div>`).join('') : '<span class="story-empty">Capture a chart view to create the opening chapter.</span>';
  $('#present-story-button').disabled = !chapters.length;
  $('#capture-story-button').disabled = !state.plotSpec || chapters.length >= 8;
  const active = activeStoryChapter();
  const overlay = $('#story-overlay');
  overlay.classList.toggle('hidden', !active);
  if (active) {
    const index = chapters.findIndex((chapter) => chapter.id === active.id);
    $('#story-overlay-number').textContent = `Chapter ${String(index + 1).padStart(2, '0')}`;
    $('#story-overlay-title').textContent = active.title;
    $('#story-overlay-takeaway').textContent = active.takeaway;
    $('#story-overlay-metrics').innerHTML = active.metrics.map((metric) => `<div><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`).join('');
    applyStoryStyle(overlay, active);
  }
  $$('[data-story-select]').forEach((button) => button.addEventListener('click', () => activateStoryChapter(button.dataset.storySelect)));
  $$('[data-story-edit]').forEach((button) => button.addEventListener('click', () => openStoryEditor(button.dataset.storyEdit)));
  $$('[data-story-move]').forEach((button) => button.addEventListener('click', () => {
    state.story = moveStoryChapter(state.story, button.dataset.storyId, Number(button.dataset.storyMove));
    renderStoryBuilder();
  }));
}

function openStoryEditor(chapterId = null) {
  if (!chapterId && !state.plotSpec) { showToast('Build a chart first', 'A story chapter needs a rendered 3D scene.', 'error'); return; }
  const chapter = chapterId ? state.story.chapters.find((item) => item.id === chapterId) : null;
  $('#story-dialog-title').textContent = chapter ? 'Edit story chapter' : 'Capture this scene';
  $('#story-chapter-id').value = chapter?.id ?? '';
  $('#story-title-input').value = chapter?.title ?? state.settings.title ?? '';
  $('#story-takeaway-input').value = chapter?.takeaway ?? '';
  $('#story-annotation-input').value = chapter?.annotation ?? '';
  $('#story-action-input').value = chapter?.action ?? '';
  $('#story-font-select').value = chapter?.style?.fontFamily ?? 'system';
  $('#story-layout-select').value = chapter?.style?.layout ?? 'narrative-left';
  $('#story-accent-input').value = chapter?.style?.accentColor ?? '#175CD3';
  $('#story-text-input').value = chapter?.style?.textColor ?? (state.theme === 'dark' ? '#F9FAFB' : '#101828');
  $('#story-surface-input').value = chapter?.style?.surfaceColor ?? (state.theme === 'dark' ? '#111827' : '#FFFFFF');
  for (let index = 1; index <= 3; index += 1) {
    $(`#story-metric-label-${index}`).value = chapter?.metrics[index - 1]?.label ?? '';
    $(`#story-metric-value-${index}`).value = chapter?.metrics[index - 1]?.value ?? '';
  }
  $('#delete-story-chapter-button').classList.toggle('hidden', !chapter);
  $('#save-story-chapter-button').textContent = chapter ? 'Update chapter' : 'Save chapter';
  renderStoryInsights();
  $('#story-dialog').showModal();
  window.setTimeout(() => $('#story-title-input').focus(), 0);
}

function saveStoryChapter(event) {
  event.preventDefault();
  const chapterId = $('#story-chapter-id').value;
  const authored = {
    title: $('#story-title-input').value,
    takeaway: $('#story-takeaway-input').value,
    annotation: $('#story-annotation-input').value,
    action: $('#story-action-input').value,
    metrics: storyMetricsFromForm(),
    style: storyStyleFromForm(),
  };
  if (chapterId) state.story = updateStoryChapter(state.story, chapterId, authored);
  else {
    const chapter = createChapterSnapshot({
      ...authored,
      id: `chapter-${state.story.chapters.length + 1}`,
      chartId: state.activeChartId,
      chartType: LEGACY_TO_CONTRACT[state.chartType] ?? state.chartType,
      camera: state.settings.authoredCamera ?? state.plotSpec?.layout?.scene?.camera,
      filters: state.filters,
    });
    state.story = captureStoryChapter(state.story, chapter);
    if (state.story.chapters.length === 1) state.story = { ...state.story, title: authored.title || state.story.title };
  }
  $('#story-dialog').close();
  renderStoryBuilder();
  showToast(chapterId ? 'Chapter updated' : 'Scene captured', 'The chart, filters, camera, and narrative are saved together.');
}

function deleteStoryChapter() {
  const chapterId = $('#story-chapter-id').value;
  if (!chapterId) return;
  state.story = removeStoryChapter(state.story, chapterId);
  $('#story-dialog').close();
  renderStoryBuilder();
  showToast('Chapter removed', 'The remaining story sequence is preserved.');
}

function activateStoryChapter(chapterId) {
  state.story = selectStoryChapter(state.story, chapterId);
  const chapter = activeStoryChapter();
  if (!chapter) return;
  if (chapter.chartId && state.charts.some((chart) => chart.id === chapter.chartId) && chapter.chartId !== state.activeChartId) activateChart(chapter.chartId);
  state.filters = chapter.filters.filter((filter) => fieldById(filter.fieldId));
  if (chapter.camera) {
    state.settings = { ...state.settings, camera: 'custom', authoredCamera: chapter.camera };
  }
  renderFilters();
  syncSettingControls();
  renderStoryBuilder();
  scheduleChartRender();
}

async function renderStoryPresenter() {
  if ($('#story-presenter').classList.contains('hidden')) return;
  const chapter = activeStoryChapter();
  if (!chapter || !state.plotSpec) return;
  const index = state.story.chapters.findIndex((item) => item.id === chapter.id);
  $('#story-presenter-progress').textContent = `${index + 1} of ${state.story.chapters.length}`;
  $('#story-presenter-kicker').textContent = `CHAPTER ${String(index + 1).padStart(2, '0')}`;
  $('#story-presenter-title').textContent = chapter.title;
  $('#story-presenter-takeaway').textContent = chapter.takeaway;
  $('#story-presenter-metrics').innerHTML = chapter.metrics.map((metric) => `<div><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`).join('');
  applyStoryStyle($('#story-presenter'), chapter);
  const note = $('#story-presenter-note');
  note.textContent = chapter.action ? `Recommended action · ${chapter.action}` : chapter.annotation;
  note.classList.toggle('hidden', !note.textContent);
  $('#story-previous-button').disabled = index <= 0;
  $('#story-next-button').disabled = index >= state.story.chapters.length - 1;
  $('#story-presenter-dots').innerHTML = state.story.chapters.map((item, itemIndex) => `<button type="button" class="${item.id === chapter.id ? 'active' : ''}" data-present-story="${escapeHtml(item.id)}" aria-label="Open chapter ${itemIndex + 1}"></button>`).join('');
  $$('[data-present-story]').forEach((button) => button.addEventListener('click', () => activateStoryChapter(button.dataset.presentStory)));
  const layout = JSON.parse(JSON.stringify(state.plotSpec.layout));
  layout.paper_bgcolor = '#FFFFFF';
  layout.plot_bgcolor = '#FFFFFF';
  if (chapter.camera && layout.scene) layout.scene.camera = chapter.camera;
  await globalThis.Plotly.react($('#story-presenter-plot'), state.plotSpec.data, layout, { ...state.plotSpec.config, responsive: true });
}

function openStoryPresenter() {
  if (!state.story.chapters.length) return;
  const presenter = $('#story-presenter');
  presenter.classList.remove('hidden');
  presenter.setAttribute('aria-hidden', 'false');
  document.body.classList.add('presenter-open');
  activateStoryChapter(state.story.activeChapterId ?? state.story.chapters[0].id);
  renderStoryPresenter();
}

function closeStoryPresenter() {
  $('#story-presenter').classList.add('hidden');
  $('#story-presenter').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('presenter-open');
  if ($('#story-presenter-plot').data) globalThis.Plotly.purge($('#story-presenter-plot'));
}

function movePresentedChapter(direction) {
  const index = state.story.chapters.findIndex((chapter) => chapter.id === state.story.activeChapterId);
  const next = state.story.chapters[index + direction];
  if (next) activateStoryChapter(next.id);
}

function applyTheme(theme) {
  const previousTheme = state.theme;
  const canvas = resolveThemeCanvas(state.settings, previousTheme, theme);
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  $('#theme-toggle').title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
  state.settings.background = canvas.background;
  state.settings.plotBackground = canvas.plotBackground;
  syncSettingControls();
  scheduleChartRender();
}

function syncSettingControls() {
  $('#chart-title-input').value = state.settings.title ?? '';
  $('#aggregation-select').value = state.settings.aggregation ?? 'sum';
  $('#background-input').value = state.settings.background ?? '#F6F8FC';
  $('#background-value').textContent = (state.settings.background ?? '#F6F8FC').toUpperCase();
  $('#plot-background-input').value = state.settings.plotBackground ?? '#FFFFFF';
  $('#plot-background-value').textContent = (state.settings.plotBackground ?? '#FFFFFF').toUpperCase();
  $('#opacity-input').value = Math.round((state.settings.opacity ?? 0.9) * 100);
  $('#opacity-value').textContent = `${$('#opacity-input').value}%`;
  $('#marker-scale-input').value = Math.round((state.settings.markerScale ?? 1) * 100);
  $('#marker-scale-value').textContent = `${(state.settings.markerScale ?? 1).toFixed(1)}×`;
  $('#point-limit-input').value = state.settings.pointLimit ?? 8_000;
  $('#group-limit-input').value = state.settings.groupLimit ?? 60;
  $('#grid-toggle').checked = state.settings.grid !== false;
  $('#camera-select').value = state.settings.camera ?? 'perspective';
  $('#perspective-toggle').checked = state.settings.perspective !== false;
  for (const axis of ['x', 'y', 'z']) {
    $(`#${axis}-title-input`).value = state.settings[`${axis}Title`] ?? '';
    $(`#${axis}-min-input`).value = state.settings[`${axis}Min`] ?? '';
    $(`#${axis}-max-input`).value = state.settings[`${axis}Max`] ?? '';
    $(`#reverse-${axis}`).checked = state.settings[`reverse${axis.toUpperCase()}`] === true;
  }
  $$('[data-setting]').forEach((control) => {
    const path = control.dataset.setting.split('.');
    let value = path.reduce((current, part) => current?.[part], state.settings);
    if (control.id === 'marker-mode-select') value = state.settings.markerMode;
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else if (value !== undefined) control.value = control.dataset.valueType === 'percent' ? Math.round(Number(value) * 100) : value;
    const output = control.closest('.range-control')?.querySelector('output');
    if (output && control.dataset.valueType === 'percent') output.textContent = `${control.value}%`;
  });
  const exportResolution = `${state.settings.exportWidth ?? 1920}x${state.settings.exportHeight ?? 1080}`;
  if ([...$('#export-resolution-select').options].some((option) => option.value === exportResolution)) $('#export-resolution-select').value = exportResolution;
  renderPaletteOptions();
}

function setMode(mode) {
  state.mode = mode;
  document.documentElement.dataset.mode = mode;
  $$('.mode-option').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  showToast(`${mode === 'guided' ? 'Guided' : 'Advanced'} mode`, mode === 'guided' ? 'Prism will recommend mappings and transformations.' : 'All semantic, filter, style, and axis controls are available.');
}

function renderChartHealth(spec, filteredRowCount) {
  const health = assessChartHealth({
    contract: getChartContract(LEGACY_TO_CONTRACT[state.chartType] ?? state.chartType),
    diagnostics: { ...spec.stats, filteredRows: filteredRowCount, sourceRows: state.dataset.rowCount },
    spec,
  });
  $('#quality-status').textContent = health.label;
  $('#quality-status').dataset.status = health.status;
  $('#quality-summary').textContent = health.status === 'presentation-ready'
    ? 'Axes, chart structure, rendering budget, and visible transformations pass the presentation checks.'
    : health.status === 'building' ? 'Complete the required mappings to begin quality checks.' : 'Resolve important findings before presenting this chart.';
  $('#chart-health').innerHTML = health.issues.length
    ? health.issues.map((currentIssue) => `<div class="health-item ${currentIssue.severity}"><span>${currentIssue.severity === 'blocker' ? '!' : currentIssue.severity === 'important' ? '△' : 'i'}</span><span>${escapeHtml(currentIssue.message)}</span><button type="button" data-health-action="${escapeHtml(currentIssue.action)}">${escapeHtml(currentIssue.actionLabel)}</button></div>`).join('')
    : '<div class="health-item suggestion"><span>✓</span><span>No material chart-quality issues detected.</span></div>';
  $$('[data-health-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.healthAction;
    if (action === 'clearFilters') { state.filters = []; renderFilters(); scheduleChartRender(); return; }
    if (action === 'preserveSurfaceGaps') { state.settings.connectGaps = false; syncSettingControls(); scheduleChartRender(); return; }
    if (['inspectTransformation', 'enableSampling'].includes(action)) { $('#tab-appearance').click(); $('#point-limit-input').focus(); return; }
    if (['sortTrajectory', 'inspectLineOrder'].includes(action)) { $('#tab-build').click(); $('[data-role-id="order"]')?.focus(); return; }
    if (action === 'formatAxes') { $('#tab-scene').click(); $('#x-title-input').focus(); return; }
    if (action === 'inspectSurfaceGrid') { $('#tab-build').click(); $('[data-role-id="x"]')?.focus(); return; }
    showToast('Quality guidance', 'Review the highlighted chart data and mappings.');
  }));
}

function showStudio() {
  $('#welcome-view').classList.add('hidden');
  $('#studio-view').classList.remove('hidden');
  ['#new-file-button', '#import-project-button', '#export-json-button', '#topbar-overflow', '#view-code-button', '#publish-button', '#export-html-button', '#mode-switch', '#add-calculation-button'].forEach((selector) => $(selector).classList.remove('hidden'));
  renderStoryBuilder();
}

function updateSourceSummary() {
  const { file, dataset } = state;
  $('#source-file-name').textContent = file?.name ?? 'Local workbook';
  $('#source-meta').textContent = `${dataset.rowCount.toLocaleString()} rows · ${dataset.fields.length} fields`;
  $('#field-count').textContent = dataset.fields.length;
  $('#file-summary').innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'privacy-dot';
  const text = document.createElement('span');
  text.textContent = `${file?.name ?? 'Local data'} · memory only`;
  $('#file-summary').append(dot, text);
}

function populateSheetSelect() {
  const select = $('#sheet-select');
  select.innerHTML = '';
  state.parsed.sheetNames.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.selected = name === state.dataset.sheetName;
    select.append(option);
  });
}

function renderFieldLegend() {
  const types = [...new Set(state.dataset.fields.map((field) => field.type))];
  $('#field-legend').innerHTML = types.map((type) => `<span class="type-mini type-${type}">${escapeHtml(type)}</span>`).join('');
}

function currentSchema() { return CHART_SCHEMAS[state.chartType]; }

function supportedByChart(field) {
  return compatibleRoles(state.chartType, field.type).length > 0;
}

function renderFields() {
  const query = state.fieldSearch.trim().toLowerCase();
  const activeRole = currentSchema().roles.find((role) => role.id === state.activeRole);
  const fields = state.dataset.fields.filter((field) => !query || field.label.toLowerCase().includes(query) || field.type.includes(query));
  const list = $('#field-list');
  list.innerHTML = fields.map((field) => {
    const supported = supportedByChart(field);
    const activeCompatible = activeRole ? isFieldCompatible(field.type, activeRole.accepts) : null;
    const className = activeRole
      ? activeCompatible ? 'active-compatible' : 'active-incompatible'
      : supported ? 'supported' : 'unsupported';
    const qualityClass = (field.quality?.invalidCount ?? 0) > 0 ? 'warning' : '';
    return `<div class="field-item ${className}" role="option" aria-label="Assign ${escapeHtml(field.label)}" tabindex="0" draggable="${supported}" data-field-id="${escapeHtml(field.id)}" title="${escapeHtml(field.label)}">
      <span class="field-type-icon type-${field.type}">${TYPE_ICONS[field.type] ?? 'Aa'}</span>
      <span class="field-content"><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(field.semanticType ?? field.type)} · ${(field.uniqueCount ?? 0).toLocaleString()} unique${field.override?.active ? ' · overridden' : ''}</span></span>
      <span class="quality-dot ${qualityClass}" title="${qualityClass ? 'Conversion warnings' : 'Profile ready'}"></span>
      <button class="field-edit" type="button" data-edit-field="${escapeHtml(field.id)}" aria-label="Change data type for ${escapeHtml(field.label)}">Aa</button>
      <span class="field-drag" aria-hidden="true">⠿</span>
    </div>`;
  }).join('') || '<div class="section-copy" style="padding:12px">No matching fields.</div>';

  $$('.field-item', list).forEach((item) => {
    item.addEventListener('dragstart', (event) => {
      item.classList.add('dragging');
      event.dataTransfer.setData('text/plain', item.dataset.fieldId);
      event.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('click', (event) => { if (!event.target.closest('[data-edit-field]')) assignFieldByClick(item.dataset.fieldId); });
    item.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key) && !event.target.closest('[data-edit-field]')) { event.preventDefault(); assignFieldByClick(item.dataset.fieldId); } });
  });
  $$('[data-edit-field]', list).forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); openTypeEditor(button.dataset.editField); }));
}

function renderChartTypes() {
  $('#chart-type-list').innerHTML = Object.values(CHART_SCHEMAS).map((schema) => `<button class="chart-type-button ${schema.id === state.chartType ? 'active' : ''}" data-chart-type="${schema.id}" type="button" role="radio" aria-label="${escapeHtml(schema.label)}" title="${escapeHtml(schema.label)}" aria-checked="${schema.id === state.chartType}">
    <span class="chart-icon">${chartIcon(schema.id)}</span><span><strong>${escapeHtml(schema.shortLabel)}</strong><small>${schema.roles.filter((role) => role.required).length} axes</small></span>
  </button>`).join('');
  $$('.chart-type-button').forEach((button) => button.addEventListener('click', () => changeChartType(button.dataset.chartType)));
}

function renderMappings() {
  const schema = currentSchema();
  const features = new Set(schema.features ?? []);
  $$('[data-feature]').forEach((element) => {
    const supported = element.dataset.feature.split(/\s+/).some((feature) => features.has(feature));
    element.hidden = !supported;
  });
  $('#mapping-chart-name').textContent = schema.label;
  $('#mapping-chart-description').textContent = schema.description;
  $('#aggregation-group').classList.toggle('hidden', state.chartType === 'bubble');
  const validation = validateMappings(state.chartType, state.mappings);
  $('#mapping-list').innerHTML = schema.roles.map((role) => {
    const field = state.mappings[role.id];
    const isInvalid = validation.incompatible.includes(role.id) || validation.missing.includes(role.id);
    return `<div class="mapping-slot ${field ? 'filled' : ''} ${state.activeRole === role.id ? 'active' : ''} ${isInvalid ? 'invalid' : ''}" data-role-id="${role.id}" tabindex="0" role="button" aria-label="Map ${escapeHtml(role.label)}">
      <div class="slot-label"><span>${escapeHtml(role.label)}</span><em>${role.required ? 'Required' : 'Optional'}</em></div>
      ${field ? `<div class="slot-field"><span class="field-type-icon type-${field.type}">${TYPE_ICONS[field.type]}</span><strong>${escapeHtml(field.label)}</strong><button class="slot-remove" data-remove-role="${role.id}" type="button" aria-label="Remove ${escapeHtml(field.label)}">×</button></div>` : '<div class="slot-empty"><span>＋</span> Drop or click a compatible field</div>'}
    </div>`;
  }).join('');

  $$('.mapping-slot').forEach((slot) => {
    const activate = () => { state.activeRole = slot.dataset.roleId; renderMappings(); renderFields(); };
    slot.addEventListener('click', (event) => { if (!event.target.closest('.slot-remove')) activate(); });
    slot.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
    slot.addEventListener('dragover', (event) => { event.preventDefault(); slot.classList.add('dragover'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
    slot.addEventListener('drop', (event) => {
      event.preventDefault();
      slot.classList.remove('dragover');
      assignField(event.dataTransfer.getData('text/plain'), slot.dataset.roleId);
    });
  });
  $$('.slot-remove').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    delete state.mappings[button.dataset.removeRole];
    state.activeRole = button.dataset.removeRole;
    renderMappings(); renderFields(); scheduleChartRender();
  }));
  renderValidation(validation);
}

function renderValidation(validation) {
  const box = $('#validation-box');
  box.className = `validation-box ${validation.valid ? 'valid' : validation.incompatible.length ? 'error' : ''}`;
  box.querySelector('span').textContent = validation.valid ? '✓' : validation.incompatible.length ? '!' : 'i';
  const message = validation.valid
    ? 'Ready. The chart updates automatically as you refine settings.'
    : validation.errors[0] ?? 'Choose the required fields to render this chart.';
  box.querySelector('p').textContent = message;
}

function assignFieldByClick(fieldId) {
  const field = state.dataset.fields.find((candidate) => candidate.id === fieldId);
  if (!field) return;
  const roles = currentSchema().roles.filter((role) => isFieldCompatible(field.type, role.accepts));
  if (roles.length === 0) {
    showToast('Field not supported', `${field.label} is not compatible with ${currentSchema().label}.`, 'error');
    return;
  }
  const requested = roles.find((role) => role.id === state.activeRole);
  const empty = roles.find((role) => !state.mappings[role.id]);
  assignField(fieldId, (requested ?? empty ?? roles[0]).id);
}

function assignField(fieldId, roleId) {
  const field = state.dataset.fields.find((candidate) => candidate.id === fieldId);
  const role = currentSchema().roles.find((candidate) => candidate.id === roleId);
  if (!field || !role || !isFieldCompatible(field.type, role.accepts)) {
    showToast('Incompatible mapping', `${field?.label ?? 'This field'} cannot be used for ${role?.label ?? 'that slot'}.`, 'error');
    return;
  }
  state.mappings[roleId] = field;
  state.activeRole = currentSchema().roles.find((candidate) => candidate.required && !state.mappings[candidate.id])?.id ?? null;
  renderMappings(); renderFields(); scheduleChartRender();
}

function autoMap(clearExisting = false) {
  state.mappings = autoMapFields(currentSchema(), state.dataset.fields, clearExisting ? {} : state.mappings);
  state.activeRole = currentSchema().roles.find((role) => role.required && !state.mappings[role.id])?.id ?? null;
  renderMappings(); renderFields(); scheduleChartRender();
}

function changeChartType(chartType) {
  if (!CHART_SCHEMAS[chartType] || chartType === state.chartType) return;
  state.chartType = chartType;
  const roles = new Map(currentSchema().roles.map((role) => [role.id, role]));
  state.mappings = Object.fromEntries(Object.entries(state.mappings).filter(([roleId, field]) => {
    const role = roles.get(roleId);
    return role && isFieldCompatible(field.type, role.accepts);
  }));
  renderChartTypes();
  autoMap(true);
}

function scheduleChartRender() {
  window.clearTimeout(state.renderTimer);
  const revision = ++state.renderRevision;
  state.renderTimer = window.setTimeout(() => renderChart(revision), 100);
}

async function renderChart(revision = ++state.renderRevision) {
  if (!state.dataset) return;
  if (revision !== state.renderRevision) return;
  const validation = validateMappings(state.chartType, state.mappings);
  const fallbackDataset = state.workbookWorker ? null : filteredDataset();
  let filteredRowCount = fallbackDataset?.rows.length ?? state.dataset.rowCount;
  const placeholder = $('#chart-placeholder');
  const loading = $('#plot-loading');
  if (!validation.valid) {
    placeholder.classList.remove('hidden');
    $('#chart-toolbar-subtitle').textContent = validation.errors[0] ?? 'Map compatible fields to begin';
    setChartStatus('waiting', validation.errors[0] ?? 'Waiting for required fields');
    if (globalThis.Plotly && $('#plot').data) globalThis.Plotly.purge($('#plot'));
    state.plotSpec = null;
    $('#quality-status').textContent = 'Building';
    $('#quality-status').dataset.status = 'building';
    $('#quality-summary').textContent = validation.errors[0] ?? 'Complete the required mappings to begin quality checks.';
    $('#chart-health').innerHTML = '';
    return;
  }
  if (!state.workbookWorker && filteredRowCount === 0) {
    placeholder.classList.remove('hidden');
    placeholder.querySelector('strong').textContent = 'No rows match the active filters';
    placeholder.querySelector('span').textContent = 'Adjust or clear filters to continue.';
    setChartStatus('error', `0 of ${state.dataset.rowCount.toLocaleString()} rows included`);
    renderChartHealth({ stats: { renderedPoints: 0, excludedRows: state.dataset.rowCount } }, 0);
    state.plotSpec = null;
    return;
  }
  loading.classList.remove('hidden');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    let spec;
    if (state.workbookWorker) {
      const result = await state.workbookWorker.query({
        chartType: state.chartType,
        mappings: Object.fromEntries(Object.entries(state.mappings).map(([role, field]) => [role, field.id])),
        settings: { ...state.settings, theme: state.theme },
        filters: filterAst(),
      });
      spec = result.spec;
      filteredRowCount = result.filteredRows;
    } else {
      spec = buildChartSpec(state.chartType, fallbackDataset, state.mappings, { ...state.settings, theme: state.theme });
    }
    if (filteredRowCount === 0) throw new Error('No rows match the active filters. Adjust or clear filters to continue.');
    if ((spec.stats.renderedPoints ?? spec.stats.groups ?? 0) === 0) throw new Error('No valid observations remain for these mappings. Review field types, values and filters.');
    if (revision !== state.renderRevision) return;
    state.plotSpec = spec;
    const plot = $('#plot');
    await globalThis.Plotly.react(plot, spec.data, spec.layout, spec.config);
    if (typeof plot.removeAllListeners === 'function') plot.removeAllListeners('plotly_relayout');
    if (typeof plot.on === 'function') plot.on('plotly_relayout', (event) => {
      const nextSettings = captureCamera(state.settings, event);
      if (nextSettings === state.settings) return;
      state.settings = nextSettings;
      syncActiveChart();
    });
    if (typeof plot.removeAllListeners === 'function') plot.removeAllListeners('plotly_webglcontextlost');
    if (typeof plot.on === 'function') plot.on('plotly_webglcontextlost', () => {
      state.plotSpec = null;
      placeholder.classList.remove('hidden');
      placeholder.querySelector('strong').textContent = 'The 3D graphics context was lost';
      placeholder.querySelector('span').textContent = 'Data and mappings are retained. Select a suggested chart or reduce its point limit to retry.';
      setChartStatus('error','3D graphics unavailable. Review your browser graphics settings or reduce chart density.');
    });
    if (revision !== state.renderRevision) { scheduleChartRender(); return; }
    placeholder.classList.add('hidden');
    $('#chart-toolbar-title').textContent = state.settings.title || currentSchema().label;
    const count = spec.stats.renderedPoints ?? spec.stats.groups ?? 0;
    const unit = spec.stats.renderedPoints !== undefined ? 'points' : 'groups';
    $('#chart-toolbar-subtitle').textContent = `${currentSchema().label} · ${count.toLocaleString()} ${unit}`;
    const exclusions = spec.stats.excludedRows ? ` · ${spec.stats.excludedRows.toLocaleString()} invalid rows omitted` : '';
    const transforms = [
      spec.stats.sampledOutRows ? `${spec.stats.sampledOutRows.toLocaleString()} observations sampled out` : '',
      spec.stats.omittedGroups ? `${spec.stats.omittedGroups.toLocaleString()} lower-ranked groups hidden` : '',
    ].filter(Boolean);
    $('#chart-insight-summary').textContent = `${state.settings.title || currentSchema().label}. ${count.toLocaleString()} ${unit} rendered from ${filteredRowCount.toLocaleString()} included rows.${transforms.length ? ` Transformations: ${transforms.join('; ')}.` : ''}`;
    setChartStatus('ready', `Rendered locally · ${filteredRowCount.toLocaleString()} of ${state.dataset.rowCount.toLocaleString()} rows · ${count.toLocaleString()} ${unit}${exclusions}${transforms.length ? ` · ${transforms.join(' · ')}` : ''}`);
    renderChartHealth(spec, filteredRowCount);
    syncActiveChart();
    renderStoryBuilder();
    await renderStoryPresenter();
  } catch (error) {
    if (revision !== state.renderRevision) return;
    state.plotSpec = null;
    if (globalThis.Plotly && $('#plot').data) globalThis.Plotly.purge($('#plot'));
    placeholder.classList.remove('hidden');
    placeholder.querySelector('strong').textContent = 'This chart could not be rendered';
    placeholder.querySelector('span').textContent = error.message;
    setChartStatus('error', error.message);
    showToast('Chart error', error.message, 'error');
  } finally {
    if (revision === state.renderRevision) loading.classList.add('hidden');
  }
}

function setChartStatus(type, message) {
  $('#chart-status').innerHTML = `<span class="status-dot status-${type}"></span>${escapeHtml(message)}`;
}

function renderPaletteOptions() {
  $('#palette-grid').innerHTML = Object.entries(PALETTES).map(([id, palette]) => `<button class="palette-option ${state.settings.palette === id ? 'active' : ''}" data-palette="${id}" type="button"><div class="palette-swatch" style="background:linear-gradient(90deg,${palette.colors.join(',')})"></div><span>${escapeHtml(palette.label)}</span></button>`).join('');
  $$('.palette-option').forEach((button) => button.addEventListener('click', () => {
    state.settings.palette = button.dataset.palette;
    renderPaletteOptions(); scheduleChartRender();
  }));
}

function renderPreview() {
  const dataset = state.dataset;
  $('#preview-title').textContent = `${state.file?.name ?? 'Workbook'} · ${dataset.sheetName}`;
  $('#preview-summary').innerHTML = `<span class="summary-chip">${dataset.rowCount.toLocaleString()} rows</span><span class="summary-chip">${dataset.fields.length} columns</span><span class="summary-chip">${new Set(dataset.fields.map((field) => field.semanticType ?? field.type)).size} semantic types</span>${dataset.truncated ? '<span class="summary-chip">Certified 100,000-row boundary loaded</span>' : ''}`;
  const table = $('#preview-table');
  table.innerHTML = '';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  dataset.fields.forEach((field) => {
    const th = document.createElement('th');
    th.textContent = `${field.label} · ${field.typeLabel}`;
    headerRow.append(th);
  });
  thead.append(headerRow);
  const tbody = document.createElement('tbody');
  dataset.rows.slice(0, 25).forEach((row) => {
    const tr = document.createElement('tr');
    dataset.fields.forEach((field) => {
      const td = document.createElement('td');
      td.textContent = formatFieldValue(row[field.id], field);
      td.title = td.textContent;
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
}

function openPreview() {
  renderPreview();
  $('#drawer-backdrop').classList.remove('hidden');
  $('#preview-drawer').classList.add('open');
  $('#preview-drawer').setAttribute('aria-hidden', 'false');
}

function closePreview() {
  $('#drawer-backdrop').classList.add('hidden');
  $('#preview-drawer').classList.remove('open');
  $('#preview-drawer').setAttribute('aria-hidden', 'true');
}

async function loadFile(file, inputOptions = state.importOptions, sheetName) {
  if (!file || state.importStatus.busy) return;
  const validation = validateImportFile(file);
  if (!validation.ok) {
    showToast('Unsupported file', validation.message, 'error');
    return;
  }
  beginImportProgress(file.name);
  const importRevision = ++state.importRevision;
  let candidateWorker;
  const dropzone = $('#dropzone');
  if ($('.dropzone-title')) $('.dropzone-title').textContent = 'Spreadsheet selected';
  try {
    const options = normalizeImportOptions(inputOptions);
    const bytes = await file.arrayBuffer();
    if (importRevision !== state.importRevision) return;
    state.importStatus = advanceImport(state.importStatus, 'Opening workbook structure', 34);
    renderImportStatus();
    candidateWorker = createWorkbookWorkerClient();
    state.pendingWorker = candidateWorker;
    let parsed;
    let dataset;
    if (candidateWorker) {
      state.importStatus = advanceImport(state.importStatus, 'Profiling sheets and column types', 58);
      renderImportStatus();
      const result = await candidateWorker.load(bytes, file.name, options, sheetName);
      parsed = result.parsed;
      dataset = result.dataset;
    } else {
      throw new Error('This browser cannot start the local data worker. Open Prism in a current Chrome or Edge browser.');
    }
    if (importRevision !== state.importRevision) { candidateWorker?.dispose(); return; }
    state.workbookWorker?.dispose();
    state.workbookWorker = candidateWorker;
    state.pendingWorker = null;
    state.importOptions = options;
    ++state.renderRevision;
    state.plotSpec = null;
    state.importStatus = advanceImport(state.importStatus, 'Preparing the 3D workspace', 92);
    renderImportStatus();
    state.file = file;
    state.parsed = parsed;
    state.dataset = dataset;
    setChartStatus('waiting','Preparing selected dataset');
    for (const axis of ['x','y','z']) { delete state.settings[`${axis}Title`]; delete state.settings[`${axis}Min`]; delete state.settings[`${axis}Max`]; }
    state.mappings = {};
    state.activeRole = null;
    state.filters = [];
    state.calculations = [];
    state.story = createStoryState();
    state.fieldSearch = ''; $('#field-search').value = '';
    state.charts = [];
    state.activeChartId = 'chart-1';
    showStudio();
    populateSheetSelect();
    updateSourceSummary();
    renderFieldLegend();
    renderChartTypes();
    renderPaletteOptions();
    renderFilterComposer();
    renderFilters();
    updateDataIntelligence();
    applyRecommendation(dataset.recommendations?.[0]);
    state.charts = [currentChartSnapshot('chart-1')];
    renderChartTray();
    stopImportProgress();
    state.importStatus = completeImport(state.importStatus, { rows: dataset.rowCount, fields: dataset.fields.length });
    renderImportStatus();
    showToast('Spreadsheet ready', `${dataset.rowCount.toLocaleString()} rows and ${dataset.fields.length} fields detected locally.`);
  } catch (error) {
    if (importRevision !== state.importRevision) return;
    if (candidateWorker !== state.workbookWorker) candidateWorker?.dispose();
    state.pendingWorker = null;
    stopImportProgress();
    state.importStatus = failImport(state.importStatus, error.message);
    renderImportStatus();
    if ($('.dropzone-title')) $('.dropzone-title').textContent = 'Choose another spreadsheet';
    showToast('Could not open this file', error.message, 'error');
  } finally {
    dropzone.classList.remove('dragover');
    $('#file-input').value = '';
  }
}

function cancelImport() {
  if (!state.importStatus.busy) { state.importStatus = createImportState(); renderImportStatus(); return; }
  ++state.importRevision;
  state.pendingWorker?.dispose(); state.pendingWorker = null;
  stopImportProgress();
  state.importStatus = failImport(state.importStatus, 'Import cancelled. Your previous dataset is still available.');
  renderImportStatus();
}

function openImportSettings() {
  const o = state.importOptions;
  $('#import-header-row').value = o.headerRow;
  $('#import-headerless').checked = o.headerless;
  $('#import-delimiter').value = o.delimiter === '\t' ? 'tab' : o.delimiter;
  $('#import-numeric-locale').value = o.numericLocale;
  $('#import-date-order').value = o.dateOrder;
  $('#import-percent-scale').value = o.percentScale;
  $('#import-settings-dialog').showModal();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportConfig() {
  if (!state.dataset) return;
  syncActiveChart();
  const project = exportProject({
    theme: state.theme, mode: state.mode, view: 'focus', fields: state.dataset.fields,
    charts: state.charts, filters: state.filters, calculations: state.calculations, story: state.story,
    source: { fileName: state.file?.name, sheetName: state.dataset.sheetName, rowCount: state.dataset.rowCount, importOptions: state.importOptions },
  });
  downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'prism-project.prism.json');
  showToast('Project saved', 'Mappings, filters, calculations, themes, and charts were exported without source rows.');
}

async function loadProjectFile(file) {
  if (!state.dataset) { showToast('Connect data first', 'Open the workbook that this Prism project should use.', 'error'); return; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateProjectBytes(bytes);
    if (!validation.ok) throw new Error(validation.message);
    const project = JSON.parse(new TextDecoder().decode(bytes));
    if (project.source?.importOptions && JSON.stringify(normalizeImportOptions(project.source.importOptions)) !== JSON.stringify(state.importOptions)) throw new Error('This project uses different import settings. Apply its header, number, date and percent conventions through Review import settings before opening it.');
    const imported = importProject(project, state.dataset.fields);
    if (state.workbookWorker) {
      state.dataset = (await state.workbookWorker.applyProject(imported.workspace.fieldOverrides ?? [], imported.workspace.calculations ?? [])).dataset;
      state.calculations = imported.workspace.calculations ?? [];
    } else {
      state.dataset.fields = state.dataset.fields.filter((field) => !field.calculated);
      for (const override of imported.workspace.fieldOverrides ?? []) {
        const field = fieldById(override.fieldId);
        if (!field) continue;
        const preview = previewTypeOverride(field, state.dataset.rows.map((row) => row[field.id]), override.semanticType);
        const updated = applyTypeOverride(field, preview);
        state.dataset.fields = state.dataset.fields.map((candidate) => candidate.id === field.id ? updated : candidate);
      }
      state.calculations = [];
      for (const definition of imported.workspace.calculations ?? []) { materializeCalculation(definition); state.calculations.push(definition); }
    }
    state.theme = imported.workspace.theme ?? 'light';
    state.mode = imported.workspace.mode ?? 'guided';
    state.filters = (imported.workspace.filters ?? []).filter((filter) => fieldById(filter.fieldId));
    state.story = imported.workspace.story ?? createStoryState();
    state.charts = imported.workspace.charts?.length ? imported.workspace.charts : state.charts;
    const importedFirstChartId = state.charts[0]?.id ?? null;
    state.activeChartId = null;
    applyTheme(state.theme); setMode(state.mode); syncSettingControls(); renderFieldLegend(); renderFields(); renderFilters(); renderStoryBuilder();
    if (importedFirstChartId) activateChart(importedFirstChartId, { syncCurrent: false });
    const missing = imported.diagnostics.missingFields.length;
    showToast('Project opened', missing ? `${missing} field${missing === 1 ? '' : 's'} could not be matched; review highlighted roles.` : `${imported.diagnostics.mappedFields} fields reconciled to this workbook.` , missing ? 'error' : 'info');
  } catch (error) {
    showToast('Project could not be opened', error.message, 'error');
  } finally {
    $('#project-input').value = '';
  }
}

function embeddedPlotlySource() {
  return $('#prism-plotly-runtime')?.textContent?.trim() ?? '';
}

function exportInteractiveHtml() {
  if (!state.plotSpec) {
    showToast('Nothing to export yet', 'Complete the required field mappings first.', 'error');
    return;
  }
  try {
    const documentHtml = generateInteractiveChartHtml(state.plotSpec, {
      plotlySource: embeddedPlotlySource(), theme: state.theme,
      story: activeStoryChapter() ?? { title: state.settings.title, metrics: [] },
    });
    const baseName = String(state.settings.title || 'prism-3d-chart').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'prism-3d-chart';
    downloadBlob(new Blob([documentHtml], { type: 'text/html' }), `${baseName}.html`);
    showToast('Interactive HTML exported', 'The self-contained chart opens offline with rotate, pinch, zoom, hover, and reset controls.');
  } catch (error) {
    showToast('Export failed', error.message, 'error');
  }
}

function openCodeViewer() {
  if (!state.plotSpec) { showToast('Finish the chart first', 'Complete the required mappings before viewing code.', 'error'); return; }
  $('#plotly-code-output').value = generatePlotlyCode(state.plotSpec);
  $('#code-dialog').showModal();
}

async function copyPlotlyCode() {
  try {
    await navigator.clipboard.writeText($('#plotly-code-output').value);
    showToast('Code copied', 'The complete Plotly figure is on your clipboard.');
  } catch {
    $('#plotly-code-output').select();
    showToast('Code selected', 'Press Ctrl+C to copy the selected code.');
  }
}

function downloadPlotlyCode() {
  exportInteractiveHtml();
}

function openPublisher() {
  if (!state.plotSpec) { showToast('Finish the chart first', 'Complete the required mappings before publishing.', 'error'); return; }
  $('#briefing-title').value = state.settings.title || 'Executive 3D briefing';
  $('#publish-result').classList.add('hidden');
  $('#publish-dialog').showModal();
}

async function publishBriefing(event) {
  event.preventDefault();
  if (!__PRISM_HOSTED__) { showToast('Open the hosted studio', 'Secure links are created from the hosted Prism app.', 'error'); return; }
  const submit = $('#publish-submit');
  submit.disabled = true;
  submit.textContent = 'Publishing…';
  try {
    const metricText = $('#briefing-metric').value.trim();
    const packageValue = buildBriefingPackage({
      plotSpec: state.plotSpec,
      source: { rowCount: state.dataset?.rowCount },
      story: state.story.chapters.length ? {
        ...state.story,
        title: $('#briefing-title').value || state.story.title,
        takeaway: $('#briefing-takeaway').value || activeStoryChapter()?.takeaway,
        freshness: $('#briefing-freshness').value,
        explore: $('#briefing-explore').checked,
        metrics: metricText ? [{ label: 'Key metric', value: metricText }] : activeStoryChapter()?.metrics ?? [],
      } : {
        title: $('#briefing-title').value, takeaway: $('#briefing-takeaway').value,
        freshness: $('#briefing-freshness').value, explore: $('#briefing-explore').checked,
        metrics: metricText ? [{ label: 'Key metric', value: metricText }] : [],
      },
    });
    const response = await fetch('/api/briefings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packageValue) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && result.signIn) window.location.href = result.signIn;
      throw new Error(result.error || 'The briefing could not be published.');
    }
    const url = new URL(result.url, window.location.origin).href;
    $('#publish-result').innerHTML = `<strong>Briefing ready</strong><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a><button class="button button-ghost" id="copy-link-button" type="button">Copy link</button>`;
    $('#publish-result').classList.remove('hidden');
    $('#copy-link-button').addEventListener('click', async () => { await navigator.clipboard.writeText(url); showToast('Link copied', 'Ready to share with your audience.'); });
    showToast('Secure briefing published', 'Your browser link is ready.');
  } catch (error) { showToast('Publishing failed', error.message, 'error'); }
  finally { submit.disabled = false; submit.textContent = 'Create secure link'; }
}

function updateSettingPath(path, value) {
  const parts = path.split('.');
  if (parts.length === 1) {
    state.settings[parts[0]] = value;
    return;
  }
  const [parent, child] = parts;
  state.settings[parent] = { ...(state.settings[parent] ?? {}), [child]: value };
}

function bindChartAwareControls() {
  $('.config-panel').addEventListener('input', (event) => {
    const control = event.target.closest('[data-setting]');
    if (!control) return;
    let value = control.type === 'checkbox' ? control.checked : control.value;
    if (control.dataset.valueType === 'number') value = Number(value);
    if (control.dataset.valueType === 'percent') value = Number(value) / 100;
    const setting = control.dataset.setting;
    updateSettingPath(setting, value);
    if (setting === 'projection') {
      state.settings.perspective = value === 'perspective';
      $('#perspective-toggle').checked = state.settings.perspective;
    }
    const output = control.closest('.range-control')?.querySelector('output');
    if (output && control.dataset.valueType === 'percent') output.textContent = `${control.value}%`;
    scheduleChartRender();
  });
  $('#export-resolution-select').addEventListener('change', (event) => {
    const [width, height] = event.target.value.split('x').map(Number);
    state.settings.exportWidth = width;
    state.settings.exportHeight = height;
  });
}

function bindSettingControls() {
  $('#chart-title-input').addEventListener('input', (event) => {
    state.settings.title = event.target.value;
    $('#chart-toolbar-title').textContent = event.target.value || currentSchema().label;
    scheduleChartRender();
  });
  $('#aggregation-select').addEventListener('change', (event) => { state.settings.aggregation = event.target.value; scheduleChartRender(); });
  $('#background-input').addEventListener('input', (event) => { state.settings.background = event.target.value.toUpperCase(); $('#background-value').textContent = state.settings.background; scheduleChartRender(); });
  $('#plot-background-input').addEventListener('input', (event) => { state.settings.plotBackground = event.target.value.toUpperCase(); $('#plot-background-value').textContent = state.settings.plotBackground; scheduleChartRender(); });
  $('#opacity-input').addEventListener('input', (event) => { state.settings.opacity = Number(event.target.value) / 100; $('#opacity-value').textContent = `${event.target.value}%`; scheduleChartRender(); });
  $('#marker-scale-input').addEventListener('input', (event) => { state.settings.markerScale = Number(event.target.value) / 100; $('#marker-scale-value').textContent = `${state.settings.markerScale.toFixed(1)}×`; scheduleChartRender(); });
  $('#point-limit-input').addEventListener('change', (event) => { state.settings.pointLimit = Math.max(100, Math.min(8_000, Number(event.target.value) || 8_000)); syncSettingControls(); scheduleChartRender(); });
  $('#group-limit-input').addEventListener('change', (event) => { state.settings.groupLimit = Math.max(10, Math.min(60, Number(event.target.value) || 60)); syncSettingControls(); scheduleChartRender(); });
  $('#grid-toggle').addEventListener('change', (event) => { state.settings.grid = event.target.checked; scheduleChartRender(); });
  $('#camera-select').addEventListener('change', (event) => {
    state.settings.camera = event.target.value;
    delete state.settings.authoredCamera;
    if (['front', 'rear', 'left', 'right', 'top'].includes(event.target.value)) {
      state.settings.perspective = false;
      state.settings.projection = 'orthographic';
      $('#projection-select').value = 'orthographic';
    }
    $('#perspective-toggle').checked = state.settings.perspective;
    scheduleChartRender();
  });
  $('#perspective-toggle').addEventListener('change', (event) => {
    state.settings.perspective = event.target.checked;
    state.settings.projection = event.target.checked ? 'perspective' : 'orthographic';
    $('#projection-select').value = state.settings.projection;
    scheduleChartRender();
  });

  ['x', 'y', 'z'].forEach((axis) => {
    $(`#${axis}-title-input`).addEventListener('input', (event) => { state.settings[`${axis}Title`] = event.target.value; scheduleChartRender(); });
    $(`#reverse-${axis}`).addEventListener('change', (event) => { state.settings[`reverse${axis.toUpperCase()}`] = event.target.checked; scheduleChartRender(); });
    ['min', 'max'].forEach((edge) => $(`#${axis}-${edge}-input`).addEventListener('input', (event) => {
      const key = `${axis}${edge[0].toUpperCase()}${edge.slice(1)}`;
      if (event.target.value === '') delete state.settings[key];
      else state.settings[key] = Number(event.target.value);
      scheduleChartRender();
    }));
  });
  bindChartAwareControls();
}

function bindUi() {
  const fileInput = $('#file-input');
  const projectInput = $('#project-input');
  ['#choose-file-button', '#new-file-button'].forEach((selector) => $(selector).addEventListener('click', () => fileInput.click()));
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
  $('#import-project-button').addEventListener('click', () => projectInput.click());
  projectInput.addEventListener('change', () => loadProjectFile(projectInput.files[0]));
  $('#sample-data-button').addEventListener('click', () => {
    const sample = DOMAIN_SAMPLES[$('#sample-domain').value] ?? {name:'business-pipeline.csv',content:SAMPLE_CSV};
    loadFile(new File([sample.content], sample.name));
  });
  $('#cancel-import-button').addEventListener('click', cancelImport);
  ['#welcome-import-settings','#source-import-settings'].forEach(selector => $(selector).addEventListener('click', openImportSettings));
  $('#close-import-settings').addEventListener('click', () => $('#import-settings-dialog').close());
  $('#import-settings-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const options = normalizeImportOptions({headerRow:$('#import-header-row').value,headerless:$('#import-headerless').checked,delimiter:$('#import-delimiter').value === 'tab' ? '\t' : $('#import-delimiter').value,numericLocale:$('#import-numeric-locale').value,dateOrder:$('#import-date-order').value,percentScale:$('#import-percent-scale').value});
      $('#import-settings-dialog').close();
      if (state.file) loadFile(state.file, options, state.dataset.sheetName);
      else { state.importOptions = options; showToast('Import settings saved', 'Choose a dataset to use these conventions.'); }
    } catch (error) { showToast('Check import settings',error.message,'error'); }
  });
  const dropzone = $('#dropzone');
  dropzone.addEventListener('click', (event) => { if (!event.target.closest('button')) fileInput.click(); });
  dropzone.addEventListener('keydown', (event) => { if (event.target === dropzone && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));

  $('#sheet-select').addEventListener('change', async (event) => {
    const target = event.target.value;
    event.target.value = state.dataset.sheetName;
    await loadFile(state.file,state.importOptions,target);
  });
  $('#field-search').addEventListener('input', (event) => { state.fieldSearch = event.target.value; renderFields(); });
  $('#auto-map-button').addEventListener('click', () => autoMap(true));
  $('#save-chart-button').addEventListener('click', saveChart);
  $('#capture-story-button').addEventListener('click', () => openStoryEditor());
  $('#present-story-button').addEventListener('click', openStoryPresenter);
  $('#story-form').addEventListener('submit', saveStoryChapter);
  $('#refresh-story-insights').addEventListener('click', renderStoryInsights);
  $('#delete-story-chapter-button').addEventListener('click', deleteStoryChapter);
  $('#close-story-presenter').addEventListener('click', closeStoryPresenter);
  $('#story-previous-button').addEventListener('click', () => movePresentedChapter(-1));
  $('#story-next-button').addEventListener('click', () => movePresentedChapter(1));
  $('#chart-table-button').addEventListener('click', openPreview);
  $('#theme-toggle').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $$('.mode-option').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('#filter-field-select').addEventListener('change', renderFilterComposer);
  $('#filter-operator-select').addEventListener('change', renderFilterComposer);
  $('#add-filter-button').addEventListener('click', addFilter);
  $('#clear-filters-button').addEventListener('click', () => { state.filters = []; renderFilters(); scheduleChartRender(); });
  $('#type-select').addEventListener('change', renderTypePreview);
  $('#type-form').addEventListener('submit', applyEditedType);
  $('#reset-type-button').addEventListener('click', resetEditedType);
  $('#add-calculation-button').addEventListener('click', openCalculationEditor);
  $('#calculation-form').addEventListener('submit', createCalculation);
  $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.closeDialog}`).close()));
  $('#preview-data-button').addEventListener('click', openPreview);
  $('#close-preview-button').addEventListener('click', closePreview);
  $('#drawer-backdrop').addEventListener('click', closePreview);
  $('#export-json-button').addEventListener('click', exportConfig);
  $('#export-html-button').addEventListener('click', exportInteractiveHtml);
  $('#view-code-button').addEventListener('click', openCodeViewer);
  $('#copy-code-button').addEventListener('click', copyPlotlyCode);
  $('#download-code-button').addEventListener('click', downloadPlotlyCode);
  $('#publish-button').addEventListener('click', openPublisher);
  $('#publish-form').addEventListener('submit', publishBriefing);
  $('#topbar-overflow').addEventListener('click', (event) => {
    if (event.target.closest('button')) $('#topbar-overflow').removeAttribute('open');
  });

  $$('.config-tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.config-tab').forEach((candidate) => { const active = candidate === tab; candidate.classList.toggle('active', active); candidate.setAttribute('aria-selected', String(active)); });
    $$('.tab-pane').forEach((pane) => pane.classList.toggle('active', pane.dataset.pane === tab.dataset.tab));
  }));
  $('.config-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = $$('.config-tab');
    const current = tabs.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next].focus(); tabs[next].click();
  });
  $('#reset-camera-button').addEventListener('click', () => {
    if (state.plotSpec) globalThis.Plotly.relayout($('#plot'), cameraRelayoutPatch(state.settings, state.plotSpec.layout.scene.camera));
  });
  $('#fullscreen-button').addEventListener('click', async () => {
    const shell = $('#plot-shell');
    if (document.fullscreenElement) await document.exitFullscreen(); else await shell.requestFullscreen();
    window.setTimeout(() => globalThis.Plotly?.Plots.resize($('#plot')), 120);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closePreview(); if (!$('#story-presenter').classList.contains('hidden')) closeStoryPresenter(); }
    if (!$('#story-presenter').classList.contains('hidden') && event.key === 'ArrowLeft') movePresentedChapter(-1);
    if (!$('#story-presenter').classList.contains('hidden') && event.key === 'ArrowRight') movePresentedChapter(1);
  });
  window.addEventListener('resize', () => { if (state.plotSpec) globalThis.Plotly?.Plots.resize($('#plot')); });
  bindSettingControls();
}

bindUi();
renderImportStatus();
applyTheme('light');
renderChartTypes();
renderPaletteOptions();
renderStoryBuilder();
