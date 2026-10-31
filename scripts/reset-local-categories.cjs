'use strict';

// Deliberately local-only. Never reset data implicitly on server startup/deployment.
const fs = require('node:fs');
const path = require('node:path');
const { defaultLocalStorageDirectory } = require('./local-backend-storage.cjs');

async function main() {
  if (!process.argv.includes('--confirm')) throw new Error('确认仅清空本地分类及商品分类关联后，运行：node scripts/reset-local-categories.cjs --confirm');
  const root = path.resolve(__dirname, '..');
  const storage = path.resolve(process.env.LOCAL_BACKEND_DATA_DIR || defaultLocalStorageDirectory(root));
  const url = `http://127.0.0.1:${Number(process.env.LOCAL_BACKEND_PORT || 8787)}`;
  const health = await (await fetch(`${url}/health`)).json();
  if (health.data?.service !== 'wc-shop-local-backend') throw new Error('请先启动本地后端');
  async function api(action, data = {}) {
    const result = await (await fetch(`${url}/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'admin', action, data }) })).json();
    if (!result.ok) throw new Error(`${action}: ${JSON.stringify(result.error)}`);
    return result.data;
  }
  async function readAll(action, extra = {}) {
    const items = [];
    for (let page = 1; ; page += 1) {
      const batch = await api(action, { ...extra, page, pageSize: 100, orderBy: '_id', direction: 'asc' });
      items.push(...batch.items);
      if (batch.items.length < 100) return items;
    }
  }
  const categories = await readAll('categories.list');
  const products = await readAll('products.list');
  const snapshot = JSON.parse(fs.readFileSync(path.join(storage, '.local-backend.json'), 'utf8')).collections;
  for (const [name, rows] of [['categories', categories], ['products', products]]) {
    if (rows.some((row) => !snapshot?.[name]?.[row._id || row.id])) throw new Error('本地备份目录与后端数据不一致，拒绝清理；请核对 LOCAL_BACKEND_DATA_DIR');
  }
  const folder = path.join(storage, 'backups', `categories-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(folder, { recursive: true });
  // Preserve the complete local database and all images before the API releases references.
  fs.copyFileSync(path.join(storage, '.local-backend.json'), path.join(folder, '.local-backend.json'));
  fs.cpSync(path.join(storage, '.local-files'), path.join(folder, '.local-files'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'categories.json'), JSON.stringify({ categories, productCategories: products.map((item) => ({ id: item._id, categoryIds: item.categoryIds || [] })) }, null, 2));
  for (const category of categories) await api('categories.delete', { id: category._id || category.id });
  // Also clear stale references whose category documents no longer exist.
  for (const product of await readAll('products.list')) {
    if (product.categoryIds?.length) await api('products.update', { id: product._id, categoryIds: [] });
  }
  if ((await readAll('categories.list', { status: 'active' })).length) throw new Error('仍有未清理分类，请暂停分类编辑后重试');
  const after = await readAll('products.list');
  if (after.length !== products.length || after.some((item) => item.categoryIds?.length)) throw new Error('清理后校验失败，请检查备份和本地后端');
  console.log(`已清空本地旧分类及商品分类关联，保留 ${after.length} 个商品。备份：${folder}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
