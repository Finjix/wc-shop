// @ts-nocheck
const assert = require('assert');
const { scan, resourceList, beginReplacement, advanceReplacement, resourcesEndpoint } = require('../shared/image-resources');
const { imageAwareRuntime, collectImages, hash } = require('../shared/image-references');
const { adminEndpoint } = require('../shared/admin');

async function finishScan(runtime) {
  let job = await scan(runtime, {});
  for (let i = 0; job.status !== 'completed' && i < 200; i++) job = await scan(runtime, { scanID: job._id });
  assert.equal(job.status, 'completed');
  return resourceList(runtime, {});
}
async function run(makeRuntime) {
  const large = makeRuntime();
  large.records.orders.large = { _id: 'large', items: Array.from({ length: 90 }, (_, i) => ({ image: `local://products/${i}.png` })) };
  large.resourceFileInfo = async () => ({ size: 2, format: 'png', animated: false, version: 'v1', status: 'ok' });
  large.app = { getTempFileURL: async () => ({ fileList: [] }) };
  assert.deepEqual((await finishScan(large)).summary, { count: 90, bytes: 180, unknown: 0 }, 'A large snapshot spans multiple bounded scan steps');
  console.log('PASS large image-bearing snapshots resume within the per-request reference budget');
  const runtime = makeRuntime();
  const old = 'cloud://env/user/comments/Original.PNG';
  const files = { [old]: { size: 800, format: 'png', animated: false, status: 'ok', version: 'v1', url: 'https://test/old' } };
  let deleteAttempts = 0;
  runtime.resourceFileInfo = async (id) => files[id] || { size: null, status: 'error', missing: true, format: 'png', error: '不存在' };
  runtime.app = {
    getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map((fileID) => ({ fileID, tempFileURL: files[fileID]?.url || '' })) }),
    deleteFile: async ({ fileList }) => {
      assert.equal(collectImages(runtime.records.orders.snapshot).includes(old), false, 'Delete follows snapshot replacement');
      if (++deleteAttempts === 1) throw new Error('临时删除失败');
      fileList.forEach((id) => delete files[id]);
      return { fileList: fileList.map((fileID) => ({ fileID, code: 'SUCCESS' })) };
    },
  };
  runtime.records.homeContents = { home: { _id: 'home', payload: { banners: [{ image: old }], promos: [] } } };
  runtime.records.products['product-1'].primaryImage = old;
  runtime.records.products['product-1'].status = 'inactive';
  runtime.records.products['product-1'].description = `This text mentions ${old}`;
  runtime.records.comments = { comment: { _id: 'comment', images: [old], commentResources: [{ type: 'image', fileID: old }] } };
  runtime.records.afterSales = { case: { _id: 'case', images: [old] } };
  runtime.records.orders.snapshot = { _id: 'snapshot', items: [{ image: old, productSnapshot: { primaryImage: old, images: [old] }, skuSnapshot: { skuImage: old } }] };
  runtime.records.carts = { cart: { _id: 'cart', items: [{ image: old }] } };
  runtime.records.categories = { category: { _id: 'category', image: '/assets/user-avatar.jpg', icon: 'https://external/icon.png' } };
  // More than the SDK default and multiple pages, plus an invalid reference.
  for (let i = 0; i < 35; i++) {
    const id = `cloud://env/products/${String(i).padStart(3, '0')}.webp`;
    files[id] = { size: 100, format: 'webp', animated: i === 0, status: 'ok', version: `file-${i}`, url: 'https://test/file' };
    runtime.records.products[`extra-${String(i).padStart(3, '0')}`] = { _id: `extra-${String(i).padStart(3, '0')}`, primaryImage: id };
  }
  runtime.records.products.broken = { _id: 'broken', primaryImage: 'cloud://env/products/missing.png' };
  runtime.records.products.ignored = { _id: 'ignored', images: ['cloud://env/pending/home/a.png', 'cloud://env/user/avatars/a.png', '/assets/local.png'] };
  files['cloud://env/products/unreferenced.png'] = { size: 999, status: 'ok' };
  const inventory = await finishScan(runtime);
  assert.deepEqual(inventory.summary, { count: 37, bytes: 4300, unknown: 1 });
  assert.equal(inventory.total, 37);
  assert.equal((await resourceList(runtime, { group: 'comments' })).groupSummary.count, 1);
  assert.equal((await resourceList(runtime, { query: 'Original.PNG' })).total, 1);
  assert.equal((await resourceList(runtime, { page: 2 })).items.length, 17);
  console.log('PASS resource inventory deduplicates shared references, pages, groups, unknown sizes and excludes unused files');
  const normalRead = runtime.resourceFileInfo;
  let failingScan = await scan(runtime, {});
  while (failingScan.status !== 'metadata') failingScan = await scan(runtime, { scanID: failingScan._id });
  runtime.resourceFileInfo = async () => { throw new Error('临时盘点失败'); };
  await assert.rejects(() => scan(runtime, { scanID: failingScan._id }), /临时盘点失败/);
  assert.deepEqual((await resourceList(runtime, {})).summary, inventory.summary, 'Failed scan preserves last complete summary');
  runtime.resourceFileInfo = normalRead;
  assert.deepEqual((await finishScan(runtime)).summary, inventory.summary, 'Failed scan resumes without double counting');

  await assert.rejects(() => beginReplacement(runtime, { fileID: old, version: 'stale' }, 'admin'), { code: 'CONFLICT' });
  const [job, same] = await Promise.all([
    beginReplacement(runtime, { fileID: old, version: 'v1' }, 'admin'),
    beginReplacement(runtime, { fileID: old, version: 'v1' }, 'admin'),
  ]);
  assert.equal(job.cloudPath, same.cloudPath);
  await assert.rejects(() => advanceReplacement(runtime, { jobID: job._id, newFileID: 'cloud://env/other.webp' }), { code: 'FORBIDDEN' });
  assert.ok(files[old]);
  const replacement = `cloud://env/${job.cloudPath}`;
  files[replacement] = { size: 1200, format: 'webp', animated: false, status: 'ok', version: 'v2', url: 'https://test/new' };
  let current = await advanceReplacement(runtime, { jobID: job._id, newFileID: replacement });
  assert.equal(current.newSize, 1200, 'Larger output is allowed');
  const aware = imageAwareRuntime(runtime);
  await aware.db.collection('products').doc('new-after-alias').set({ primaryImage: old, title: '并发创建商品' });
  assert.equal(runtime.records.products['new-after-alias'].primaryImage, replacement);
  runtime.records.products['product-1'].title = '并发修改标题';
  let sawDeleteFailure = false;
  for (let i = 0; current.status !== 'completed' && i < 200; i++) {
    try { current = await advanceReplacement(runtime, { jobID: job._id }); }
    catch (error) { assert.match(error.message, /临时删除失败/); sawDeleteFailure = true; assert.ok(files[old]); }
  }
  assert.equal(current.status, 'completed');
  assert.ok(sawDeleteFailure);
  assert.equal(runtime.records.products['product-1'].title, '并发修改标题');
  assert.equal(runtime.records.products['product-1'].description, `This text mentions ${old}`);
  for (const source of ['homeContents', 'products', 'skus', 'comments', 'afterSales', 'orders', 'carts']) {
    for (const doc of Object.values(runtime.records[source] || {})) assert.equal(collectImages(doc).includes(old), false);
  }
  assert.equal(files[old], undefined);
  assert.equal(runtime.records.resourceAliases[hash(old)].newFileID, replacement);
  const urls = await require('../shared/storage').getTempFileURLs(runtime, [old]);
  assert.equal(urls[0].fileID, old);
  assert.equal(urls[0].tempFileURL, 'https://test/new', 'Old IDs resolve to replacement URLs');
  assert.equal((await advanceReplacement(runtime, { jobID: job._id })).status, 'completed');
  const refreshed = await finishScan(runtime);
  assert.equal(refreshed.summary.bytes, 4700);
  const cancelSource = 'cloud://env/products/001.webp';
  const cancellable = await beginReplacement(runtime, { fileID: cancelSource, version: 'file-1' }, 'admin');
  const cancelled = await resourcesEndpoint(runtime, 'storage.resources.cancelReplacement', { jobID: cancellable._id }, { identity: { uid: 'admin' } });
  assert.equal(cancelled.cancelled, true);
  assert.ok(files[cancelSource], 'Cancelling a preparation never deletes the original');
  assert.equal(runtime.records.resourceAliases[hash(cancelSource)], undefined);
  await assert.rejects(() => beginReplacement(runtime, { fileID: 'cloud://env/products/000.webp', version: 'file-0' }, 'admin'), { code: 'IMAGE_FORMAT' });
  console.log('PASS replacement persists, updates snapshots, normalizes stale writes, preserves concurrent edits and retries deletion');

  runtime.records.adminMembers = { viewer: { _id: 'viewer', roles: ['inventory'], status: 'active', enabled: true } };
  await adminEndpoint({}, { auth: { uid: 'viewer' } }, runtime, 'storage.resources.list', {});
  await assert.rejects(() => adminEndpoint({}, { auth: { uid: 'viewer' } }, runtime, 'storage.resources.beginReplacement', { fileID: replacement, version: 'v2' }), { code: 'FORBIDDEN' });
  console.log('PASS inventory administrators can view but cannot replace cloud resources');
}
module.exports = { run };
