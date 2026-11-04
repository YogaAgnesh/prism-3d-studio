import { sanitizeStoryState } from '../story/story-state.js';
import { normalizeImportOptions } from '../import/limits.js';

const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const CHART_TYPES = new Set(['scatter3d', 'columns3d', 'lollipop3d', 'surface3d']);
const FILTER_OPERATORS = new Set(['equals', 'on', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'gt', 'after', 'gte', 'lt', 'before', 'lte', 'between', 'isBlank', 'isNotBlank']);
const PALETTES = new Set(['spectrum', 'electric', 'sunset', 'ocean', 'candy', 'ember']);
const AGGREGATIONS = new Set(['sum', 'average', 'count', 'minimum', 'maximum']);
const CAMERAS = new Set(['perspective', 'front', 'rear', 'left', 'right', 'top', 'isometric', 'custom']);
const PROJECTIONS = new Set(['perspective', 'orthographic']);
const ASPECT_MODES = new Set(['auto', 'cube', 'data', 'manual']);
const TRACE_MODES = new Set(['markers', 'lines', 'lines+markers']);
const CALCULATION_TYPES = new Set(['number', 'currency', 'percent', 'text']);
const SEMANTIC_TYPES = new Set(['category', 'identifier', 'number', 'currency', 'percent', 'date', 'dateTime', 'boolean', 'fiscalPeriod', 'duration', 'geography', 'url', 'email', 'freeText']);
const COLOR = /^#[0-9a-f]{6}$/i;

const boundedText = (value, max = 256) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const safeValue = (value) => {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => boundedText(item, 1_000));
  return boundedText(value, 5_000);
};

function safeCamera(camera) {
  if (!camera || typeof camera !== 'object') return undefined;
  const vector = (input, fallback) => ({
    x: clamp(input?.x, -20, 20, fallback.x),
    y: clamp(input?.y, -20, 20, fallback.y),
    z: clamp(input?.z, -20, 20, fallback.z),
  });
  return {
    eye: vector(camera.eye, { x: 1.55, y: 1.55, z: 1.15 }),
    center: vector(camera.center, { x: 0, y: 0, z: 0 }),
    up: vector(camera.up, { x: 0, y: 0, z: 1 }),
    ...(PROJECTIONS.has(camera.projection?.type) ? { projection: { type: camera.projection.type } } : {}),
  };
}

