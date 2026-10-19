import type { Product, Sku } from '../types';

export function visibleSkus(product: Product, skus: Sku[]) {
  return skus.filter((sku) => {
    if (sku.deletedByAdmin) return false;
    if (!Array.isArray(product.specList)) return true;
    const groups = product.specList as { specId?: string; optional?: boolean; specValueList?: { specValueId?: string }[] }[];
    const info = (sku.specInfo || []) as { specId?: string; specValueId?: string }[];
    if (groups.length === 1 && [sku._id, sku.skuId].filter(Boolean).some((id) =>
      (groups[0].specValueList || []).some((value) => String(value.specValueId) === String(id)))) return true;
    return groups.length > 0 && info.length <= groups.length && groups.every((group) => {
      const entry = info.find((value) => String(value.specId) === String(group.specId));
      if (!entry) return group.optional === true;
      return entry && (group.specValueList || []).some((value) => String(value.specValueId) === String(entry.specValueId));
    }) && info.every((entry) => groups.some((group) => String(group.specId) === String(entry.specId)));
  });
}

export function variantValues(sku: Sku, product: Product) {
  const info = (sku.specInfo || []) as Record<string, unknown>[];
  return ((product.specList || []) as Record<string, unknown>[]).map((group) => {
    const entry = info.find((value) => String(value.specId) === String(group.specId));
    const option = (group.specValueList as Record<string, unknown>[] || []).find((value) =>
      String(value.specValueId) === String(entry?.specValueId) || String(value.specValueId) === String(sku._id || sku.skuId));
    return String(option?.specValue || entry?.specValue || '').trim();
  });
}

export function variantName(sku: Sku, product: Product) {
  const info = Array.isArray(sku.specInfo) ? sku.specInfo : [];
  const groups = Array.isArray(product.specList) ? product.specList as Record<string, unknown>[] : [];
  return info.map((entry) => {
    const value = entry as Record<string, unknown>;
    const group = groups.find((item) => String(item.specId) === String(value.specId));
    const options = Array.isArray(group?.specValueList) ? group.specValueList as Record<string, unknown>[] : [];
    const option = options.find((item) => String(item.specValueId) === String(value.specValueId));
    return String(option?.specValue || value.specValue || value.specValueId || '').trim();
  }).filter(Boolean).join(' / ') || '默认规格';
}

export function variantStock(sku: Sku) {
  const source = sku.stockQuantity;
  const value = Number(source);
  return source !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}
