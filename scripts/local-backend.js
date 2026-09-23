'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { processImageBuffer } = require('../cloudfunctions/.build/shared/image-upload');

const { fail, ok, runEndpoint } = require('../cloudfunctions/.build/shared/response');
const { errorFrom } = require('../cloudfunctions/.build/shared/errors');
const { adminEndpoint } = require('../cloudfunctions/.build/shared/admin');
const { shopEndpoint } = require('../cloudfunctions/.build/shared/shop');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.LOCAL_BACKEND_PORT || 8787);
const host = process.env.LOCAL_BACKEND_HOST || '127.0.0.1';
const publicHost = host === '0.0.0.0' ? '127.0.0.1' : host;
const baseUrl = `http://${publicHost}:${port}`;
const dataFile = path.join(root, 'data', '.local-backend.json');
const filesRoot = path.join(root, 'data', '.local-files');
const collectionNames = ['categories', 'products', 'skus', 'addresses', 'carts', 'orders', 'comments', 'afterSales', 'homeContents', 'searchHistories', 'settings', 'adminMembers'];

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function seedState() {
  const timestamp = now();
  return {
    version: 1,
    collections: {
      categories: {},
      products: {},
      skus: {},
      addresses: {}, carts: {}, orders: {}, comments: {}, afterSales: {}, searchHistories: {}, settings: {},
      homeContents: {},
      adminMembers: {
        'local-admin': { _id: 'local-admin', uid: 'local-admin', username: 'admin', displayName: '本地管理员', roles: ['superadmin'], status: 'active', enabled: true, createdAt: timestamp, updatedAt: timestamp },
      },
    },
  };
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const state = saved && typeof saved === 'object' ? saved : seedState();
    state.collections = state.collections && typeof state.collections === 'object' ? state.collections : {};
    collectionNames.forEach((name) => {
      if (!state.collections[name] || typeof state.collections[name] !== 'object') state.collections[name] = {};
    });
    return state;
  } catch {
    return seedState();
  }
}

function compareValues(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && left !== '' && right !== '') return leftNumber - rightNumber;
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN');
}

function sameValue(actual, expected) {
  if (Array.isArray(actual) && !Array.isArray(expected)) return actual.some((item) => sameValue(item, expected));
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    try { return JSON.stringify(actual) === JSON.stringify(expected); } catch { return false; }
  }
  return actual === expected;
}

function matchesCondition(actual, expected) {
  if (expected instanceof RegExp) return expected.test(String(actual ?? ''));
  if (expected && typeof expected === 'object' && expected.__localOp) {
    if (expected.__localOp === 'in') return expected.values.some((value) => sameValue(actual, value));
    if (expected.__localOp === 'neq') return !sameValue(actual, expected.value);
    if (expected.__localOp === 'gte') return compareValues(actual, expected.value) >= 0;
    if (expected.__localOp === 'lte') return compareValues(actual, expected.value) <= 0;
    if (expected.__localOp === 'and') return expected.values.every((value) => matchesCondition(actual, value));
  }
  return sameValue(actual, expected);
}

function matchesQuery(document, query = {}) {
  return Object.entries(query).every(([field, expected]) => matchesCondition(document[field], expected));
}

class LocalDocument {
  constructor(database, name, id) {
    this.database = database;
    this.name = name;
    this.id = String(id);
  }

  bucket() { return this.database.state.collections[this.name]; }

  async get() {
    const value = this.bucket()[this.id];
    return { data: value ? [clone(value)] : [] };
  }

  async set(value) {
    this.bucket()[this.id] = { ...clone(value), _id: String(value?._id || this.id) };
    this.database.changed();
    return { upserted: 1 };
  }

  async update(patch) {
    if (!this.bucket()[this.id]) return { updated: 0 };
    this.bucket()[this.id] = { ...this.bucket()[this.id], ...clone(patch), _id: this.bucket()[this.id]._id || this.id };
    this.database.changed();
    return { updated: 1 };
  }

  async remove() {
    if (!this.bucket()[this.id]) return { deleted: 0 };
    delete this.bucket()[this.id];
    this.database.changed();
    return { deleted: 1 };
  }
}

class LocalQuery {
  constructor(database, name, query = {}) {
    this.database = database;
    this.name = name;
    this.query = query || {};
    this.sortField = '';
    this.sortDirection = 'desc';
    this.offset = 0;
    this.max = 0;
  }

  where(query = {}) { this.query = query || {}; return this; }
  orderBy(field, direction = 'desc') { this.sortField = field; this.sortDirection = direction; return this; }
  skip(value) { this.offset = Math.max(0, Number(value) || 0); return this; }
  limit(value) { this.max = Math.max(0, Number(value) || 0); return this; }

