const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const cloudRequire = createRequire(path.resolve(process.argv[2] || path.join(__dirname, '../cloudfunctions'), 'package.json'));
const { setDoc } = require('../cloudfunctions/.build/shared/db');

async function run() {
  const set = cloudRequire('lodash.set');
  const unset = cloudRequire('lodash.unset');
  const record = {};
  set.default(record, 'items[0].price', 100);
  assert.equal(record.items[0].price, 100);
  assert.equal(unset.default(record, 'items[0].price'), true);
  assert.equal(record.items[0].price, undefined);
  set(record, '__proto__.wcShopPollution', true);
  assert.equal({}.wcShopPollution, undefined);
  const sharp = cloudRequire('sharp');
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).webp().toBuffer();
  assert.equal((await sharp(image).metadata()).format, 'webp');
  let invocation;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      invocation = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      if (invocation.action === 'database.modifyDocument') {
        assert.equal(JSON.parse(invocation.data)._id, undefined);
        response.end(JSON.stringify({ data: { updated: 0, upsert_id: 'home.page-config' }, requestId: 'write-test' }));
        return;
      }
      response.end(JSON.stringify({ data: { response_data: '{"ok":true}' }, requestId: 'dependency-test' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const cloudbase = cloudRequire('@cloudbase/node-sdk');
    const app = cloudbase.init({ env: 'dependency-test', secretId: 'test-id', secretKey: 'test-key',
      serviceUrl: `http://127.0.0.1:${server.address().port}/admin`, timeout: 5000 });
    const db = app.database();
    assert.equal(typeof db.runTransaction, 'function');
    assert.equal(typeof db.collection('orders').where({ status: db.command.in(['paid', 'shipped']) }).get, 'function');
    await assert.rejects(() => db.collection('homeContents').doc('home.page-config').set({ _id: 'home.page-config', title: 'home' }),
      (error) => error.message.includes('不能更新_id'));
    const document = { _id: 'home.page-config', title: 'home' };
    const saved = await setDoc(db.collection('homeContents'), document._id, document);
    assert.equal(saved.upsertedId, document._id);
    assert.equal(document._id, 'home.page-config');
    const result = await app.callFunction({ name: 'compatibility-test', data: { quantity: 2 } });
    assert.deepEqual(result.result, { ok: true });
    assert.equal(invocation.action, 'functions.invokeFunction');
    assert.equal(JSON.parse(invocation.request_data).quantity, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('PASS installed CloudBase HTTP transport, database initialization, lodash adapters and Sharp image processing');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
