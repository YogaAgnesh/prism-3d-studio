import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureStoryChapter,
  createChapterSnapshot,
  createStoryState,
  moveStoryChapter,
  removeStoryChapter,
  sanitizeStoryState,
  selectStoryChapter,
  updateStoryChapter,
} from '../src/story/story-state.js';
import { createStudioState } from '../src/state/studio-store.js';
import { exportProject, importProject } from '../src/state/project-io.js';

const camera = { eye: { x: 1.4, y: 1.2, z: 0.9 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };

test('captures an immutable reproducible chart chapter', () => {
  const sourceFilters = [{ id: 'filter-1', fieldId: 'stage', operator: 'equals', value: 'Closed Won' }];
  const chapter = createChapterSnapshot({
    title: 'Closed-won concentration', takeaway: 'Financial Services leads the view.', annotation: 'Focus on FY27.', action: 'Protect the top three renewals.',
    chartId: 'chart-2', chartType: 'scatter3d', camera, filters: sourceFilters,
    metrics: [{ label: 'Pipeline', value: '$84M' }, { label: 'Win rate', value: '62%' }],
  });
  const story = captureStoryChapter(createStoryState(), chapter);
  sourceFilters[0].value = 'Changed';
  camera.eye.x = 99;

  assert.equal(story.chapters.length, 1);
  assert.equal(story.activeChapterId, story.chapters[0].id);
  assert.equal(story.chapters[0].filters[0].value, 'Closed Won');
  assert.equal(story.chapters[0].camera.eye.x, 1.4);
  assert.deepEqual(story.chapters[0].metrics.map((metric) => metric.label), ['Pipeline', 'Win rate']);
});

test('sanitizes and preserves chapter presentation formatting', () => {
  const chapter = createChapterSnapshot({
    title: 'Executive view',
    style: {
      fontFamily: 'editorial', accentColor: '#7c3aed', textColor: '#101828',
      surfaceColor: '#ffffff', layout: 'metrics-first',
    },
  });
  assert.deepEqual(chapter.style, {
    fontFamily: 'editorial', accentColor: '#7C3AED', textColor: '#101828',
    surfaceColor: '#FFFFFF', layout: 'metrics-first',
  });
  const unsafe = createChapterSnapshot({ style: { fontFamily: 'url(bad)', accentColor: 'red', layout: 'broken' } });
  assert.deepEqual(unsafe.style, {
    fontFamily: 'system', accentColor: '#175CD3', textColor: '#101828',
    surfaceColor: '#FFFFFF', layout: 'narrative-left',
  });
});

test('bounds a story at eight chapters and each chapter at three metrics', () => {
  let story = createStoryState({ title: 'Board narrative' });
  for (let index = 1; index <= 8; index += 1) {
    story = captureStoryChapter(story, createChapterSnapshot({ title: `Chapter ${index}`, metrics: [
      { label: 'A', value: '1' }, { label: 'B', value: '2' }, { label: 'C', value: '3' }, { label: 'D', value: '4' },
    ] }));
  }
  assert.equal(story.chapters.length, 8);
  assert.equal(story.chapters[0].metrics.length, 3);
  assert.throws(() => captureStoryChapter(story, createChapterSnapshot({ title: 'Chapter 9' })), /eight chapters/i);
});

test('updates, reorders, selects, and removes chapters without mutating prior state', () => {
  let story = captureStoryChapter(createStoryState(), createChapterSnapshot({ id: 'one', title: 'One' }));
  story = captureStoryChapter(story, createChapterSnapshot({ id: 'two', title: 'Two' }));
  const before = story;
  story = updateStoryChapter(story, 'one', { title: 'Opening view' });
  story = moveStoryChapter(story, 'two', -1);
  story = selectStoryChapter(story, 'one');

  assert.deepEqual(before.chapters.map((item) => item.title), ['One', 'Two']);
  assert.deepEqual(story.chapters.map((item) => item.title), ['Two', 'Opening view']);
  assert.equal(story.activeChapterId, 'one');
  assert.equal(removeStoryChapter(story, 'one').activeChapterId, 'two');
});

test('sanitizes untrusted story content and rejects invalid selections', () => {
  const story = sanitizeStoryState({ title: '<Board>\u0000', chapters: [{ id: 'same', title: 'A' }, { id: 'same', title: 'B' }] });
  assert.equal(story.title, '<Board>');
  assert.deepEqual(story.chapters.map((chapter) => chapter.id), ['same', 'chapter-2']);
  assert.throws(() => selectStoryChapter(story, 'missing'), /not found/i);
});

test('light is the product default and story state round-trips without workbook rows', () => {
  const story = captureStoryChapter(createStoryState({ title: 'FY27 outlook' }), createChapterSnapshot({ id: 'opening', title: 'Opening', camera, filters: [] }));
  const source = { ...createStudioState(), story, fields: [], charts: [] };
  const project = exportProject(source);
  const imported = importProject(project, []);

  assert.equal(source.theme, 'light');
  assert.equal(project.workspace.story.chapters[0].title, 'Opening');
  assert.equal(imported.workspace.story.title, 'FY27 outlook');
  assert.equal(imported.workspace.story.chapters[0].camera.eye.y, 1.2);
  assert.equal(JSON.stringify(project).includes('rows'), false);
});

test('project import reconciles chapter chart and filter identifiers', () => {
  const project = {
    product: 'Prism', version: 2,
    dataSignature: { fields: [{ id: 'old-stage', label: 'Stage', semanticType: 'category', type: 'text' }] },
    workspace: {
      theme: 'light', mode: 'guided', filters: [], calculations: [],
      charts: [{ id: 'old-chart', chartType: 'scatter3d', title: 'Pipeline', mappings: { x: 'old-stage' } }],
      story: { title: 'Board view', activeChapterId: 'opening', chapters: [{
        id: 'opening', title: 'Opening', chartId: 'old-chart',
        filters: [{ id: 'old-filter', fieldId: 'old-stage', operator: 'equals', value: 'Closed Won' }],
      }] },
    },
  };
  const imported = importProject(project, [{ id: 'current-stage', label: 'Stage', semanticType: 'category', type: 'text' }]);
  assert.equal(imported.workspace.story.chapters[0].chartId, 'chart-1');
  assert.equal(imported.workspace.story.chapters[0].filters[0].fieldId, 'current-stage');
  assert.equal(imported.workspace.story.chapters[0].filters[0].id, 'story-filter-1-1');
});
