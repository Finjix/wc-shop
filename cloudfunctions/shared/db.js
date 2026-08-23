const { errorFrom, isNotFound } = require('./errors');

function resultData(result) {
  if (!result) return undefined;
  if (Object.prototype.hasOwnProperty.call(result, 'data')) return result.data;
  return result;
}

function listData(result) {
  const data = resultData(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (result && Array.isArray(result.data)) return result.data;
  return [];
}

function affected(result) {
  if (!result) return 0;
  if (typeof result.updated === 'number') return result.updated;
  if (typeof result.deleted === 'number') return result.deleted;
  if (typeof result.inserted === 'number') return result.inserted;
  if (typeof result.upserted === 'number') return result.upserted;
  if (result.upsertedId) return 1;
  if (result.stats && typeof result.stats.updated === 'number') return result.stats.updated;
  if (result.stats && typeof result.stats.deleted === 'number') return result.stats.deleted;
  if (result.stats && typeof result.stats.inserted === 'number') return result.stats.inserted;
  return 0;
}

async function getDoc(collection, id, required) {
  try {
    const result = await collection.doc(id).get();
    const data = resultData(result);
    const document = Array.isArray(data)
      ? data[0]
      : data && Array.isArray(data.data)
        ? data.data[0]
        : data;
    if (!document) {
      if (required) throw errorFrom('NOT_FOUND');
      return null;
    }
    return document;
  } catch (error) {
    if (isNotFound(error)) {
      if (required) throw errorFrom('NOT_FOUND');
      return null;
    }
    throw error;
  }
}

function safeQuery(collection, query) {
  let ref = collection;
  if (query && Object.keys(query).length) ref = ref.where(query);
  return ref;
}

async function list(collection, options) {
  const opts = options || {};
  let ref = safeQuery(collection, opts.where);
  const countRef = safeQuery(collection, opts.where);
  if (opts.orderBy) ref = ref.orderBy(opts.orderBy.field, opts.orderBy.direction || 'desc');
  if (opts.skip) ref = ref.skip(opts.skip);
  if (opts.limit) ref = ref.limit(opts.limit);
  const countPromise = opts.includeTotal !== false && typeof countRef.count === 'function'
    ? countRef.count().catch(() => null)
    : Promise.resolve(null);
  const [result, countResult] = await Promise.all([ref.get(), countPromise]);
  const total = countResult && typeof countResult.total === 'number'
    ? countResult.total
    : result && typeof result.total === 'number'
      ? result.total
      : undefined;
  return { items: listData(result), total };
}

async function withTransaction(db, worker) {
  if (typeof db.runTransaction === 'function') {
    const value = await db.runTransaction(worker);
    return value && Object.prototype.hasOwnProperty.call(value, 'result') ? value.result : value;
  }
  const transaction = await db.startTransaction();
  try {
    const value = await worker(transaction);
    await transaction.commit();
    return value;
  } catch (error) {
    if (transaction.rollback) await transaction.rollback();
    throw error;
  }
}

module.exports = { resultData, listData, affected, getDoc, safeQuery, list, withTransaction };
