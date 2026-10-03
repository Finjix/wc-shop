// @ts-nocheck
const crypto = require('crypto');
const { getDoc, setDoc, list, withTransaction } = require('./db');
const { AppError, errorFrom } = require('./errors');
const { string, integer } = require('./validation');
const { SOURCES, COLLECTION_LABELS, hash, pathOf, isStoredImage, collectImages, mapImages, groupOf } = require('./image-references');

const JOBS = 'resourceJobs', ENTRIES = 'resourceInventory', CONTROL = 'resourceControl';
const BATCH = 15;
const META_BATCH = 5;
const EMPTY_TOTAL = () => ({ count: 0, bytes: 0, unknown: 0 });
const entryId = (scanID, fileID) => `${scanID}_${hash(fileID)}`;
const stamp = () => new Date().toISOString();
const fail = (message) => new AppError('STORAGE_ERROR', message);

function describeHeader(bytes) {
  const text = (at, length) => bytes.subarray(at, at + length).toString('ascii');
  if (text(0, 3) === 'GIF') return { format: 'gif', animated: true };
  if (bytes[0] === 255 && bytes[1] === 216) return { format: 'jpeg', animated: false };
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return { format: 'webp', animated: text(12, 4) === 'VP8X' && Boolean(bytes[20] & 2) };
  if (bytes.length >= 8 && bytes[0] === 137 && text(1, 3) === 'PNG') {
    for (let offset = 8; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32BE(offset), type = text(offset + 4, 4);
      if (type === 'acTL') return { format: 'png', animated: true };
      if (type === 'IDAT') return { format: 'png', animated: false };
      offset += size + 12;
    }
    return { format: 'png', animated: null };
  }
  return { format: null, animated: null };
}

async function readInfo(runtime, fileID) {
  if (runtime.resourceFileInfo) return runtime.resourceFileInfo(fileID);
  try {
    const result = await runtime.app.getFileInfo({ fileList: [fileID] });
    const info = result.fileList?.[0];
    if (!info || (info.code && info.code !== 'SUCCESS')) {
      const error = fail('图片不存在或没有读取权限');
      error.missing = /not.?exist|nonexist|not.?found|404/i.test(info?.code || '');
      throw error;
    }
    const url = info.tempFileURL;
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    if (!head.ok) { const error = fail('无法读取图片信息'); error.missing = head.status === 404; throw error; }
    const length = head.headers.get('content-length');
    const size = length !== null && Number.isFinite(Number(length)) ? Number(length) : null;
    const etag = head.headers.get('etag');
    const response = await fetch(url, { headers: { Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw fail('无法读取图片格式');
    const reader = response.body.getReader();
    let total = 0;
    const chunks = [];
    try {
      while (total < 65536) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value).subarray(0, 65536 - total);
        chunks.push(chunk); total += chunk.length;
      }
    } finally { await reader.cancel(); }
    const header = describeHeader(Buffer.concat(chunks));
    const format = header.format || (info.contentType || '').replace(/^image\//, '').split(';')[0] || pathOf(fileID).split('.').pop().toLowerCase();
    return { size, format, animated: header.animated, version: etag ? `${etag}:${size}` : null, url, status: 'ok' };
  } catch (error) {
    return { size: null, format: pathOf(fileID).split('.').pop().toLowerCase(), animated: null, version: null, status: 'error', missing: Boolean(error.missing), error: error.message || '无法读取图片' };
  }
}

async function pageDocuments(runtime, source, cursor = '') {
  const where = cursor ? { _id: runtime.db.command.gt(cursor) } : {};
  return (await list(runtime.db.collection(source), { where, limit: BATCH, orderBy: { field: '_id', direction: 'asc' }, includeTotal: false })).items;
}
async function lease(runtime, id, kind) {
  return withTransaction(runtime.db, async (tx) => {
    const job = await getDoc(tx.collection(JOBS), id, true);
    if (job.kind !== kind) throw errorFrom('INVALID_ARGUMENT');
    if (job.leaseUntil > Date.now()) return { ...job, busy: true };
    const token = crypto.randomUUID();
    const next = { ...job, token, leaseUntil: Date.now() + 45_000 };
    await setDoc(tx.collection(JOBS), id, next);
    return next;
  });
}
async function checkpoint(runtime, job, patch) {
  return withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection(JOBS), job._id, true);
    if (current.token !== job.token) throw errorFrom('CONFLICT');
    const next = { ...current, ...patch, token: '', leaseUntil: 0, error: '', updatedAt: stamp() };
    await setDoc(tx.collection(JOBS), job._id, next);
    return next;
  });
}
async function releaseFailure(runtime, job, error) {
  await withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection(JOBS), job._id, false);
    if (current?.token === job.token) await setDoc(tx.collection(JOBS), job._id, { ...current, token: '', leaseUntil: 0, error: error.message || '操作失败', updatedAt: stamp() });
  });
}

