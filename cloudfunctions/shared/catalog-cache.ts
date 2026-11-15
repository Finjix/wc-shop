// @ts-nocheck
const { all } = require('./db');

// Per warm function instance; never used by detail, inventory, cart or checkout.
// Other instances see catalog edits within 30 seconds even without invalidation.
const catalogs = new WeakMap();
const TTL_MS = 30000;
function key(runtime) { return runtime.rawDb || runtime.db; }
function invalidateCatalog(runtime) { catalogs.delete(key(runtime)); }

async function catalogRows(runtime, name, where = {}) {
  if (!runtime.catalogCacheEnabled) return all(runtime.db.collection(name), where);
  const owner = key(runtime);
  let cache = catalogs.get(owner);
  if (!cache) { cache = new Map(); catalogs.set(owner, cache); }
  const id = `${name}:${JSON.stringify(where)}`;
  const previous = cache.get(id);
  if (previous && previous.expires > Date.now()) return previous.promise;
  const entry = { expires: Infinity, promise: null };
  // Share the initial scan as well as completed results. Never retain failures.
  entry.promise = all(runtime.db.collection(name), where).then(rows => {
    entry.expires = Date.now() + TTL_MS;
    return rows;
  }).catch(error => { if (cache.get(id) === entry) cache.delete(id); throw error; });
  cache.set(id, entry);
  return entry.promise;
}

module.exports = { catalogRows, invalidateCatalog };
