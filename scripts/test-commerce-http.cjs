'use strict';

// Exercise the real local HTTP adapter against disposable data, never live orders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-shop-commerce-'));
  const collections = Object.fromEntries(['categories', 'products', 'skus', 'addresses', 'carts', 'orders', 'comments', 'afterSales', 'homeContents', 'searchHistories', 'settings', 'adminMembers'].map(name => [name, {}]));
  collections.adminMembers['local-admin'] = { _id: 'local-admin', uid: 'local-admin', roles: ['superadmin'], status: 'active', enabled: true };
  collections.products.p1 = { _id: 'p1', spuId: 'p1', status: 'active', title: '隔离验收商品' };
  collections.skus.s1 = { _id: 's1', skuId: 's1', productId: 'p1', stockQuantity: 10, soldQuantity: 0, salePrice: 100 };
  collections.products.p2 = { _id: 'p2', spuId: 'p2', status: 'active', title: '隔离验收第二个商品' };
  collections.skus.s2 = { _id: 's2', skuId: 's2', productId: 'p2', stockQuantity: 10, soldQuantity: 0, salePrice: 250 };
  const address = { receiver: '测试用户', phone: '13800000000', province: '广东省', city: '深圳市', district: '南山区', detail: '隔离测试地址' };
  collections.addresses.a1 = { ...address, _id: 'a1', userId: 'commerce-test' };
  collections.addresses.a2 = { ...address, _id: 'a2', userId: 'commerce-test', detail: '隔离测试地址二' };
  fs.writeFileSync(path.join(folder, '.local-backend.json'), JSON.stringify({ version: 1, collections }));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const server = spawn(process.execPath, [path.join(__dirname, 'local-backend.js')], {
    env: { ...process.env, LOCAL_BACKEND_PORT: String(port), LOCAL_BACKEND_DATA_DIR: folder }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', data => { logs += data; });
  server.stderr.on('data', data => { logs += data; });
  const url = `http://127.0.0.1:${port}`;
  async function api(scope, action, data = {}, expectedCode, uid) {
    const response = await fetch(`${url}/api`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-uid': uid || (scope === 'admin' ? 'local-admin' : 'commerce-test') }, body: JSON.stringify({ scope, action, data }) });
    const result = await response.json();
    if (expectedCode) { assert.equal(result.ok, false, action); assert.equal(result.error.code, expectedCode, action); return result; }
    assert.equal(result.ok, true, `${action}: ${JSON.stringify(result.error)}`);
    return result.data;
  }
  const shop = (action, data, code, uid) => api('shop', action, data, code, uid);
  const admin = (action, data, code) => api('admin', action, data, code);
  try {
    let ready = false;
    for (let retry = 0; retry < 100; retry++) {
      try { ready = (await fetch(`${url}/health`)).ok; } catch {}
      if (ready) break;
      if (server.exitCode !== null) throw new Error(logs);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, logs);
    const input = { requestKey: 'http-partial', addressId: 'a1', items: [{ skuId: 's1', quantity: 3 }], useCart: false };
    const order = await shop('orders.create', input);
    assert.equal(order.status, 'paid'); assert.equal(order.payment.mode, 'simulated'); assert.equal(order.totalAmount, 300);
    assert.equal((await shop('orders.create', input))._id, order._id);
    await shop('orders.detail', { orderId: order._id }, 'FORBIDDEN', 'another-user');
    await shop('orders.updateAddress', { orderId: order._id, addressId: 'a2' });
    const claim = await shop('afterSales.create', { orderId: order._id, type: 20, reason: '测试退款', rightsItem: [{ skuId: 's1', rightsQuantity: 1 }] });
    await admin('orders.ship', { orderId: order._id, company: '手工记录', trackingNo: 'TEST-SHIP-1' }, 'CONFLICT');
    await admin('afterSales.review', { id: claim._id, status: 'approved' });
    await admin('afterSales.review', { id: claim._id, status: 'approved' });
    let detail = await shop('orders.detail', { orderId: order._id });
    assert.equal(detail.paymentStatus, 'partially_refunded'); assert.equal(detail.refundAmount, 100);
    const shipped = await admin('orders.ship', { orderId: order._id, company: '手工记录', trackingNo: 'TEST-SHIP-1' });
    assert.equal(shipped.shippedQuantities.s1, 2);
    assert.equal((await shop('orders.detail', { orderId: order._id })).items[0].fulfillableQuantity, 2, 'pre-shipment refund is not subtracted twice');
    await shop('orders.confirmReceived', { orderId: order._id });
    await shop('comments.create', { orderId: order._id, productId: 'p1', rating: 5, content: '隔离验收评价' });
    await shop('comments.create', { orderId: order._id, productId: 'p1', rating: 5 }, 'CONFLICT');
    await shop('afterSales.create', { orderId: order._id, type: 10, reason: '测试退货', rightsItem: [{ skuId: 's1', rightsQuantity: 2 }] }, 'RETURN_ADDRESS_REQUIRED');
    await admin('settings.upsert', { key: 'global', value: { returnAddress: address } });
    const returned = await shop('afterSales.create', { orderId: order._id, type: 10, reason: '测试退货', rightsItem: [{ skuId: 's1', rightsQuantity: 2 }] });
    const approved = await admin('afterSales.review', { id: returned._id, status: 'approved' });
    assert.equal(approved.status, 'approved'); assert.equal(approved.returnAddressSnapshot.receiver, address.receiver);
    await shop('afterSales.submitTracking', { afterSaleId: returned._id, trackingNo: 'TEST-RETURN-1', logisticsCompanyName: '手工记录' });
    await admin('afterSales.confirmReturn', { afterSaleId: returned._id });
    await admin('afterSales.confirmReturn', { afterSaleId: returned._id });
    detail = await shop('orders.detail', { orderId: order._id });
    assert.equal(detail.paymentStatus, 'refunded'); assert.equal(detail.refundAmount, 300);
    const saved = JSON.parse(fs.readFileSync(path.join(folder, '.local-backend.json'), 'utf8'));
    assert.equal(saved.collections.skus.s1.stockQuantity, 10, 'refund stock restored exactly once');
    assert.equal(saved.collections.skus.s1.soldQuantity, 0);
    await shop('cart.add', { skuId: 's1', quantity: 1 });
    const cartInput = { requestKey: 'http-cart-repeat', addressId: 'a1', items: [{ skuId: 's1', quantity: 1 }], useCart: true };
    const cartOrder = await shop('orders.create', cartInput);
    assert.equal((await shop('orders.create', cartInput))._id, cartOrder._id, 'retry after cart cleanup returns the original order');
    await shop('cart.add', { skuId: 's1', quantity: 2 });
    await shop('cart.add', { skuId: 's2', quantity: 2 });
    const batchInput = { requestKey: 'http-cart-split', addressId: 'a1', useCart: true };
    const batch = await shop('orders.create', batchInput);
    assert.equal(batch.orderCount, 2);
    assert.equal(batch.checkoutTotalAmount, 700);
    assert(batch.orders.every(order => order.items.length === 1));
    assert.deepEqual((await shop('orders.create', batchInput)).orderIds, batch.orderIds);
    assert.equal((await shop('orders.checkout', { checkoutId: batch.checkoutId })).checkoutTotalAmount, 700);
    await shop('orders.checkout', { checkoutId: batch.checkoutId }, 'FORBIDDEN', 'another-user');
    const group = (await admin('orders.list', { groupBy: 'address', status: 'paid', pageSize: 1 })).items[0];
    assert.equal(group.orderCount, 3, 'same address combines independent checkouts too');
    const shipmentInput = { orderIds: batch.orderIds, groupKey: group.key, trackingNo: 'TEST-COMBINED-1' };
    const shipment = await admin('orders.shipBatch', shipmentInput);
    assert.equal(shipment.total, 2);
    assert(shipment.items.every(order => order.logistics.trackingNo === shipmentInput.trackingNo));
    assert.equal((await shop('orders.detail', { orderId: cartOrder._id })).status, 'paid', 'unselected orders in the group are not shipped');
    assert.equal((await admin('orders.shipBatch', shipmentInput)).shipmentBatchId, shipment.shipmentBatchId);
    await shop('orders.confirmReceived', { orderId: batch.orderIds[0] });
    assert.equal((await shop('orders.detail', { orderId: batch.orderIds[1] })).status, 'shipped');
    console.log('HTTP commerce acceptance passed: simulated payment, idempotency, owner checks, address change, partial refund, shipment, receipt, comment, return, repeat-safe stock restoration, per-SKU checkout and grouped batch shipping.');
  } finally {
    server.kill();
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    assert(path.resolve(folder).startsWith(tempRoot) && path.basename(folder).startsWith('wc-shop-commerce-'), 'cleanup stays inside the disposable test directory');
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
