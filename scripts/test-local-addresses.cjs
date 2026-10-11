'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const storage = new Map();
let failWrite = false;
function load() {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('services/address/fetchAddress.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports,
    require() { throw new Error('address books must not import a cloud transport'); },
    wx: {
      getStorageSync: key => structuredClone(storage.get(key) ?? ''),
      setStorageSync(key, value) { if (failWrite) throw new Error('storage full'); storage.set(key, structuredClone(value)); },
    },
  });
  return exports;
}
async function run() {
  let api = load();
  const draft = { name: '本地验收', phone: '13800000000', provinceName: '测试省', cityName: '测试市', districtName: '测试区', detailAddress: '测试地址' };
  assert.equal((await api.fetchDeliveryAddressList()).length, 0);
  const [first, second] = await Promise.all([api.persistAddress(draft), api.persistAddress({ ...draft, name: '第二个地址' })]);
  assert.notEqual(first.addressId, second.addressId);
  assert.equal(storage.size, 1);
  api = load(); // A fresh small-program runtime still reads durable device storage.
  assert.equal((await api.fetchDeliveryAddressList()).length, 2);
  assert.equal((await api.fetchDeliveryAddress()).addressId, first.addressId);
  await api.setDefaultDeliveryAddress(second.addressId);
  assert.equal((await load().fetchDeliveryAddress()).addressId, second.addressId);
  await api.persistAddress({ ...second, name: '编辑成功', detailAddress: '新详细地址', isDefault: 1 });
  assert.equal((await load().fetchDeliveryAddress(second.addressId)).name, '编辑成功');
  assert.equal((await load().fetchDeliveryAddress(second.addressId)).detailAddress, '新详细地址');
  await api.deleteDeliveryAddress(second.addressId);
  assert.equal((await load().fetchDeliveryAddress()).addressId, first.addressId);
  assert.equal((await load().fetchDeliveryAddress(second.addressId)), null);
  await assert.rejects(api.persistAddress({ ...second, name: '旧页面重新保存' }), /已删除/);
  failWrite = true;
  await assert.rejects(api.persistAddress({ ...draft, name: '存储失败' }), /storage full/);
  failWrite = false;
  assert.equal((await load().fetchDeliveryAddressList()).length, 1);
  await api.persistAddress({ ...draft, name: '失败后重试' });
  assert.equal((await load().fetchDeliveryAddressList()).length, 2);
  await api.persistAddressList([]);
  assert.equal((await load().fetchDeliveryAddressList()).length, 0);
  storage.set('wc-shop.addresses.v1', { version: 99, items: [] });
  await assert.rejects(load().persistAddress(draft), /数据异常/);
  assert.equal(storage.get('wc-shop.addresses.v1').version, 99, 'corrupt data is never overwritten silently');
  console.log('PASS local addresses persist across restarts, serialize writes, maintain one default, delete, fail safely and make zero cloud calls');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
