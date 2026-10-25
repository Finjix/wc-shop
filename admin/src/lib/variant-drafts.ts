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
