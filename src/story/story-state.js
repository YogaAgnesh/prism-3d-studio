const MAX_CHAPTERS = 8;
const MAX_METRICS = 3;

const cleanText = (value, max = 240) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

const cloneValue = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

const COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const STYLE_DEFAULTS = Object.freeze({
  fontFamily: 'system', accentColor: '#175CD3', textColor: '#101828',
  surfaceColor: '#FFFFFF', layout: 'narrative-left',
});

function sanitizeStoryStyle(style = {}) {
  const color = (value, fallback) => {
    const normalized = String(value ?? '').trim().toUpperCase();
    return COLOR_PATTERN.test(normalized) ? normalized : fallback;
  };
  return {
    fontFamily: ['system', 'editorial', 'rounded', 'mono'].includes(style.fontFamily) ? style.fontFamily : STYLE_DEFAULTS.fontFamily,
    accentColor: color(style.accentColor, STYLE_DEFAULTS.accentColor),
    textColor: color(style.textColor, STYLE_DEFAULTS.textColor),
    surfaceColor: color(style.surfaceColor, STYLE_DEFAULTS.surfaceColor),
    layout: ['narrative-left', 'chart-focus', 'metrics-first'].includes(style.layout) ? style.layout : STYLE_DEFAULTS.layout,
  };
}

const safeId = (value, fallback) => {
  const result = cleanText(value, 80).replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-');
  return result || fallback;
};

const sanitizeMetric = (metric = {}) => ({
  label: cleanText(metric.label, 80),
  value: cleanText(metric.value, 80),
});

const sanitizeChapter = (chapter = {}, index = 0) => ({
  id: safeId(chapter.id, `chapter-${index + 1}`),
  title: cleanText(chapter.title, 120) || `Chapter ${index + 1}`,
  takeaway: cleanText(chapter.takeaway, 320),
  annotation: cleanText(chapter.annotation, 320),
  action: cleanText(chapter.action, 240),
  chartId: cleanText(chapter.chartId, 80),
  chartType: cleanText(chapter.chartType, 40),
  camera: cloneValue(chapter.camera),
  filters: Array.isArray(chapter.filters) ? cloneValue(chapter.filters.slice(0, 100)) : [],
  metrics: Array.isArray(chapter.metrics) ? chapter.metrics.slice(0, MAX_METRICS).map(sanitizeMetric).filter((metric) => metric.label || metric.value) : [],
  style: sanitizeStoryStyle(chapter.style),
  createdAt: cleanText(chapter.createdAt, 40) || new Date().toISOString(),
});

export function sanitizeStoryState(input = {}) {
  const used = new Set();
  const chapters = (Array.isArray(input.chapters) ? input.chapters : []).slice(0, MAX_CHAPTERS).map((chapter, index) => {
    const sanitized = sanitizeChapter(chapter, index);
    if (used.has(sanitized.id)) sanitized.id = `chapter-${index + 1}`;
    while (used.has(sanitized.id)) sanitized.id = `${sanitized.id}-${index + 1}`;
    used.add(sanitized.id);
    return sanitized;
  });
  const requestedActiveId = safeId(input.activeChapterId, '');
  return {
    title: cleanText(input.title, 160) || 'Untitled story',
    chapters,
    activeChapterId: chapters.some((chapter) => chapter.id === requestedActiveId) ? requestedActiveId : chapters[0]?.id ?? null,
  };
}

export function createStoryState(overrides = {}) {
  return sanitizeStoryState({ title: 'Untitled story', chapters: [], activeChapterId: null, ...overrides });
}

export function createChapterSnapshot(input = {}) {
  return sanitizeChapter(input, 0);
}

export function captureStoryChapter(story, chapter) {
  const current = sanitizeStoryState(story);
  if (current.chapters.length >= MAX_CHAPTERS) throw new Error('A story can contain up to eight chapters.');
  const base = sanitizeChapter(chapter, current.chapters.length);
  let id = base.id;
  let suffix = 2;
  while (current.chapters.some((item) => item.id === id)) id = `${base.id}-${suffix++}`;
  const next = { ...base, id };
  return { ...current, chapters: [...current.chapters, next], activeChapterId: id };
}

export function updateStoryChapter(story, chapterId, patch = {}) {
  const current = sanitizeStoryState(story);
  if (!current.chapters.some((chapter) => chapter.id === chapterId)) throw new Error('Story chapter not found.');
  return {
    ...current,
    chapters: current.chapters.map((chapter, index) => chapter.id === chapterId
      ? { ...sanitizeChapter({ ...chapter, ...patch, id: chapter.id }, index), id: chapter.id }
      : chapter),
  };
}

export function selectStoryChapter(story, chapterId) {
  const current = sanitizeStoryState(story);
  if (!current.chapters.some((chapter) => chapter.id === chapterId)) throw new Error('Story chapter not found.');
  return { ...current, activeChapterId: chapterId };
}

export function removeStoryChapter(story, chapterId) {
  const current = sanitizeStoryState(story);
  const index = current.chapters.findIndex((chapter) => chapter.id === chapterId);
  if (index < 0) throw new Error('Story chapter not found.');
  const chapters = current.chapters.filter((chapter) => chapter.id !== chapterId);
  const activeChapterId = current.activeChapterId === chapterId
    ? chapters[Math.min(index, chapters.length - 1)]?.id ?? null
    : current.activeChapterId;
  return { ...current, chapters, activeChapterId };
}

export function moveStoryChapter(story, chapterId, direction) {
  const current = sanitizeStoryState(story);
  const index = current.chapters.findIndex((chapter) => chapter.id === chapterId);
  if (index < 0) throw new Error('Story chapter not found.');
  const target = Math.max(0, Math.min(current.chapters.length - 1, index + Math.sign(Number(direction) || 0)));
  if (target === index) return current;
  const chapters = [...current.chapters];
  const [chapter] = chapters.splice(index, 1);
  chapters.splice(target, 0, chapter);
  return { ...current, chapters };
}

export { MAX_CHAPTERS, MAX_METRICS };
