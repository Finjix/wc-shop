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
      require: (ref) => ref === './local-image-files' ? load('miniprogram/services/utils/local-image-files.ts') : ref === './temp-file-urls' ? urls : ref === './cloud-read-retry' ? readRetry : { cloudEnvId: 'test', cloudFunctionName: 'wc-shop-function' },
      wx: { cloud: app }, console: { ...console, error() {} },
    }) : load('admin/src/lib/api.ts', { fetch: async (_url, options) => {
      assert.equal(options.credentials, 'omit');
      const response = await app.callFunction({ data: JSON.parse(options.body) });
      return { status: 200, json: async () => response.result };
    }, console: { ...console, error() {} }, require(ref) {

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
  const maintenanceCalls = [];
  let finishCleanup;
  const maintenanceApi = load('miniprogram/services/utils/cloud.ts', {
    require: (ref) => ref === './local-image-files' ? load('miniprogram/services/utils/local-image-files.ts') : ref === './temp-file-urls' ? urls : ref === './cloud-read-retry' ? readRetry : { cloudEnvId: 'test', cloudFunctionName: 'wc-shop-function' },
    wx: { cloud: { callFunction({ data }) {
      maintenanceCalls.push(data.action);
      if (data.action === 'storage.cleanupQueue') return new Promise(resolve => { finishCleanup = resolve; });
      return Promise.resolve({ result: { ok: true, data: data.action === 'user.me' ? { name: 'user' } : { imageCleanup: ['cloud://test/home/old.webp'] } } });
    } } },
  });
  await maintenanceApi.request('user.me');
  assert.deepEqual(maintenanceCalls, ['user.me'], 'opening the profile does not run database maintenance');
  const mutation = maintenanceApi.request('comments.delete');
  const result = await Promise.race([mutation, new Promise((_, reject) => setTimeout(() => reject(new Error('cleanup blocked mutation')), 500))]);
  assert.equal(result.imageCleanup.length, 1);
  assert.deepEqual(maintenanceCalls, ['user.me', 'comments.delete', 'storage.cleanupQueue']);
  finishCleanup({ result: { ok: true, data: {} } });
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
  let downloads = 0, finishDownload;
  const localFiles = load('miniprogram/services/utils/local-image-files.ts', { wx: { downloadFile(options) { downloads++; finishDownload = options; } } });
  const local = new localFiles.LocalImageFiles();
  const firstLocal = local.get('http://localhost/image');
  assert.equal(local.get('http://localhost/image'), firstLocal, 'simultaneous local downloads are coalesced');
  finishDownload.success({ statusCode: 200, tempFilePath: 'wxfile://cached.webp' });
  assert.equal(await firstLocal, 'wxfile://cached.webp');
  assert.equal(await local.get('http://localhost/image'), 'wxfile://cached.webp');
  assert.equal(downloads, 1);
  const missingLocal = local.get('http://localhost/missing');
  finishDownload.success({ statusCode: 404 });
  await assert.rejects(missingLocal, /下载失败/);
  const retriedLocal = local.get('http://localhost/missing');
  finishDownload.success({ statusCode: 200, tempFilePath: 'wxfile://retried.webp' });
  assert.equal(await retriedLocal, 'wxfile://retried.webp');
  const waitingDownloads = [];
  const boundedFiles = load('miniprogram/services/utils/local-image-files.ts', { wx: { downloadFile(options) { waitingDownloads.push(options); } } });
  const bounded = new boundedFiles.LocalImageFiles();
  const downloadsAll = Array.from({ length: 12 }, (_, index) => bounded.get(`http://localhost/${index}`));
  assert.equal(waitingDownloads.length, 4, 'at most four local image downloads start together');
  for (let index = 0; index < 12; index++) {
    waitingDownloads[index].success({ statusCode: 200, tempFilePath: `wxfile://${index}` });
    waitingDownloads[index].complete();
  }
  assert.equal((await Promise.all(downloadsAll)).length, 12);
  console.log('PASS local image file cache: coalescing, file paths, reuse, failed status and retry');
  console.log('PASS actual shop/admin URL batching, cache expiry, malformed responses and one timeout retry for reads only');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