function sanitizeSettings(settings = {}, title = '') {
  const sanitized = {
    title: boundedText(title || settings.title || 'Untitled 3D chart', 200),
    palette: PALETTES.has(settings.palette) ? settings.palette : 'spectrum',
    aggregation: AGGREGATIONS.has(settings.aggregation) ? settings.aggregation : 'sum',
    background: COLOR.test(settings.background) ? settings.background.toUpperCase() : '#090B14',
    plotBackground: COLOR.test(settings.plotBackground) ? settings.plotBackground.toUpperCase() : '#0E1220',
    opacity: clamp(settings.opacity, 0.1, 1, 0.9),
    markerScale: clamp(settings.markerScale, 0.5, 3, 1),
    markerMode: TRACE_MODES.has(settings.markerMode) ? settings.markerMode : 'markers',
    lineMode: TRACE_MODES.has(settings.lineMode) ? settings.lineMode : 'lines+markers',
    lineWidth: clamp(settings.lineWidth, 1, 16, 6),
    grid: settings.grid !== false,
    camera: CAMERAS.has(settings.camera) ? settings.camera : 'perspective',
    perspective: settings.perspective !== false,
    projection: PROJECTIONS.has(settings.projection) ? settings.projection : 'perspective',
    aspectmode: ASPECT_MODES.has(settings.aspectmode) ? settings.aspectmode : 'cube',
    aspectX: clamp(settings.aspectX, 0.1, 20, 1),
    aspectY: clamp(settings.aspectY, 0.1, 20, 1),
    aspectZ: clamp(settings.aspectZ, 0.1, 20, 1),
    showSpikes: settings.showSpikes === true,
    showZeroLine: settings.showZeroLine !== false,
    showContours: settings.showContours !== false,
    projectContours: settings.projectContours !== false,
    connectGaps: settings.connectGaps === true,
    surfaceBinning: settings.surfaceBinning === true,
    surfaceBins: clamp(settings.surfaceBins,2,50,20),
    lighting: {
      ambient: clamp(settings.lighting?.ambient, 0, 1, 0.65),
      diffuse: clamp(settings.lighting?.diffuse, 0, 1, 0.75),
      specular: clamp(settings.lighting?.specular, 0, 2, 0.35),
      roughness: clamp(settings.lighting?.roughness, 0, 1, 0.4),
      fresnel: clamp(settings.lighting?.fresnel, 0, 5, 0.15),
    },
    scrollZoom: settings.scrollZoom !== false,
    displayModeBar: settings.displayModeBar !== false,
    exportWidth: clamp(settings.exportWidth, 640, 7_680, 1_920),
    exportHeight: clamp(settings.exportHeight, 480, 4_320, 1_080),
    reverseX: settings.reverseX === true,
    reverseY: settings.reverseY === true,
    reverseZ: settings.reverseZ === true,
    pointLimit: clamp(settings.pointLimit, 100, 8_000, 8_000),
    groupLimit: clamp(settings.groupLimit, 10, 500, 60),
  };
  const authoredCamera = safeCamera(settings.authoredCamera);
  if (authoredCamera) sanitized.authoredCamera = authoredCamera;
  for (const axis of ['x', 'y', 'z']) {
    sanitized[`${axis}Title`] = boundedText(settings[`${axis}Title`], 200);
    const min = Number(settings[`${axis}Min`]);
    const max = Number(settings[`${axis}Max`]);
    if (Number.isFinite(min)) sanitized[`${axis}Min`] = min;
    if (Number.isFinite(max)) sanitized[`${axis}Max`] = max;
  }
  return sanitized;
}

export function exportProject(state) {
  return {
    product: 'Prism',
    version: 2,
    exportedAt: new Date().toISOString(),
    source: state.source ? { fileName: state.source.fileName, sheetName: state.source.sheetName, rowCount: state.source.rowCount, importOptions: normalizeImportOptions(state.source.importOptions) } : null,
    dataSignature: {
      fields: (state.fields ?? []).map((field) => ({
        id: field.id,
        label: field.label,
        semanticType: field.semanticType ?? field.type,
        type: field.type,
        format: field.format,
        inferredSemanticType: field.inferredSemanticType,
        inferredType: field.inferredType,
        overrideActive: field.override?.active === true,
      })),
    },
    workspace: {
      theme: state.theme,
      mode: state.mode,
      view: state.view,
      charts: state.charts ?? [],
      filters: state.filters ?? [],
      calculations: state.calculations ?? [],
      story: sanitizeStoryState(state.story),
    },
  };
}

