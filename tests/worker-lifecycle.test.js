import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbookWorkerClient } from '../src/worker/workbook-worker-client.js';

globalThis.__PRISM_WORKER_SOURCE__ = 'test transport';
class WorkerTransport {
  static latest;
  constructor() { WorkerTransport.latest = this; }
  postMessage(message) { this.message = message; }
  terminate() { this.terminated = true; }
}
test('worker requests time out and close a failed transport', async () => {
  const c = createWorkbookWorkerClient(WorkerTransport, {queryTimeout:10});
  await assert.rejects(c.count({}), /timed out/i);
  assert.equal(WorkerTransport.latest.terminated,true);
  await assert.rejects(c.count({}), /closed|reload/i);
});
test('serialization failure rejects immediately and does not leak a pending request', async () => {
  class Broken extends WorkerTransport { postMessage() { throw new Error('clone failed'); } }
  const c = createWorkbookWorkerClient(Broken);
  await assert.rejects(c.count({}), /clone failed/);
  c.dispose();
});
test('worker error rejects pending work and future requests', async () => {
  const c = createWorkbookWorkerClient(WorkerTransport);
  const p = c.count({});
  WorkerTransport.latest.onerror({message:'worker crash'});
  await assert.rejects(p,/worker crash/);
  await assert.rejects(c.count({}),/closed|reload/i);
});
test('out of order responses resolve only their matching requests and dispose cancels', async () => {
  const c = createWorkbookWorkerClient(WorkerTransport);
  const a = c.count({}), aId = WorkerTransport.latest.message.requestId;
  const b = c.count({}), bId = WorkerTransport.latest.message.requestId;
  WorkerTransport.latest.onmessage({data:{requestId:bId,ok:true,count:2}});
  WorkerTransport.latest.onmessage({data:{requestId:aId,ok:true,count:1}});
  assert.equal((await a).count,1); assert.equal((await b).count,2);
  const pending = c.count({}); c.dispose(); await assert.rejects(pending,/cancelled/i);
});
