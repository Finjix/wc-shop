// @ts-nocheck

const categoryId = (item) => String(item?._id || item?.id || '');

function categoryLevel(item, byId) {
  const visited = new Set();
  let level = 0;
  while (item) {
    const id = categoryId(item);
    if (!id || visited.has(id) || item.status !== 'active' || ++level > 3) return 0;
    visited.add(id);
    if (!item.parentId) return level;
    item = byId.get(String(item.parentId));
  }
  return 0;
}

function descendantIds(items, id) {
  const ids = new Set([String(id)]);
  const children = new Map();
  for (const item of items) {
    const parentId = String(item.parentId || '');
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(categoryId(item));
  }
  const pending = [...ids];
  for (let index = 0; index < pending.length; index += 1) {
    for (const childId of children.get(pending[index]) || []) {
      if (!ids.has(childId)) { ids.add(childId); pending.push(childId); }
    }
  }
  return [...ids];
}

module.exports = { categoryId, categoryLevel, descendantIds };
