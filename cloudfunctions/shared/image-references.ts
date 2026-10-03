// @ts-nocheck
const crypto = require('crypto');
const { getDoc, withTransaction } = require('./db');
const { errorFrom } = require('./errors');

const SOURCES = ['homeContents', 'products', 'skus', 'categories', 'comments', 'afterSales', 'orders', 'carts'];
const COLLECTION_LABELS = { homeContents: '首页', products: '商品', skus: 'SKU', categories: '分类', comments: '评价', afterSales: '售后', orders: '订单快照', carts: '购物车' };
const SINGLE_FIELDS = new Set(['image', 'primaryImage', 'skuImage', 'icon', 'fileID', 'fileId', 'thumb', 'thumbUrl', 'goodsPictureUrl']);
const ARRAY_FIELDS = new Set(['images', 'detailImages']);
const CONTAINERS = new Set(['items', 'productSnapshot', 'skuSnapshot', 'product', 'sku', 'payload', 'banners', 'promos', 'commentResources', 'resources']);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function pathOf(fileID) { return String(fileID).replace(/^(?:cloud:\/\/[^/]+\/|local:\/\/)/, ''); }
function isStoredImage(value) {
  return typeof value === 'string' && /^(cloud:\/\/[^/]+\/|local:\/\/)/.test(value)
    && !/^(pending\/|user\/avatars\/|avatars\/)/.test(pathOf(value));
}

// Only image fields and known image-bearing containers are visited; text stays untouched.
function mapImages(value, mapper, source = '', type = value?.type) {
  const mapFile = (file) => isStoredImage(file) ? mapper(file) : file;
  function visit(value, key = '', inResource = false, inProduct = source === 'products') {
    if (typeof value === 'string') return SINGLE_FIELDS.has(key) || ARRAY_FIELDS.has(key) ? mapFile(value) : value;
    if (Array.isArray(value)) return value.map((item) => visit(item, key, key === 'commentResources' || key === 'resources', inProduct));
    if (!value || typeof value !== 'object') return value;
    if (inResource && value.type && value.type !== 'image') return value;
    const result = { ...value };
    Object.entries(value).forEach(([field, item]) => {
      const leaf = field.split('.').pop();
      // Legacy detail arrays belong to products, including order/cart snapshots.
      if (inProduct && leaf === 'desc' && Array.isArray(item)) result[field] = item.map(mapFile);
      else if (!key && source === 'homeContents' && (value.type ?? type) === 'banner' && leaf === 'content') result[field] = mapFile(item);
      else if (SINGLE_FIELDS.has(leaf) || ARRAY_FIELDS.has(leaf) || CONTAINERS.has(leaf)) {
        result[field] = visit(item, leaf, false, leaf === 'product' || leaf === 'productSnapshot');
      }
    });
    return result;
  }
  return visit(value);
}
function collectImages(document, source = '', type = document?.type) {
  const files = new Set();
  mapImages(document, (file) => { files.add(file); return file; }, source, type);
  return [...files];
}
function groupOf(fileID, source) {
  const sourceGroups = { homeContents: 'home', products: 'products', skus: 'products', categories: 'categories', comments: 'comments', afterSales: 'afterSales' };
  if (sourceGroups[source]) return sourceGroups[source];
  const path = pathOf(fileID);
  if (/^home\//.test(path) || source === 'homeContents') return 'home';
  if (/^(admin\/categories|categories)\//.test(path) || source === 'categories') return 'categories';
  if (/^(user\/comments|comments)\//.test(path) || source === 'comments') return 'comments';
  if (/^(user\/after-sales|after-sales)\//.test(path) || source === 'afterSales') return 'afterSales';
  if (/^(admin\/products|products)\//.test(path) || ['products', 'skus'].includes(source)) return 'products';
  return 'other';
}
async function resolveAlias(db, fileID) {
  if (!db) return fileID;
  const seen = new Set();
  let current = fileID;
  for (let i = 0; i < 100; i++) {
    if (seen.has(current)) throw errorFrom('CONFLICT');
    seen.add(current);
    const alias = await getDoc(db.collection('resourceAliases'), hash(current), false);
    if (!alias) return current;
    current = alias.newFileID;
  }
  throw errorFrom('CONFLICT');
}
async function normalizeImages(db, value, source, type) {
  const mapping = new Map();
  const files = collectImages(value, source, type);
  for (let offset = 0; offset < files.length; offset += 20) {
    await Promise.all(files.slice(offset, offset + 20).map(async (file) => mapping.set(file, await resolveAlias(db, file))));
  }
  return mapImages(value, (file) => mapping.get(file) || file, source, type);
}

/** Normalize stale IDs at the actual transactional write, including snapshot copies. */
function imageAwareRuntime(runtime) {
  if (runtime.imageAware) return runtime;
  const original = runtime.db;
  function wrapDb(db, transactional = false) {
    return new Proxy(db, { get(target, property) {
      if (property === 'runTransaction') return (worker) => target.runTransaction((tx) => worker(wrapDb(tx, true)));
      if (property === 'startTransaction') return async () => wrapDb(await target.startTransaction(), true);
      if (property !== 'collection') return typeof target[property] === 'function' ? target[property].bind(target) : target[property];
      return (name) => {
        const collection = target.collection(name);
        if (!SOURCES.includes(name)) return collection;
        return new Proxy(collection, { get(ref, field) {
          if (field === 'add') return async (value) => {
            if (!collectImages(value, name).length) return ref.add(value);
            const id = `${name}-${Date.now()}-${crypto.randomUUID()}`;
            await write(id, 'set', value);
            return { id };
          };
          if (field !== 'doc') return typeof ref[field] === 'function' ? ref[field].bind(ref) : ref[field];
          return (id) => new Proxy(ref.doc(id), { get(doc, method) {
            if (method === 'set' || method === 'update') return (value) => write(id, method, value);
            return typeof doc[method] === 'function' ? doc[method].bind(doc) : doc[method];
          } });
        } });
        async function write(id, method, value) {
          const needsHomeType = method === 'update' && name === 'homeContents' && value.type === undefined && isStoredImage(value.content);
          if (!needsHomeType && !collectImages(value, name).length) return target.collection(name).doc(id)[method](value);
          const apply = async (tx) => {
            // Alias activation updates this fence, forcing concurrent image writes to retry.
            await getDoc(tx.collection('resourceControl'), 'current', false);
            // Partial banner updates omit type; read it in the same write transaction.
            const type = needsHomeType ? (await getDoc(tx.collection(name), id, false))?.type : value.type;
            const normalized = await normalizeImages(tx, value, name, type);
            return tx.collection(name).doc(id)[method](normalized);
          };
          return transactional ? apply(target) : withTransaction(original, apply);
        }
      };
    } });
  }
  return { ...runtime, db: wrapDb(original), rawDb: original, imageAware: true };
}
module.exports = { SOURCES, COLLECTION_LABELS, hash, pathOf, isStoredImage, mapImages, collectImages, groupOf, resolveAlias, imageAwareRuntime };
