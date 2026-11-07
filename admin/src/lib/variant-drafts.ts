export interface VariantDraft {
  localId: string;
  groupId: string;
  skuId?: string;
  name: string;
  secondName: string;
  isSecondary?: boolean;
  price: string;
  skuImage: string;
}

export function emptyVariant(): VariantDraft {
  const localId = crypto.randomUUID();
  return { localId, groupId: localId, name: '', secondName: '', price: '', skuImage: '' };
}

export function groupVariantDrafts(variants: VariantDraft[]) {
  const groups = new Map<string, VariantDraft[]>();
  variants.forEach((variant) => {
    const items = groups.get(variant.groupId) || [];
    items.push(variant);
    groups.set(variant.groupId, items);
  });
  return Array.from(groups, ([id, items]) => ({ id, items, first: items[0] }));
}

/**
 * 其他一级规格已配置的二级规格值，用于新增二级规格时的默认填充。
 *
 * 按首次出现的顺序去重，取第一个已配置二级规格的一级规格作为模板。
 */
export function inheritedSecondaryValues(variants: VariantDraft[], groupId: string): string[] {
  return Array.from(new Set(variants
    .filter((variant) => variant.groupId !== groupId)
    .map((variant) => variant.secondName.trim())
    .filter(Boolean)));
}

/**
 * 二级规格名称预设：鞋码/码数自动填入 35.5 到 44.5，每 0.5 一个。
 */
const SHOE_SIZE_TITLES = ['鞋码', '码数'];

/** 按二级规格名称返回预设的具体值，未命中预设时返回空数组。 */
export function presetSecondaryValues(title: string): string[] {
  if (!SHOE_SIZE_TITLES.includes(title.trim())) return [];
  const values: string[] = [];
  for (let half = 71; half <= 89; half += 1) {
    const size = half / 2;
    values.push(Number.isInteger(size) ? String(size) : size.toFixed(1));
  }
  return values;
}

/**
 * 二级规格名称命中预设时填入预设的具体值，价格和图片沿用该一级规格已有的配置。
 *
 * 已有具体值或名称未命中预设时返回 null，由调用方保留用户当前的输入。
 */
export function fillPresetSecondaryValues(variants: VariantDraft[], groupId: string, title: string): VariantDraft[] | null {
  const preset = presetSecondaryValues(title);
  if (!preset.length) return null;
  const items = variants.filter((variant) => variant.groupId === groupId);
  if (!items.length) return null;
  if (items.some((variant) => variant.secondName.trim())) return null;
  const rest = variants.filter((variant) => variant.groupId !== groupId || variant === items[0]);
  return addSecondaryValues(rest, groupId, preset);
}

/**
 * 批量填入二级规格具体值，价格和图片沿用该一级规格已有的配置。
 *
 * 第一个值填入原有的规格组合，其余复制为新的组合，不复制 SKU 库存标识。
 */
export function addSecondaryValues(variants: VariantDraft[], groupId: string, names: string[]): VariantDraft[] {
  const items = variants.filter((variant) => variant.groupId === groupId);
  if (!items.length) throw new Error('一级规格已移除');
  const wanted = names.map((name) => name.trim()).filter(Boolean);
  if (!wanted.length) throw new Error('请填写二级规格名称');
  if (wanted.some((name) => name.length > 80)) throw new Error('二级规格名称最多 80 个字');
  const replaceBase = items.length === 1 && !items[0].secondName.trim();
  const existingNames = replaceBase ? [] : items.map((item) => item.secondName.trim());
  if (new Set([...existingNames, ...wanted]).size !== existingNames.length + wanted.length) throw new Error('二级规格名称不能重复');
  if (variants.length + wanted.length - (replaceBase ? 1 : 0) > 100) throw new Error('最多添加 100 个规格组合');
  const template = items[0];
  const additions = wanted.map((secondName, index) => ({
    ...template,
    localId: replaceBase && index === 0 ? template.localId : crypto.randomUUID(),
    skuId: replaceBase && index === 0 ? template.skuId : undefined,
    secondName,
    isSecondary: true,
  }));
  const lastIndex = variants.lastIndexOf(items[items.length - 1]);
  return variants.flatMap((variant, index) => [
    ...(replaceBase && variant.groupId === groupId ? [] : [variant]),
    ...(index === lastIndex ? additions : []),
  ]);
}

export function addSecondaryVariants(variants: VariantDraft[], groupId: string, input: string): VariantDraft[] {
  const names = input.split(/[,，、;；\n\r]+/).map((name) => name.trim()).filter(Boolean);
  if (!names.length) throw new Error('请填写二级规格名称，可用逗号或换行分隔多个名称');
  if (names.some((name) => name.length > 80)) throw new Error('二级规格名称最多 80 个字');
  const items = variants.filter((variant) => variant.groupId === groupId);
  if (!items.length) throw new Error('一级规格已移除');
  const replaceBase = items.length === 1 && !items[0].secondName.trim();
  const existingNames = replaceBase ? [] : items.map((item) => item.secondName.trim());
  if (new Set([...existingNames, ...names]).size !== existingNames.length + names.length) throw new Error('二级规格名称不能重复');
  if (variants.length + names.length - (replaceBase ? 1 : 0) > 100) throw new Error('最多添加 100 个规格组合');
  const template = items[0];
  const additions = names.map((secondName, index) => ({
    ...template,
    localId: replaceBase && index === 0 ? template.localId : crypto.randomUUID(),
    skuId: replaceBase && index === 0 ? template.skuId : undefined,
    secondName,
  }));
  const lastIndex = variants.lastIndexOf(items[items.length - 1]);
  return variants.flatMap((variant, index) => [
    ...(replaceBase && variant.groupId === groupId ? [] : [variant]),
    ...(index === lastIndex ? additions : []),
  ]);
}
