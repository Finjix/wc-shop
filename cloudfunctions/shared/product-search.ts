// @ts-nocheck

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function searchTerms(keyword) {
  const text = normalize(keyword);
  // Chinese words as well as whitespace-separated/English words. Punctuation
  // separates terms rather than acting as a regular expression.
  if (typeof Intl.Segmenter === 'function') {
    return [...new Set(Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text))
      .filter((part) => part.isWordLike).map((part) => part.segment))];
  }
  return [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
}

function matchesProductSearch(product, skus, categories, terms) {
  if (!terms.length) return false;
  const fields = [product.title, product.etitle];
  for (const id of [...(product.categoryIds || []), product.categoryId].filter(Boolean)) {
    let category = categories.get(String(id));
    const visited = new Set();
    while (category && !visited.has(String(category._id))) {
      visited.add(String(category._id));
      if (category.status === 'active') fields.push(category.name);
      category = categories.get(String(category.parentId || ''));
    }
  }
  for (const group of product.specList || []) {
    for (const value of group.specValueList || []) fields.push(value.specValue, value.specValueName, value.name);
  }
  for (const sku of skus) {
    for (const spec of sku.specInfo || []) fields.push(spec.specValue, spec.specValueName, spec.value, spec.valueName);
  }
  const texts = fields.filter((field) => typeof field === 'string').map(normalize);
  // Each term must match, but different terms may match different fields.
  return terms.every((term) => texts.some((text) => text.includes(term)));
}

module.exports = { searchTerms, matchesProductSearch };