async function scan(runtime, data) {
  if (!data.scanID) {
    return withTransaction(runtime.db, async (tx) => {
      const control = await getDoc(tx.collection(CONTROL), 'current', false) || {};
      if (control.runningScanID) {
        const running = await getDoc(tx.collection(JOBS), control.runningScanID, false);
        if (running && running.status !== 'completed') return running;
      }
      const id = `scan-${crypto.randomUUID()}`;
      const job = { _id: id, kind: 'scan', status: 'references', sourceIndex: 0, cursor: '', documents: 0, total: EMPTY_TOTAL(), groups: {}, createdAt: stamp() };
      await setDoc(tx.collection(JOBS), id, job);
      await setDoc(tx.collection(CONTROL), 'current', { ...control, runningScanID: id });
      return job;
    });
  }
  const job = await lease(runtime, string(data.scanID, 'scanID', { max: 128 }), 'scan');
  if (job.kind !== 'scan') throw errorFrom('INVALID_ARGUMENT');
  if (job.status === 'completed') {
    await withTransaction(runtime.db, async (tx) => {
      const control = await getDoc(tx.collection(CONTROL), 'current', false) || {};
      if (control.runningScanID === job._id) await setDoc(tx.collection(CONTROL), 'current', { ...control, scanID: job._id, runningScanID: '', updatedAt: stamp() });
    });
    return job;
  }
  if (job.busy) return job;
  try {
    if (job.status === 'references') {
      const source = SOURCES[job.sourceIndex];
      const documents = await pageDocuments(runtime, source, job.cursor);
      let budget = 40, processed = 0, cursor = job.cursor, pendingDocID = '', imageOffset = 0;
      for (const document of documents) {
        const images = collectImages(document);
        let offset = document._id === job.pendingDocID ? job.imageOffset || 0 : 0;
        for (; offset < images.length && budget > 0; offset++, budget--) {
          const fileID = images[offset];
          const id = entryId(job._id, fileID), group = groupOf(fileID, source);
          await withTransaction(runtime.db, async (tx) => {
            const current = await getDoc(tx.collection(ENTRIES), id, false);
            const use = { source, id: document._id, label: `${COLLECTION_LABELS[source]}：${document.title || document.name || document.orderNo || document._id}` };
            const uses = current?.uses || [];
            const nextUses = uses.some((item) => item.source === source && item.id === document._id) ? uses : [...uses, use].slice(0, 20);
            await setDoc(tx.collection(ENTRIES), id, { ...current, scanID: job._id, fileID, name: pathOf(fileID).split('/').pop(), groups: [...new Set([...(current?.groups || []), group])], uses: nextUses });
          });
        }
        if (offset < images.length) { pendingDocID = document._id; imageOffset = offset; break; }
        processed++; cursor = document._id;
        if (!budget) break;
      }
      const done = processed === documents.length && documents.length < BATCH && !pendingDocID;
      const nextIndex = job.sourceIndex + (done ? 1 : 0);
      return checkpoint(runtime, job, { sourceIndex: nextIndex, cursor: done ? '' : cursor, pendingDocID, imageOffset, documents: job.documents + processed, status: nextIndex === SOURCES.length ? 'metadata' : 'references' });
    }
    const entries = (await list(runtime.db.collection(ENTRIES), { where: { scanID: job._id, ...(job.cursor ? { _id: runtime.db.command.gt(job.cursor) } : {}) }, limit: META_BATCH, orderBy: { field: '_id', direction: 'asc' }, includeTotal: false })).items;
    const total = { ...job.total }, groups = JSON.parse(JSON.stringify(job.groups));
    for (let offset = 0; offset < entries.length; offset += 5) {
      await Promise.all(entries.slice(offset, offset + 5).map(async (entry) => {
        const info = await readInfo(runtime, entry.fileID);
        await setDoc(runtime.db.collection(ENTRIES), entry._id, { ...entry, ...info });
        total.count++;
        if (info.size === null || info.size === undefined) total.unknown++; else total.bytes += info.size;
        for (const group of entry.groups) {
          const value = groups[group] || (groups[group] = EMPTY_TOTAL());
          value.count++;
          if (info.size === null || info.size === undefined) value.unknown++; else value.bytes += info.size;
        }
      }));
    }
    const completed = entries.length < META_BATCH;
    const next = await checkpoint(runtime, job, { cursor: entries.length ? entries.at(-1)._id : job.cursor, total, groups, status: completed ? 'completed' : 'metadata' });
    if (completed) await withTransaction(runtime.db, async (tx) => {
      const control = await getDoc(tx.collection(CONTROL), 'current', false) || {};
      if (control.runningScanID === job._id) await setDoc(tx.collection(CONTROL), 'current', { ...control, scanID: job._id, runningScanID: '', updatedAt: stamp() });
    });
    return next;
  } catch (error) { await releaseFailure(runtime, job, error); throw error; }
}

