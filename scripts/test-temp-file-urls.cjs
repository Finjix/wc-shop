const { readSource: readMiniProgramSource } = require('./miniprogram-test-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, globals = {}) {
  const exports = {};
  const source = readMiniProgramSource(path.join(root, file), 'utf8').replaceAll('import.meta.env', "({VITE_ADMIN_API_URL:'https://api.test/admin'})");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, console, ...globals });
  return exports;
}
const urls = load('miniprogram/services/utils/temp-file-urls.ts');
const readRetry = load('miniprogram/services/utils/cloud-read-retry.ts');
async function run() {
  for (const client of ['shop', 'admin']) {
    const batches = [];
    const app = { getTempFileURL() {}, async callFunction({ data }) {
      assert.equal(data.scope, client);
      assert.equal(data.action, 'storage.tempUrls');
      batches.push([...data.data.fileList]);
      return { result: { ok: true, data: data.data.fileList.map((fileID) => ({ fileID, tempFileURL: `https://images.test/${fileID.split('/').pop()}` })) } };
    } };
    const api = client === 'shop' ? load('miniprogram/services/utils/cloud.ts', {
      require: (ref) => ref === './temp-file-urls' ? urls : ref === './cloud-read-retry' ? readRetry : { cloudEnvId: 'test', cloudFunctionName: 'wc-shop-function' },
      wx: { cloud: app }, console: { ...console, error() {} },
    }) : load('admin/src/lib/api.ts', { fetch: async (_url, options) => {
      assert.equal(options.credentials, 'omit');
      const response = await app.callFunction({ data: JSON.parse(options.body) });
      return { status: 200, json: async () => response.result };
    }, console: { ...console, error() {} }, require(ref) {
      ref = ref.replace(/^.*\/tdesign\//, "tdesign-miniprogram/");
      if (ref.includes('temp-file-urls')) return urls;
      if (ref.includes('cloud-read-retry')) return readRetry;
      return {};
    } });
    const ids = Array.from({ length: 54 }, (_, i) => `cloud://test/home/${i}.webp`);
    const first = api.getTempFileUrl(ids[0]);
    const resolved = await Promise.all([first, ...ids.map((id) => api.getTempFileUrl(id))]);
    assert.equal(resolved.length, 55);
    assert.deepEqual(batches.map((batch) => batch.length), [50, 4], `${client} batches duplicate image reads within SDK limits`);
    assert.equal(await api.getTempFileUrl(ids[0]), resolved[0]);
    assert.equal(batches.length, 2, 'successful URLs are cached');
    const invoke = client === 'shop' ? api.request : api.callAdmin;
    let attempts = 0, failures = 1, failureCode = 'FUNCTIONS_TIME_LIMIT_EXCEEDED';
    app.callFunction = async () => {
      attempts++;
      if (attempts <= failures) throw { code: failureCode, message: 'provider timeout' };
      return { result: { ok: true, data: [] } };
    };
    await invoke('products.list');
    assert.equal(attempts, 2, `${client} retries a timed-out read once`);
    failures = 2;
    attempts = 0;
    await assert.rejects(invoke('orders.list'), /TIME_LIMIT/);
    assert.equal(attempts, 2, 'a repeated timeout is surfaced');
    failures = 1;
    for (const action of ['products.save', 'orders.create', 'orders.delete', 'afterSales.withdraw', 'storage.prepareUpload', 'storage.cleanup']) {
      attempts = 0;
      await assert.rejects(invoke(action), /TIME_LIMIT/);
      assert.equal(attempts, 1, `${client} never automatically replays ${action}`);
    }
    attempts = 0;
    failureCode = 'FORBIDDEN';
    await assert.rejects(invoke('products.list'), /FORBIDDEN/);
    assert.equal(attempts, 1, 'authorization failures are never retried');
  }
  let clock = 0, calls = 0, fail = true;
  const resolver = new urls.TempFileUrls(async (ids) => {
    calls++;
    if (fail) throw new Error('temporary failure');
    return ids.map((fileID) => ({ fileID, tempFileURL: 'https://images.test/ok' }));
  }, () => clock);
  await assert.rejects(resolver.get('first'), /temporary failure/);
  fail = false;
  await resolver.get('first');
  await resolver.get('first');
  assert.equal(calls, 2, 'failures are retried rather than cached');
  clock = 300001;
  await resolver.get('first');
  assert.equal(calls, 3, 'expired signed URLs are refreshed');
  const malformed = new urls.TempFileUrls(async () => undefined);
  await assert.rejects(malformed.get('first'), /响应无效/);
  const invalidEntries = new urls.TempFileUrls(async () => [null]);
  await assert.rejects(invalidEntries.get('first'), /获取失败/);
  console.log('PASS actual shop/admin URL batching, cache expiry, malformed responses and one timeout retry for reads only');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
