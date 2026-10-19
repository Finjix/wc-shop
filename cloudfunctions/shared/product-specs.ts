// @ts-nocheck

function skuBelongsToProduct(product, sku) {
  if (sku.deletedByAdmin) return false;
  if (!Array.isArray(product?.specList)) return true;
  const groups = product.specList;
  const info = Array.isArray(sku.specInfo) ? sku.specInfo : [];
  // Old single-level products used the SKU ID as the option ID.
  if (groups.length === 1 && [sku._id, sku.skuId].filter(Boolean).some((id) =>
    (groups[0].specValueList || []).some((value) => String(value.specValueId) === String(id)))) return true;
  return groups.length > 0 && info.length <= groups.length && groups.every((group) => {
    const entry = info.find((value) => String(value.specId) === String(group.specId));
    if (!entry) return group.optional === true;
    return entry && (group.specValueList || []).some((value) => String(value.specValueId) === String(entry.specValueId));
  }) && info.every((entry) => groups.some((group) => String(group.specId) === String(entry.specId)));
}

module.exports = { skuBelongsToProduct };