export function importProject(project, currentFields = []) {
  if (!project || project.product !== 'Prism' || project.version !== 2 || !project.workspace) throw new Error('Choose a valid Prism version 2 project file.');
  if (!Array.isArray(project.workspace.charts) || project.workspace.charts.length > 100) throw new Error('The Prism project must contain between 0 and 100 charts.');
  for (const chart of project.workspace.charts) {
    if (!CHART_TYPES.has(chart?.chartType)) throw new Error(`Unsupported chart type in project: ${boundedText(chart?.chartType || 'missing')}.`);
  }
  const byId = new Map(currentFields.map((field) => [field.id, field]));
  const byLabel = new Map(currentFields.map((field) => [normalize(field.label), field]));
  const fieldMap = new Map();
  const missingFields = [];
  const fieldOverrides = [];
  const sourceCalculations = Array.isArray(project.workspace.calculations) ? project.workspace.calculations.slice(0, 100) : [];
  const calculations = sourceCalculations.map((calculation, index) => ({
    id: `calc_${index + 1}`,
    label: boundedText(calculation?.label || `Calculation ${index + 1}`, 200),
    expression: boundedText(calculation?.expression, 5_000),
    type: CALCULATION_TYPES.has(calculation?.type) ? calculation.type : 'number',
  }));
  sourceCalculations.forEach((calculation, index) => {
    if (typeof calculation?.id === 'string') fieldMap.set(calculation.id, calculations[index].id);
  });
  for (const source of project.dataSignature?.fields ?? []) {
    const positional = byId.get(source.id);
    const current = positional && normalize(positional.label) === normalize(source.label) ? positional : byLabel.get(normalize(source.label));
    const calculationId = fieldMap.get(source.id);
    if (calculationId) fieldMap.set(source.id, calculationId);
    else if (current) {
      fieldMap.set(source.id, current.id);
      if (source.overrideActive) {
        if (!SEMANTIC_TYPES.has(source.semanticType)) throw new Error(`Unsupported semantic type in project: ${boundedText(source.semanticType, 40)}.`);
        fieldOverrides.push({ fieldId: current.id, semanticType: source.semanticType });
      }
    }
    else missingFields.push(source.label);
  }
  const mapMappings = (mappings = {}) => Object.fromEntries(Object.entries(mappings)
    .filter(([role, fieldId]) => /^[a-z][a-z0-9_]{0,31}$/i.test(role) && !['constructor','prototype','__proto__'].includes(role) && typeof fieldId === 'string' && fieldMap.has(fieldId))
    .map(([role, fieldId]) => [role, fieldMap.get(fieldId)]));
  const chartIdMap = new Map(project.workspace.charts.map((chart, index) => [chart?.id, `chart-${index + 1}`]));
  const charts = project.workspace.charts.map((chart, index) => {
    const settings = sanitizeSettings(chart.settings, chart.title);
    return {
      id: `chart-${index + 1}`,
      chartType: chart.chartType,
      title: settings.title,
      mappings: mapMappings(chart.mappings),
      settings,
      tile: { width: 640, height: 420 },
    };
  });
  const filters = (Array.isArray(project.workspace.filters) ? project.workspace.filters : []).slice(0, 100).map((filter, index) => {
    if (!FILTER_OPERATORS.has(filter?.operator) || typeof filter?.fieldId !== 'string') throw new Error('The project contains an unsupported filter definition.');
    return {
      id: `filter-${index + 1}`,
      fieldId: fieldMap.get(filter.fieldId),
      operator: filter.operator,
      valueCanonical: filter.valueCanonical === true,
      value: safeValue(filter.value),
      value2: safeValue(filter.value2),
    };
  }).filter(filter => filter.fieldId);
  const story = sanitizeStoryState(project.workspace.story);
  const reconciledStory = {
    ...story,
    chapters: story.chapters.map((chapter, chapterIndex) => ({
      ...chapter,
      chartId: chartIdMap.get(chapter.chartId) ?? chapter.chartId,
      filters: chapter.filters.filter((filter) => FILTER_OPERATORS.has(filter?.operator) && typeof filter?.fieldId === 'string' && fieldMap.has(filter.fieldId)).map((filter, filterIndex) => ({
        id: `story-filter-${chapterIndex + 1}-${filterIndex + 1}`,
        fieldId: fieldMap.get(filter.fieldId),
        operator: filter.operator,
        valueCanonical: filter.valueCanonical === true,
        value: safeValue(filter.value),
        value2: safeValue(filter.value2),
      })),
    })),
  };
  return {
    workspace: {
      theme: ['dark', 'light'].includes(project.workspace.theme) ? project.workspace.theme : 'light',
      mode: ['guided', 'advanced'].includes(project.workspace.mode) ? project.workspace.mode : 'guided',
      view: 'focus',
      charts,
      filters,
      calculations,
      fieldOverrides,
      story: reconciledStory,
    },
    diagnostics: { missingFields, mappedFields: fieldMap.size },
  };
}
