const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  if (['tdesign', 'miniprogram_npm'].includes(entry.name)) return [];
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : file.endsWith('.wxss') ? [file] : [];
});
const beige = /#(?:fcf8ee|f7f4ef|f0ece3|f0ece4|f5f1eb|f7f6f3|eee7dd)\b|rgba\(105,\s*89,\s*65,\s*0?\.18\)/i;
for (const file of walk(root)) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (relative.startsWith('pages/home/')) continue;
  const css = fs.readFileSync(file, 'utf8');
  for (const match of css.matchAll(/(?:background(?:-color)?|--app-theme-color-soft|--gift-card-cover-background)\s*:[^;{}]+/g)) {
    assert.doesNotMatch(match[0], beige, `${relative}: beige backgrounds are reserved for home`);
  }
}
const result = read('goods/result/index.wxss');
assert.match(result, /\.goods-list-scroll\s*\{[^}]*background:\s*#fff\s*;/);
assert.match(result, /\.goods-list-container\s*\{[^}]*background-color:\s*#fff\s*;/);
assert.match(read('pages/home/home.wxss'), /\.home-scroll-content\s*\{[^}]*--gift-card-cover-background:\s*#f0ece3;[^}]*background:\s*#FCF8EE;/);
assert.match(read('style/gift-card.wxss'), /background:\s*var\(--gift-card-cover-background,\s*#f5f5f5\)/);
assert.match(read('app.wxss'), /--app-theme-color-soft:\s*#f2f2f2/);
assert.match(read('style/theme.wxss'), /--app-theme-color-soft:\s*#f2f2f2/);
console.log('PASS neutral non-home backgrounds: white search results, neutral category/user/review/SKU/address states; home cream and shared card structure preserved');