  all() {
    let rows = Object.values(this.database.state.collections[this.name]).filter((item) => matchesQuery(item, this.query));
    if (this.sortField) {
      rows.sort((left, right) => {
        const result = compareValues(left[this.sortField], right[this.sortField]);
        return this.sortDirection === 'asc' ? result : -result;
      });
    }
    return rows;
  }

  async get() {
    let rows = this.all().slice(this.offset);
    if (this.max > 0) rows = rows.slice(0, this.max);
    return { data: rows.map(clone) };
  }

  async count() { return { total: this.all().length }; }

  async remove() {
    const bucket = this.database.state.collections[this.name];
    const ids = Object.entries(bucket).filter(([, item]) => matchesQuery(item, this.query)).map(([id]) => id);
    ids.forEach((id) => delete bucket[id]);
    if (ids.length) this.database.changed();
    return { deleted: ids.length };
  }
}

class LocalCollection {
  constructor(database, name) { this.database = database; this.name = name; }
  doc(id) { return new LocalDocument(this.database, this.name, id); }
  where(query = {}) { return new LocalQuery(this.database, this.name, query); }
  get() { return new LocalQuery(this.database, this.name, {}).get(); }
  count() { return new LocalQuery(this.database, this.name, {}).count(); }
  orderBy(field, direction = 'desc') { return new LocalQuery(this.database, this.name, {}).orderBy(field, direction); }
  skip(value) { return new LocalQuery(this.database, this.name, {}).skip(value); }
  limit(value) { return new LocalQuery(this.database, this.name, {}).limit(value); }
  remove() { return new LocalQuery(this.database, this.name, {}).remove(); }
  async add(value) {
    const id = String(value?._id || `local_${this.name}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
    await this.doc(id).set({ ...value, _id: id });
    return { id };
  }
}

class LocalDatabase {
  constructor(state, persistEnabled = true) {
    this.state = state;
    this.persistEnabled = persistEnabled;
    this.command = {
      in: (values) => ({ __localOp: 'in', values: Array.isArray(values) ? values : [] }),
      neq: (value) => ({ __localOp: 'neq', value }),
      gte: (value) => ({ __localOp: 'gte', value }),
      lte: (value) => ({ __localOp: 'lte', value }),
      and: (...values) => ({ __localOp: 'and', values }),
    };
    this.RegExp = ({ regexp, options }) => new RegExp(regexp, options || '');
  }

  collection(name) {
    if (!this.state.collections[name]) this.state.collections[name] = {};
    return new LocalCollection(this, name);
  }

  changed() {
    if (!this.persistEnabled) return;
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(this.state, null, 2), 'utf8');
  }

  async runTransaction(worker) {
    const transactionState = clone(this.state);
    const transactionDb = new LocalDatabase(transactionState, false);
    const result = await worker(transactionDb);
    this.state = transactionState;
    this.changed();
    return { result };
  }
}

const database = new LocalDatabase(loadState());

function tempFileUrl(fileID) {
  if (String(fileID).startsWith('local://')) return `${baseUrl}/files?fileID=${encodeURIComponent(fileID)}`;
  return fileID;
}

const runtime = {
  db: database,
  app: {
    async getTempFileURL({ fileList }) {
      return { fileList: fileList.map((fileID) => ({ fileID, tempFileURL: tempFileUrl(fileID) })) };
    },
  },
  auth: { getUserInfo: () => ({ uid: 'local-user' }) },
};

function headerValue(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function readBody(request, maxBytes = 14 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseJson(buffer) {
  try { return JSON.parse(buffer.toString('utf8') || '{}'); } catch { throw errorFrom('INVALID_ARGUMENT'); }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-local-uid',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function safeRelativePart(value, fallback = 'uploads') {
  const segments = String(value || fallback).replace(/\\/g, '/').split('/').filter((segment) => /^[a-zA-Z0-9_-]+$/.test(segment));
  return segments.length ? segments.join('/') : fallback;
}

function splitMultipart(buffer, boundary) {
  const separator = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const next = buffer.indexOf(separator, cursor);
    if (next < 0) break;
    if (next > cursor) parts.push(buffer.slice(cursor, next));
    cursor = next + separator.length;
  }
  return parts;
}

function parseMultipart(buffer, contentType) {
  const match = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!match) throw errorFrom('INVALID_ARGUMENT');
  const fields = {};
  let file;
  let fileName = 'upload.bin';
  splitMultipart(buffer, match[1]).forEach((raw) => {
    let part = raw;
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(-2).toString() === '\r\n') part = part.subarray(0, -2);
    if (!part.length || part.subarray(0, 2).toString() === '--') return;
    const divider = Buffer.from('\r\n\r\n');
    const index = part.indexOf(divider);
    if (index < 0) return;
    const headers = part.subarray(0, index).toString('utf8');
    const content = part.subarray(index + divider.length);
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    if (!nameMatch) return;
    const fieldName = nameMatch[1];
    const filenameMatch = /filename="([^"]*)"/i.exec(headers);
    if (filenameMatch) {
      file = content;
      fileName = filenameMatch[1] || fileName;
    } else {
      fields[fieldName] = content.toString('utf8');
    }
  });
  if (!file) throw errorFrom('INVALID_ARGUMENT');
  return { fields, file, fileName };
}

async function saveUpload(request) {
  const contentType = String(headerValue(request, 'content-type') || '');
  const buffer = await readBody(request);
  let fields;
  let file;
  let fileName;
  if (contentType.includes('application/json')) {
    const body = parseJson(buffer);
    fields = body;
    fileName = body.name;
    file = Buffer.from(Array.isArray(body.content) ? body.content : String(body.content || ''), Array.isArray(body.content) ? undefined : 'base64');
  } else {
    const parsed = parseMultipart(buffer, contentType);
    fields = parsed.fields;
    file = parsed.file;
    fileName = parsed.fileName;
  }
  if (!file || !file.length) throw errorFrom('INVALID_ARGUMENT');
  const image = await processImageBuffer(file, fileName);
  const folder = safeRelativePart(fields.folder, 'uploads');
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.webp`;
  const relative = `${folder}/${name}`;
  const destination = path.resolve(filesRoot, relative);
  if (!destination.startsWith(`${path.resolve(filesRoot)}${path.sep}`)) throw errorFrom('FORBIDDEN');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, image);
  return { fileID: `local://${relative}` };
}

function localFilePath(fileID) {
  if (!String(fileID).startsWith('local://')) return null;
  const relative = String(fileID).slice('local://'.length).replace(/\\/g, '/');
  const destination = path.resolve(filesRoot, relative);
  if (!destination.startsWith(`${path.resolve(filesRoot)}${path.sep}`)) return null;
  return destination;
}

async function handleApi(request, response, body) {
  const scope = body.scope === 'admin' ? 'admin' : body.scope === 'shop' ? 'shop' : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!scope || !action) return sendJson(response, fail(errorFrom('INVALID_ARGUMENT')));
  const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
  const uid = headerValue(request, 'x-local-uid') || (scope === 'admin' ? 'local-admin' : 'local-user');
  const context = { auth: { uid: String(uid) } };
  const endpoint = scope === 'admin' ? adminEndpoint : shopEndpoint;
  const result = await runEndpoint(
    (event, endpointContext) => endpoint(event, endpointContext, runtime, action, data),
    { scope, action, data },
    context,
    runtime,
  );
  return sendJson(response, result);
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') return sendJson(response, ok(null));
  const requestUrl = new URL(request.url || '/', baseUrl);
  if (request.method === 'GET' && requestUrl.pathname === '/health') return sendJson(response, ok({ service: 'wc-shop-local-backend', port }));
  if (request.method === 'GET' && requestUrl.pathname === '/files') {
    const filePath = localFilePath(requestUrl.searchParams.get('fileID') || '');
    if (!filePath || !fs.existsSync(filePath)) return sendJson(response, fail(errorFrom('NOT_FOUND')), 404);
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': contentTypes[extension] || 'application/octet-stream' });
    return response.end(fs.readFileSync(filePath));
  }
  if (request.method !== 'POST') return sendJson(response, fail(errorFrom('INVALID_ARGUMENT')), 405);
  if (requestUrl.pathname === '/auth/login') {
    try {
      const body = parseJson(await readBody(request, 1024 * 1024));
      if (!['admin', 'local-admin'].includes(String(body.username || '')) || String(body.password || '') !== 'admin') throw errorFrom('UNAUTHENTICATED');
      return sendJson(response, ok({ uid: 'local-admin', username: 'admin' }));
    } catch (error) {
      return sendJson(response, fail(error), 401);
    }
  }
  if (requestUrl.pathname === '/upload') {
    try { return sendJson(response, ok(await saveUpload(request))); } catch (error) { return sendJson(response, fail(error), 400); }
  }
  if (requestUrl.pathname === '/api') {
    try { return await handleApi(request, response, parseJson(await readBody(request))); } catch (error) { return sendJson(response, fail(error), 500); }
  }
  return sendJson(response, fail(errorFrom('NOT_FOUND')), 404);
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => sendJson(response, fail(error), 500));
});

server.listen(port, host, () => {
  database.changed();
  console.log(`wc-shop 本地后台已启动：${baseUrl}`);
  console.log('小程序请求身份：local-user（仅用于鉴权，不写入用户档案）；后台账号：admin / admin');
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
