// @ts-nocheck

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

function searchTerms(keyword) {
  // Search characters independently; punctuation is never a regular expression.
  return [...new Set(Array.from(normalize(keyword)).filter((character) => /[\p{L}\p{N}]/u.test(character)))];
}

function matchesProductSearch(product, skus, categories, terms) {
  if (!terms.length) return false;
  const fields = [product.title, product.name, product.etitle];
  for (const id of product.categoryIds || []) {
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
  // Any one character in any searchable field is enough.
  return terms.some((term) => texts.some((text) => text.includes(term)));
}

module.exports = { searchTerms, matchesProductSearch };
