'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, globals) {
  const exports = {};
  const source = fs.readFileSync(path.join(root, file), 'utf8')
    .replaceAll('import.meta.env', "({ VITE_ADMIN_API_URL: 'https://api.test/admin' })");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, console, File, FormData, AbortController, setTimeout, clearTimeout, ...globals });
  return exports;
}
async function run() {
  const calls = [];
  let uploadFails = false;
  const queue = new Map();
  const api = load('admin/src/lib/api.ts', {
    localStorage: { getItem: (key) => queue.get(key), setItem: (key, value) => queue.set(key, value) },
    fetch: async (url, options) => {
      assert.equal(options.credentials, 'omit', 'no browser cookies or identity are transmitted');
      if (url === 'https://upload.test') {
        assert.equal(options.method, 'PUT');
        assert.ok(options.body instanceof File, 'send raw image bytes rather than a multipart body');
        assert.equal(options.headers.authorization, 'scoped-signature');
        return { ok: !uploadFails, status: uploadFails ? 500 : 204 };
      }
      assert.equal(url, 'https://api.test/admin');
      assert.deepEqual(Object.keys(options.headers), ['content-type']);
      const input = JSON.parse(options.body);
      assert.equal(input.scope, 'admin');
      calls.push(input);
      const data = input.action === 'storage.prepareUpload' ? {
        cloudPath: 'admin/products/leased.webp', fileID: 'cloud://test/admin/products/leased.webp',
        upload: { url: 'https://upload.test', method: 'PUT', headers: { authorization: 'scoped-signature' } },
      } : input.action === 'storage.cleanup' ? { deleted: input.data.fileList, retained: [] } : { done: true };
      return { status: 200, json: async () => ({ ok: true, data }) };
    },
    require(ref) {
      if (ref.endsWith('cloud-read-retry')) return load('miniprogram/services/utils/cloud-read-retry.ts');
      if (ref.endsWith('temp-file-urls')) return load('miniprogram/services/utils/temp-file-urls.ts');
      if (ref === './image-upload') return {};
      throw new Error(`Unexpected dependency: ${ref}`);
    },
  });
  await api.callAdmin('products.list');
  await api.callAdmin('settings.upsert', { key: 'global', value: {} });
  await api.callAdmin('dashboard.summary');
  assert(calls.every(({ traceId }) => /^admin-[a-z0-9]+-[a-z0-9]+$/.test(traceId)), 'each attempt carries a non-sensitive correlation ID');
  assert(!calls.some(({ action }) => action === 'storage.cleanupQueue'), 'read results are never blocked by a maintenance request');
  const start = calls.length;
  await Promise.all([api.callAdmin('products.list', { page: 2 }), api.callAdmin('products.list', { page: 2 })]);
  assert.equal(calls.length - start, 1, 'simultaneous identical reads share one network request');
  await api.callAdmin('products.list', { page: 2 });
  assert.equal(calls.length - start, 2, 'completed reads are not cached across inventory changes');
  assert.equal(api.adminApi.localLogin, undefined);
  const file = new File(['image'], 'prepared.webp', { type: 'image/webp' });
  assert.equal(await api.uploadPreparedCloudFile(file), 'cloud://test/admin/products/leased.webp');
  uploadFails = true;
  await assert.rejects(api.uploadPreparedCloudFile(file), /HTTP 500/);
  assert.equal(calls.at(-1).action, 'storage.cleanup', 'failed upload retains the previous cleanup contract');
  assert.deepEqual(calls.at(-1).data.fileList, ['cloud://test/admin/products/leased.webp']);
  await testRequestTimeouts();
  console.log('PASS admin transport, nonblocking reads, request coalescing, fresh rereads and failed upload cleanup');
}

async function testRequestTimeouts() {
  const timers = new Map();
  const requests = [];
  let mode = 'hang';
  const api = load('admin/src/lib/api.ts', {
    setTimeout(callback, delay) { const token = {}; timers.set(token, { callback, delay }); return token; },
    clearTimeout(token) { timers.delete(token); },
    fetch: async (_url, options) => {
      requests.push(options);
      if (mode === 'hang') return new Promise(() => {});
      return { status: 200, json: () => mode === 'body' ? new Promise(() => {}) : Promise.resolve({ ok: true, data: { done: true } }) };
    },
    require(ref) {
      if (ref.endsWith('cloud-read-retry')) return load('miniprogram/services/utils/cloud-read-retry.ts');
      if (ref.endsWith('temp-file-urls')) return load('miniprogram/services/utils/temp-file-urls.ts');
      if (ref === './image-upload') return {};
      throw new Error(`Unexpected dependency: ${ref}`);
    },
  });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  for (const stalled of ['hang', 'body']) {
    mode = stalled;
    const before = requests.length;
    const first = api.callAdmin('categories.list');
    const second = api.callAdmin('categories.list');
    const rejected = Promise.all([first, second].map(request => assert.rejects(request, error => error.code === 'REQUEST_TIMEOUT' && error.requestId === JSON.parse(requests.at(-1).body).traceId && /加载超时/.test(error.message))));
    await flush();
    for (const [attempt, delay] of [6_000, 6_000, 8_000].entries()) {
      assert.equal(requests.length - before, attempt + 1, 'shared reads use one bounded recovery sequence');
      const timer = [...timers.values()][0];
      assert.equal(timer.delay, delay);
      timer.callback();
      await flush();
      assert(requests[before + attempt].signal.aborted, 'a stalled attempt is cancelled before the next attempt');
    }
    await rejected;
    assert.equal(timers.size, 0);
    mode = 'success';
    assert.equal((await api.callAdmin('categories.list')).done, true, 'retry creates a fresh request after all attempts time out');
  }
  mode = 'hang';
  const recoveryStart = requests.length;
  const recovered = api.callAdmin('dashboard.summary');
  const stalledTimer = [...timers.values()][0];
  mode = 'success';
  stalledTimer.callback();
  assert.equal((await recovered).done, true, 'a blackholed read recovers on a fresh attempt');
  assert.equal(requests.length - recoveryStart, 2);
  assert(requests[recoveryStart].signal.aborted);
  assert.equal(timers.size, 0);
  mode = 'hang';
  const before = requests.length;
  const saving = api.callAdmin('homeContent.save', { payload: {} });
  const rejected = assert.rejects(saving, error => error.code === 'REQUEST_TIMEOUT' && /核实是否已保存/.test(error.message));
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 45_000);
  timer.callback();
  await rejected;
  assert.equal(requests.length - before, 1, 'timed-out mutations are never replayed');
  assert.equal(timers.size, 0);
  console.log('PASS bounded stalled fetch/body recovery, shared-read release, automatic read recovery and no mutation replay');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
