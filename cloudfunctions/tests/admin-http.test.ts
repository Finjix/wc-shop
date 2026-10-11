// @ts-nocheck
const assert = require('assert');
const { handleAdminHttp } = require('../wc-shop-function/index');
const { adminEndpoint } = require('../shared/admin');
const { runEndpoint } = require('../shared/response');
const { makeRuntime } = require('./regressions.test');
async function run() {
  const runtime = makeRuntime();
  runtime.auth = { getUserInfo() { throw new Error('HTTP admin must not authenticate'); } };
  const invoke = (input) => runEndpoint(() => adminEndpoint(input, {}, runtime, input.action, input.data), input, {});
  const post = (input) => handleAdminHttp({ httpMethod: 'POST', body: JSON.stringify(input) }, invoke);
  const read = await post({ scope: 'admin', action: 'products.list', data: {} });
  assert.strictEqual(read.statusCode, 200);
  assert.strictEqual(JSON.parse(read.body).ok, true);
  assert(JSON.parse(read.body).data.items.length > 0);
  const save = { scope: 'admin', action: 'settings.upsert', data: { key: 'http-public', value: 'saved' } };
  const written = await handleAdminHttp({ httpMethod: 'POST', isBase64Encoded: true,
    body: Buffer.from(JSON.stringify(save)).toString('base64') }, invoke);
  assert.strictEqual(JSON.parse(written.body).data.value, 'saved');
  runtime.app = { getUploadMetadata: async ({ cloudPath }) => ({ data: {
    fileId: `cloud://test.bucket/${cloudPath}`, cosFileId: 'scoped-file',
    url: 'https://upload.test', token: 'scoped-token', authorization: 'scoped-signature',
  } }) };
  const upload = JSON.parse((await post({ scope: 'admin', action: 'storage.prepareUpload', data: { folder: 'admin/products' } })).body).data;
  assert.match(upload.cloudPath, /^admin\/products\/.+\.webp$/);
  assert.strictEqual(upload.upload.fields.key, upload.cloudPath);
  assert.strictEqual(upload.upload.fields.Signature, 'scoped-signature');
  const lease = Object.values(runtime.records.settings).find((row) => row.fileID === upload.fileID);
  assert.strictEqual(lease.imageCleanupPending, true);
  assert.strictEqual(lease.cleanupOwner, undefined, 'public admin uploads have no synthetic user identity');
  assert.strictEqual(JSON.parse((await post({ scope: 'admin', action: 'storage.prepareUpload', data: { folder: 'user/comments' } })).body).error.code, 'FORBIDDEN');
  for (const input of [{ scope: 'shop', action: 'orders.list', data: {} }, [], null, {}, { scope: 'admin', action: 'auth.me', data: {} }]) {
    assert.strictEqual(JSON.parse((await post(input)).body).error.code, 'INVALID_ARGUMENT');
  }
  const broken = await handleAdminHttp({ httpMethod: 'POST', body: '{' }, invoke);
  assert.strictEqual(JSON.parse(broken.body).error.code, 'INVALID_ARGUMENT');
  const options = await handleAdminHttp({ httpMethod: 'OPTIONS' }, () => { throw new Error('preflight must not invoke business API'); });
  assert.strictEqual(options.statusCode, 204);
  assert.strictEqual(options.headers['access-control-allow-headers'], 'content-type');
  assert.strictEqual((await handleAdminHttp({ httpMethod: 'GET' }, invoke)).statusCode, 405);
  console.log('PASS public HTTP admin read/write, base64, preflight, malformed requests and shop-scope isolation');
}
module.exports = { run };
