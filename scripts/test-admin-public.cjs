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
  } }).outputText, { exports, console, File, FormData, ...globals });
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
  assert(calls.some(({ action }) => action === 'storage.cleanupQueue'), 'startup retries durable image cleanup without a login event');
  assert.equal(api.adminApi.localLogin, undefined);
  const file = new File(['image'], 'prepared.webp', { type: 'image/webp' });
  assert.equal(await api.uploadPreparedCloudFile(file), 'cloud://test/admin/products/leased.webp');
  uploadFails = true;
  await assert.rejects(api.uploadPreparedCloudFile(file), /HTTP 500/);
  assert.equal(calls.at(-1).action, 'storage.cleanup', 'failed upload retains the previous cleanup contract');
  assert.deepEqual(calls.at(-1).data.fileList, ['cloud://test/admin/products/leased.webp']);
  console.log('PASS actual public admin HTTP transport, cookie omission, startup cleanup and failed upload cleanup');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
