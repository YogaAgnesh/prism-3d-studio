import test from 'node:test';
import assert from 'node:assert/strict';
import { setSafeText } from '../src/security/safe-text.js';
import { validateImportFile, validateProjectBytes } from '../src/security/validate-import.js';
import { installNetworkGuard } from '../src/security/network-guard.js';

test('writes workbook labels as text rather than executable markup', () => {
  const element = { textContent: '', innerHTML: 'unchanged' };
  setSafeText(element, '<img src=x onerror=alert(1)>');
  assert.equal(element.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(element.innerHTML, 'unchanged');
});

test('rejects unsupported and oversized workbook or project input before parsing', () => {
  assert.equal(validateImportFile({ name: 'sales.pdf', size: 100 }).ok, false);
  assert.equal(validateImportFile({ name: 'sales.xlsx', size: 251 * 1024 * 1024 }).ok, false);
  assert.equal(validateImportFile({ name: 'sales.csv', size: 1024 }).ok, true);
  assert.equal(validateProjectBytes(new Uint8Array(11 * 1024 * 1024)).ok, false);
});

test('network guard blocks fetch, websocket, and XHR construction in release tests', async () => {
  const fakeGlobal = {
    fetch: async () => 'network',
    WebSocket: class {},
    XMLHttpRequest: class {},
    EventSource: class {},
    navigator: { sendBeacon: () => true },
  };
  const restore = installNetworkGuard(fakeGlobal);
  await assert.rejects(fakeGlobal.fetch('https://example.com'), /offline/i);
  assert.throws(() => new fakeGlobal.WebSocket(), /offline/i);
  assert.throws(() => new fakeGlobal.XMLHttpRequest(), /offline/i);
  assert.throws(() => new fakeGlobal.EventSource(), /offline/i);
  assert.throws(() => fakeGlobal.navigator.sendBeacon(), /offline/i);
  restore();
  assert.equal(await fakeGlobal.fetch(), 'network');
});
