import test from 'node:test';
import assert from 'node:assert/strict';
import {exportProject,importProject} from '../src/state/project-io.js';
test('projects never reconcile unrelated columns merely because positional ids match', () => {
  const fields = [{id:'c0',label:'Revenue',type:'number',semanticType:'number'}];
  const p = exportProject({fields,charts:[{id:'a',chartType:'columns3d',mappings:{z:'c0'},settings:{}}]});
  const imported = importProject(p,[{id:'c0',label:'Temperature',type:'number',semanticType:'number'}]);
  assert.deepEqual(imported.diagnostics.missingFields,['Revenue']);
  assert.equal(imported.workspace.charts[0].mappings.z,undefined);
});
test('projects retain bounded import interpretation without storing rows', () => {
  const p = exportProject({fields:[],charts:[],source:{importOptions:{headerRow:2,numericLocale:'decimal-comma'}}});
  assert.equal(p.source.importOptions.headerRow,2);
  assert.equal(JSON.stringify(p).includes('rows'),false);
});
