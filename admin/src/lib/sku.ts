import type { Product, Sku } from '../types';

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
  const stockInfo = sku.stockInfo as { stockQuantity?: unknown } | undefined;
  const source = sku.stockQuantity ?? sku.stock ?? stockInfo?.stockQuantity;
  const value = Number(source);
  return source !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}