async function resourceList(runtime, data) {
  const control = await getDoc(runtime.db.collection(CONTROL), 'current', false) || {};
  const completed = control.scanID ? await getDoc(runtime.db.collection(JOBS), control.scanID, true) : null;
  const running = control.runningScanID ? await getDoc(runtime.db.collection(JOBS), control.runningScanID, false) : null;
  const where = { scanID: control.scanID || 'none' };
  if (data.group) where.groups = string(data.group, 'group', { max: 32 });
  if (data.query) where.name = runtime.db.RegExp({ regexp: String(data.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
  const page = data.page === undefined ? 1 : integer(data.page, 'page', { min: 1, max: 100000 });
  const result = await list(runtime.db.collection(ENTRIES), { where, skip: (page - 1) * 20, limit: 20, orderBy: { field: '_id', direction: 'asc' } });
  const items = await Promise.all(result.items.map(async (entry) => {
    let url = '';
    if (entry.status === 'ok') {
      try { url = (await runtime.app.getTempFileURL({ fileList: [entry.fileID] })).fileList?.[0]?.tempFileURL || ''; } catch { /* Row stays visible if URL refresh fails. */ }
    }
    return { ...entry, url };
  }));
  const jobs = (await list(runtime.db.collection(JOBS), { where: { kind: 'replacement', status: runtime.db.command.neq('completed') }, limit: 20, includeTotal: false })).items;
  return { items, page, total: result.total || 0, summary: completed?.total || null, groupSummary: data.group ? completed?.groups?.[data.group] || EMPTY_TOTAL() : null, updatedAt: control.updatedAt || null, scan: running, jobs };
}

async function stillReferenced(runtime, entry) {
  for (const use of entry.uses) {
    const document = await getDoc(runtime.db.collection(use.source), use.id, false);
    if (document && collectImages(document).includes(entry.fileID)) return true;
  }
  return false;
}
async function beginReplacement(runtime, data, uid) {
  const fileID = string(data.fileID, 'fileID', { max: 1024 });
  if (!isStoredImage(fileID)) throw errorFrom('INVALID_ARGUMENT');
  const id = `replace-${hash(fileID)}`;
  const prior = await getDoc(runtime.db.collection(JOBS), id, false);
  if (prior && prior.status !== 'completed') return prior;
  const control = await getDoc(runtime.db.collection(CONTROL), 'current', true);
  const entry = await getDoc(runtime.db.collection(ENTRIES), entryId(control.scanID, fileID), true);
  if (!await stillReferenced(runtime, entry)) throw new AppError('CONFLICT', '图片引用已变化，请刷新资源列表');
  const info = await readInfo(runtime, fileID);
  if (info.status !== 'ok' || !info.version) throw fail('无法校验图片版本，请刷新后重试');
  if (data.version !== info.version || entry.version !== info.version) throw errorFrom('CONFLICT');
  if (!['png', 'jpeg', 'jpg', 'webp'].includes(info.format) || info.animated === true) throw new AppError('IMAGE_FORMAT', '仅支持静态 PNG、JPEG、WebP');
  const sourcePath = pathOf(fileID), folder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
  const cloudPath = `${folder ? `${folder}/` : ''}_resource-${crypto.randomUUID()}.webp`;
  const job = { _id: id, kind: 'replacement', owner: uid, oldFileID: fileID, sourceName: entry.name, sourceFormat: info.format, oldSize: info.size, version: info.version, folder, cloudPath, status: 'awaiting_upload', sourceIndex: 0, cursor: '', updatedDocuments: 0, createdAt: stamp(), updatedAt: stamp() };
  return withTransaction(runtime.db, async (tx) => {
    const existing = await getDoc(tx.collection(JOBS), id, false);
    if (existing && existing.status !== 'completed') return existing;
    await setDoc(tx.collection(JOBS), id, job);
    return job;
  });
}
async function replacementUploadJob(runtime, id, uid) {
  const job = await getDoc(runtime.db.collection(JOBS), string(id, 'jobID', { max: 128 }), true);
  if (job.kind !== 'replacement' || job.status !== 'awaiting_upload') throw errorFrom('FORBIDDEN');
  return job;
}

async function advanceReplacement(runtime, data) {
  const job = await lease(runtime, string(data.jobID, 'jobID', { max: 128 }), 'replacement');
  if (job.kind !== 'replacement') throw errorFrom('INVALID_ARGUMENT');
  if (job.busy || job.status === 'completed') return job;
  try {
    if (job.status === 'awaiting_upload') {
      if (!data.newFileID) return checkpoint(runtime, job, {});
      const newFileID = string(data.newFileID, 'newFileID', { max: 1024 });
      const expected = job.oldFileID.startsWith('local://') ? `local://${job.cloudPath}` : `${job.oldFileID.slice(0, job.oldFileID.indexOf('/', 8) + 1)}${job.cloudPath}`;
      if (newFileID !== expected) throw errorFrom('FORBIDDEN');
      const original = await readInfo(runtime, job.oldFileID), nextInfo = await readInfo(runtime, newFileID);
      if (original.version !== job.version || original.status !== 'ok') throw errorFrom('CONFLICT');
      if (nextInfo.status !== 'ok' || nextInfo.format !== 'webp' || nextInfo.animated === true || !nextInfo.version) throw fail('新文件不是有效的静态 WebP');
      return withTransaction(runtime.db, async (tx) => {
        const current = await getDoc(tx.collection(JOBS), job._id, true);
        const control = await getDoc(tx.collection(CONTROL), 'current', false) || {};
        if (current.token !== job.token) throw errorFrom('CONFLICT');
        const next = { ...current, newFileID, newSize: nextInfo.size, newVersion: nextInfo.version, status: 'updating', sourceIndex: 0, cursor: '', token: '', leaseUntil: 0, error: '', updatedAt: stamp() };
        await setDoc(tx.collection('resourceAliases'), hash(job.oldFileID), { oldFileID: job.oldFileID, newFileID, jobID: job._id, updatedAt: stamp() });
        await setDoc(tx.collection(CONTROL), 'current', { ...control, fence: crypto.randomUUID() });
        await setDoc(tx.collection(JOBS), job._id, next);
        return next;
      });
    }
    if (job.status === 'cleanup_pending') {
      const original = await readInfo(runtime, job.oldFileID);
      const next = await readInfo(runtime, job.newFileID);
      if (next.status !== 'ok' || next.version !== job.newVersion) throw fail('替换文件已变化，旧图暂不删除');
      if (original.status === 'ok' && original.version !== job.version) throw fail('旧图已变化，暂不删除');
      // A missing original is success on a retry after an interrupted delete response.
      if (original.status === 'ok') {
        const result = await runtime.app.deleteFile({ fileList: [job.oldFileID] });
        if (result.fileList?.some((item) => item.code && !['SUCCESS', 'FILE_NOT_EXIST'].includes(item.code))) throw fail('替换完成，旧图清理待重试');
      } else if (!original.missing) throw fail('无法确认旧图状态，清理待重试');
      return checkpoint(runtime, job, { status: 'completed', completedAt: stamp() });
    }
    const source = SOURCES[job.sourceIndex];
    const documents = await pageDocuments(runtime, source, job.cursor);
    let changed = 0;
    for (const document of documents) {
      if (!collectImages(document).includes(job.oldFileID)) continue;
      const updated = await withTransaction(runtime.db, async (tx) => {
        const current = await getDoc(tx.collection(source), document._id, false);
        if (!current || !collectImages(current).includes(job.oldFileID)) return false;
        const normalized = mapImages(current, (file) => file === job.oldFileID ? job.newFileID : file);
        await setDoc(tx.collection(source), document._id, normalized);
        return true;
      });
      if (updated) changed++;
    }
    const done = documents.length < BATCH;
    const index = job.sourceIndex + (done ? 1 : 0);
    const finishedPass = index === SOURCES.length;
    return checkpoint(runtime, job, {
      cursor: done ? '' : documents.at(-1)._id,
      sourceIndex: finishedPass ? 0 : index,
      updatedDocuments: job.updatedDocuments + changed,
      status: finishedPass ? job.status === 'updating' ? 'verifying' : 'cleanup_pending' : job.status,
    });
  } catch (error) { await releaseFailure(runtime, job, error); throw error; }
}

async function resourcesEndpoint(runtime, action, data, auth) {
  if (action === 'storage.resources.list') return resourceList(runtime, data);
  if (action === 'storage.resources.scan') return scan(runtime, data);
  if (action === 'storage.resources.beginReplacement') return beginReplacement(runtime, data, auth.identity.uid);
  if (action === 'storage.resources.advanceReplacement') return advanceReplacement(runtime, data);
  if (action === 'storage.resources.cancelReplacement') {
    const job = await lease(runtime, string(data.jobID, 'jobID', { max: 128 }), 'replacement');
    if (job.busy) throw errorFrom('CONFLICT');
    try {
      if (job.kind !== 'replacement' || job.status !== 'awaiting_upload') throw errorFrom('CONFLICT');
      const fileID = job.oldFileID.startsWith('local://') ? `local://${job.cloudPath}` : `${job.oldFileID.slice(0, job.oldFileID.indexOf('/', 8) + 1)}${job.cloudPath}`;
      const info = await readInfo(runtime, fileID);
      if (info.status === 'ok') {
        const result = await runtime.app.deleteFile({ fileList: [fileID] });
        if (result.fileList?.some((item) => item.code && item.code !== 'SUCCESS')) throw fail('未使用的处理结果清理失败，请重试');
      } else if (!info.missing) throw fail('无法确认处理结果状态，请稍后重试');
      return checkpoint(runtime, job, { status: 'completed', cancelled: true });
    } catch (error) { await releaseFailure(runtime, job, error); throw error; }
  }
  if (action === 'storage.resources.source') {
    const job = await getDoc(runtime.db.collection(JOBS), string(data.jobID, 'jobID', { max: 128 }), true);
    if (job.kind !== 'replacement' || job.status !== 'awaiting_upload') throw errorFrom('INVALID_ARGUMENT');
    const info = await readInfo(runtime, job.oldFileID);
    if (info.status !== 'ok' || info.version !== job.version) throw errorFrom('CONFLICT');
    return { url: info.url, name: job.sourceName, format: job.sourceFormat };
  }
  throw errorFrom('INVALID_ARGUMENT');
}
module.exports = { resourcesEndpoint, readInfo, describeHeader, replacementUploadJob, scan, resourceList, beginReplacement, advanceReplacement };
