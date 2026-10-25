// @ts-nocheck
const crypto = require('crypto');
const { all } = require('./db');
const { integer, assert } = require('./validation');

// A hash seek cursor keeps a round stable across 6/12 item requests without
// sessions or database writes. Insertions below the cursor appear next round.
function readCursor(value) {
  if (!value) return { seed: crypto.randomBytes(16).toString('hex'), round: 0, after: '' };
  assert(typeof value === 'string' && value.length <= 256, { field: 'cursor' });
  let cursor;
  try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { /* validated below */ }
  assert(cursor && typeof cursor.seed === 'string' && /^[a-f0-9]{32}$/.test(cursor.seed)
    && Number.isSafeInteger(cursor.round) && cursor.round >= 0 && cursor.round < 1000000000
    && typeof cursor.after === 'string' && /^(?:[a-f0-9]{64})?$/.test(cursor.after), { field: 'cursor' });
  return { seed: cursor.seed, round: cursor.round, after: cursor.after };
}

async function readHomeFeed(runtime, data) {
  const limit = data.limit === undefined ? 6 : integer(data.limit, 'limit', { min: 1, max: 12 });
  const cursor = readCursor(data.cursor);
  const products = (await all(runtime.db.collection('products'), { status: 'active' }))
    .filter((product) => !product.deletedByAdmin);
  if (!products.length) return { items: [], nextCursor: '', total: 0 };
  const items = [];
  while (items.length < limit) {
    const ranked = products.map((product) => ({ product,
      rank: crypto.createHash('sha256').update(`${cursor.seed}:${cursor.round}:${product._id}`).digest('hex'),
    })).sort((a, b) => a.rank.localeCompare(b.rank));
    const remaining = ranked.filter((entry) => entry.rank > cursor.after);
    for (const { product, rank } of remaining) {
      items.push({ _id: product._id, title: product.title || '', primaryImage: product.primaryImage || '',
        minSalePrice: product.minSalePrice || 0, feedKey: `${cursor.seed}:${cursor.round}:${product._id}` });
      cursor.after = rank;
      if (items.length === limit) break;
    }
    if (items.length < limit) { cursor.round += 1; cursor.after = ''; }
  }
  return { items, nextCursor: Buffer.from(JSON.stringify(cursor)).toString('base64url'), total: products.length };
}

module.exports = { readHomeFeed };
