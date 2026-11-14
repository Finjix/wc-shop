// @ts-nocheck
const { getDoc, setDoc } = require('./db');
const { assert } = require('./validation');
const SLOT = '__global_activity';
const defaults = { enabled: false, type: 'percentage', value: 0 };

async function readActivity(runtime) {
  const saved = await getDoc(runtime.db.collection('settings'), SLOT, false);
  return saved ? { enabled: saved.enabled === true, type: saved.type, value: saved.value } : { ...defaults };
}

async function saveActivity(runtime, data) {
  assert(typeof data.enabled === 'boolean', { field: 'enabled' });
  assert(['percentage', 'amount'].includes(data.type), { field: 'type' });
  const value = data.value;
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, { field: 'value' });
  assert(data.type === 'percentage' ? value < 100 : Number.isSafeInteger(value), { field: 'value' });
  assert(!data.enabled || value > 0, { field: 'value' });
  const result = { enabled: data.enabled, type: data.type, value };
  await setDoc(runtime.db.collection('settings'), SLOT, { ...result, updatedAt: new Date().toISOString() });
  return result;
}

// Prices and fixed reductions are integer cents. Never mutate catalog records.
function activityPrice(price, activity) {
  const original = Number(price) || 0;
  if (!activity?.enabled || !(activity.value > 0)) return original;
  const reduced = activity.type === 'percentage'
    ? Math.round(original * (100 - activity.value) / 100) : original - activity.value;
  return original > 0 ? Math.min(original, Math.max(1, reduced)) : original;
}

function activityProduct(product, activity) {
  if (!product) return product;
  const price = activityPrice(product.minSalePrice, activity);
  return { ...product, minSalePrice: price,
    maxSalePrice: activityPrice(product.maxSalePrice, activity),
    originalPrice: price < Number(product.minSalePrice) ? Number(product.minSalePrice) : 0 };
}

module.exports = { readActivity, saveActivity, activityPrice, activityProduct };
