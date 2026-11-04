import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceImport,
  completeImport,
  createImportState,
  failImport,
  startImport,
} from '../src/import/import-status.js';

test('import status disables file selection and reports determinate progress', () => {
  const idle = createImportState();
  const reading = startImport(idle, 'pipeline.xlsx');
  const profiling = advanceImport(reading, 'Profiling columns', 72);

  assert.equal(idle.status, 'idle');
  assert.equal(reading.busy, true);
  assert.equal(reading.fileName, 'pipeline.xlsx');
  assert.equal(profiling.progress, 72);
  assert.equal(profiling.message, 'Profiling columns');
});

test('import status produces explicit ready and recoverable error states', () => {
  const reading = startImport(createImportState(), 'pipeline.csv');
  const ready = completeImport(reading, { rows: 1280, fields: 42 });
  const failed = failImport(reading, 'The workbook is encrypted.');

  assert.deepEqual(ready, {
    status: 'ready', busy: false, fileName: 'pipeline.csv', progress: 100,
    message: '1,280 rows · 42 fields ready', error: '',
  });
  assert.equal(failed.busy, false);
  assert.equal(failed.status, 'error');
  assert.match(failed.message, /try another file/i);
  assert.equal(failed.error, 'The workbook is encrypted.');
});

test('import progress is monotonic and safely bounded', () => {
  const started = startImport(createImportState(), 'pipeline.xlsm');
  const advanced = advanceImport(started, 'Reading workbook', 64);
  assert.equal(advanceImport(advanced, 'Still reading', 30).progress, 64);
  assert.equal(advanceImport(advanced, 'Finishing', 500).progress, 99);
});
