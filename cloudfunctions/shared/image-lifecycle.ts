// @ts-nocheck
const crypto = require('crypto');
const { COLLECTIONS } = require('./constants');
const { getDoc, setDoc, withTransaction, list } = require('./db');
const { errorFrom } = require('./errors');
const SOURCES = Object.values(COLLECTIONS);
const CONTROL = '__image_cleanup_control';
const IMAGE_NEUTRAL_FIELDS = new Set(['status', 'updatedAt', 'title', 'subtitle', 'name', 'sort', 'stockQuantity', 'soldQuantity', 'price', 'salePrice', 'linePrice', 'weight', 'volume', 'categoryId', 'categoryIds', 'parentId', 'level']);
const stateId = (id) => `__image_file_${crypto.createHash('sha256').update(id).digest('hex')}`;
const stored = (v) => typeof v === 'string' && /^(cloud|local):\/\//.test(v);
function canonical(value) {
  if (stored(value)) return value;
  try {
    const url = new URL(value);
    const bucket = url.hostname.match(/^([a-f0-9]+-(.+)-\d+)\.(?:tcb\.qcloud\.la|cos\.[a-z0-9-]+\.myqcloud\.com)$/);
    return bucket ? `cloud://${bucket[2]}.${bucket[1]}/${decodeURIComponent(url.pathname.slice(1))}` : null;
  } catch { return null; }
}
function walk(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, fn));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, walk(v,fn)]));
}
function files(value) {
  const ids = new Set(); walk(value, (v) => {
    const id = canonical(v); if (id) ids.add(id);
    for (const link of v.match(/(?:cloud|local|https?):\/\/[^\s"'<>\]\)]+/g) || []) {
      const embedded = canonical(link); if (embedded) ids.add(embedded);
    }
    return v;
  }); return [...ids];
}
function matches(value, id) {
  if (value === id) return true;
  if (!/^https?:\/\//.test(value) || !id.startsWith('cloud://')) return false;
  try {
    const [, authority, path] = /^cloud:\/\/([^/]+)\/(.+)$/.exec(id) || [];
    const bucket = authority?.split('.').slice(1).join('.');
    const url = new URL(value);
    return Boolean(bucket && (url.hostname === `${bucket}.tcb.qcloud.la` || url.hostname.match(new RegExp(`^${bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.cos\\.[a-z0-9-]+\\.myqcloud\\.com$`))) && decodeURIComponent(url.pathname.slice(1)) === path);
  } catch { return false; }
}
function uses(value, id) {
  let found = false; walk(value, (v) => { if (matches(v,id) || v.includes(id)) found = true; return v; }); return found;
}
function internal(doc, source) { return source === 'settings' && String(doc._id).startsWith('__image_'); }
function inactive(doc, source) { return internal(doc, source) || (['products', 'skus'].includes(source) && doc.deletedByAdmin === true); }

// All image-bearing writes share a fence with deletion, and reject retired IDs.
function imageLifecycleRuntime(runtime) {
  if (runtime.imageLifecycle) return runtime;
  const raw = runtime.db, removed = new Set();
  function wrap(db, transactional = false) {
    return new Proxy(db, { get(target, key) {
      if (key === 'runTransaction') return (fn) => target.runTransaction((tx) => fn(wrap(tx, true)));
      if (key === 'startTransaction') return async () => wrap(await target.startTransaction(), true);
      if (key !== 'collection') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      return (source) => {
        const collection = target.collection(source);
        if (!SOURCES.includes(source)) return collection;
        return new Proxy(collection, { get(ref, method) {
          if (method === 'add') return async (value) => {
            if (!files(value).length) return ref.add(value);
            const id = crypto.randomUUID(); await write(id, 'set', value); return { id };
          };
          if (method !== 'doc') return typeof ref[method] === 'function' ? ref[method].bind(ref) : ref[method];
          return (id) => new Proxy(ref.doc(id), { get(doc, method) {
            if (method === 'set' || method === 'update' || method === 'remove') return (value) => write(id, method, value);
            return typeof doc[method] === 'function' ? doc[method].bind(doc) : doc[method];
          } });
        } });
        async function write(id, method, value) {
          if (source === 'settings' && String(id).startsWith('__image_')) return target.collection(source).doc(id)[method](value);
          // Metadata changes cannot introduce or retire image references. Keep
          // them in the caller's transaction without starting a second fence.
          if (method === 'update' && Object.keys(value || {}).every((key) => IMAGE_NEUTRAL_FIELDS.has(key)) && !files(value).length) {
            return target.collection(source).doc(id).update(value);
          }
          const apply = async (tx) => {
            const previous = await getDoc(tx.collection(source), id, false);
            if (method === 'remove') {
              if (files(previous).length) {
                const settings = tx.collection('settings');
                const control = await getDoc(settings, CONTROL, false) || { version: 0 };
                await setDoc(settings, CONTROL, { version: control.version + 1 });
                files(previous).forEach((file) => removed.add(file));
              }
              return tx.collection(source).doc(id).remove();
            }
            const ids = files(value);
            const previousIds = files(previous);
            const next = method === 'set' ? value : { ...previous, ...value };
            const nextIds = files(next);
            if (inactive(previous || {}, source) === inactive(next, source)
              && previousIds.length === nextIds.length && previousIds.every((file) => nextIds.includes(file))) {
              return tx.collection(source).doc(id)[method](value);
            }
            const settings = tx.collection('settings');
            const control = await getDoc(settings, CONTROL, false) || { version: 0 };
            const mapping = new Map();
            await Promise.all(ids.map(async (file) => {
              let current = file;
              const seen = new Set();
              while (true) {
                if (seen.has(current) || seen.size >= 50) throw errorFrom('CONFLICT');
                seen.add(current);
                const state = await getDoc(settings, stateId(current), false);
                if (state?.newFileID) { current = state.newFileID; continue; }
                if (state?.status === 'deleting' || state?.status === 'deleted') throw errorFrom('CONFLICT', { field: 'image', reason: '图片已清理，请重新上传' });
                break;
              }
              mapping.set(file, current);
            }));
            const normalized = walk(value, (v) => mapping.get(canonical(v)) || v);
            const after = method === 'set' ? normalized : { ...previous, ...normalized };
            for (const file of files(previous)) if (inactive(after, source) || !uses(after, file)) removed.add(file);
            await setDoc(settings, CONTROL, { version: control.version + 1 });
            return tx.collection(source).doc(id)[method](normalized);
          };
          return transactional ? apply(target) : withTransaction(raw, apply);
        }
      };
    } });
  }
  return { ...runtime, db: wrap(raw), rawDb: raw, imageLifecycle: true, removedImages: removed };
}

async function referencePage(runtime, data) {
  if (!SOURCES.includes(data.source)) throw errorFrom('INVALID_ARGUMENT');
  const offset = Number(data.offset || 0);
  if (!Number.isInteger(offset) || offset < 0) throw errorFrom('INVALID_ARGUMENT');
  const result = await list(runtime.db.collection(data.source), { skip: offset, limit: 25, orderBy: { field: '_id', direction: 'asc' }, includeTotal: false });
  const items = result.items.filter((doc) => !inactive(doc, data.source)).map((doc) => ({ id: doc._id, strings: (() => { const values = new Set(); walk(doc, (v) => { if (stored(v) || /https?:\/\/|cloud:\/\//.test(v)) values.add(v); return v; }); return [...values]; })() }));
  return { items, nextOffset: offset + result.items.length, done: result.items.length < 25, sources: SOURCES };
}
async function references(runtime, ids) {
  const started = Date.now();
  const referenced = new Set();
  await Promise.all(SOURCES.map(async (source) => {
    for (let offset = 0; ; offset += 100) {
      if (Date.now() - started > 1300) throw errorFrom('CONFLICT', { reason: '盘点未完成，保留文件稍后重试' });
      const result = await list(runtime.db.collection(source), { skip: offset, limit: 100, orderBy: { field: '_id', direction: 'asc' }, includeTotal: false });
      for (const doc of result.items) if (!inactive(doc, source)) for (const id of ids) if (uses(doc, id)) referenced.add(id);
      if (result.items.length < 100) break;
    }
  }));
  return referenced;
}
async function cleanup(runtime, data) {
  const ids = [...new Set(data.fileList || [])];
  if (!ids.length || ids.length > 5 || ids.some((id) => !/^(?:cloud:\/\/[^/]+\/|local:\/\/)(?:admin\/products\/|admin\/categories\/|home\/|user\/comments\/|user\/after-sales\/)/.test(id))) throw errorFrom('INVALID_ARGUMENT');
  const control = await getDoc(runtime.db.collection('settings'), CONTROL, false) || { version: 0 };
  const referenced = await references(runtime, ids);
  const candidates = ids.filter((id) => !referenced.has(id));
  await withTransaction(runtime.db, async (tx) => {
    const settings = tx.collection('settings');
    const latest = await getDoc(settings, CONTROL, false) || { version: 0 };
    if (latest.version !== control.version) throw errorFrom('CONFLICT');
    for (const fileID of candidates) {
      const old = await getDoc(settings, stateId(fileID), false) || {};
      await setDoc(settings, stateId(fileID), { ...old, fileID, status: 'deleting' });
    }
    await setDoc(settings, CONTROL, { version: latest.version + 1 });
  });
  if (!candidates.length) return { deleted: [], retained: ids };
  const result = await runtime.app.deleteFile({ fileList: candidates });
  const deleted = [];
  for (const fileID of candidates) {
    const status = result.fileList?.find((v) => (v.fileID || v.fileId) === fileID);
    if (!status || !['SUCCESS', 'STORAGE_FILE_NONEXIST'].includes(status.code)) continue;
    const state = await getDoc(runtime.db.collection('settings'), stateId(fileID), false) || {};
    await setDoc(runtime.db.collection('settings'), stateId(fileID), { ...state, status: 'deleted' });
    deleted.push(fileID);
  }
  return { deleted, retained: [...referenced], pending: candidates.filter((id) => !deleted.includes(id)) };
}
async function replaceReference(runtime, data) {
  const { oldFileID, newFileID, source, id } = data;
  if (!SOURCES.includes(source) || (source === 'settings' && String(id).startsWith('__image_')) || !stored(oldFileID) || !stored(newFileID) || !newFileID.endsWith('.webp') || oldFileID.slice(0, oldFileID.lastIndexOf('/') + 1) !== newFileID.slice(0, newFileID.lastIndexOf('/') + 1)) throw errorFrom('INVALID_ARGUMENT');
  return withTransaction(runtime.db, async (tx) => {
    const settings = tx.collection('settings');
    const control = await getDoc(settings, CONTROL, false) || { version: 0 };
    const prior = await getDoc(settings, stateId(oldFileID), false);
    if (prior?.newFileID && prior.newFileID !== newFileID) throw errorFrom('CONFLICT');
    const doc = await getDoc(tx.collection(source), String(id), false);
    if (!doc) return { updated: false };
    const next = walk(doc, (v) => matches(v, oldFileID) ? newFileID : v);
    if (uses(next, oldFileID)) throw errorFrom('CONFLICT', { reason: '引用包含非独立链接，需人工处理' });
    await setDoc(tx.collection(source), String(id), next);
    await setDoc(settings, stateId(oldFileID), { fileID: oldFileID, newFileID, status: 'replaced' });
    await setDoc(settings, CONTROL, { version: control.version + 1 });
    return { updated: true };
  });
}
module.exports = { imageLifecycleRuntime, referencePage, cleanup, replaceReference, files, matches, uses, SOURCES };
