const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'miniprogram_npm/tdesign-miniprogram');
const targetRoot = path.join(root, 'packages/frontend/tdesign');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function buildMainIcon() {
  const targetRoot = path.join(root, 'main-ui/tdesign');
  const queue = ['icon/icon.js', 'icon/icon.json', 'icon/icon.wxml', 'icon/icon.wxss'];
  const copied = new Set();
  function dependency(from, ref) {
    let base;
    if (ref === 'tslib') base = path.join(sourceRoot, 'miniprogram_npm/tslib/index');
    else if (ref.startsWith('.')) base = path.resolve(path.dirname(from), ref);
    else return;
    const file = ['', '.js', '.json', '.wxs', '.wxss', '.wxml'].map(ext => base + ext).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (!file || !file.startsWith(sourceRoot + path.sep)) return;
    const relative = path.relative(sourceRoot, file);
    queue.push(relative);
    return relative;
  }
  for (let i = 0; i < queue.length; i++) {
    const relative = queue[i];
    if (copied.has(relative)) continue;
    copied.add(relative);
    const source = path.join(sourceRoot, relative);
    const target = path.join(targetRoot, relative);
    let text = fs.readFileSync(source, 'utf8');
    text = text.replace(/(['"])(\.{1,2}\/[^'"\s]+|tslib)\1/g, (match, quote, ref) => {
      const dep = dependency(source, ref);
      if (!dep || ref !== 'tslib') return match;
      let next = path.relative(path.dirname(target), path.join(targetRoot, dep)).replaceAll('\\', '/');
      if (!next.startsWith('.')) next = './' + next;
      return quote + next + quote;
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  fs.copyFileSync(path.join(root, 'node_modules/tdesign-miniprogram/LICENSE'), path.join(targetRoot, 'LICENSE'));
  console.log(`main: generated ${copied.size} files for the tabBar icon dependency closure`);
}
function build() {
  if (!fs.existsSync(sourceRoot)) throw new Error('请先在微信开发者工具执行「工具 → 构建 npm」');
  const families = new Set(['miniprogram_npm']);
  for (const file of walk(path.join(root, 'packages/frontend')).filter(f => !f.startsWith(targetRoot + path.sep) && /\.(ts|js|json|wxss|wxml)$/.test(f))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/(['"])([^'"\s]*\/tdesign\/([^/'"]+)[^'"\s]*)\1/g)) families.add(match[3]);
  }
  for (const family of families) {
    const dir = path.join(sourceRoot, family);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Missing TDesign family: ${family}`);
    for (const file of walk(dir)) {
      if (!/\.(js|json|wxml|wxss|wxs)$/.test(file)) continue;
      let text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(['"])(\.{1,2}\/[^'"\s]+)\1/g)) {
        const dependency = path.resolve(path.dirname(file), match[2]);
        if (dependency.startsWith(sourceRoot + path.sep)) families.add(path.relative(sourceRoot, dependency).split(path.sep)[0]);
      }
      const target = path.join(targetRoot, path.relative(sourceRoot, file));
      const tslib = path.relative(path.dirname(target), path.join(targetRoot, 'miniprogram_npm/tslib/index.js')).replaceAll('\\', '/');
      text = text.replace(/(['"])tslib\1/g, `$1${tslib}$1`);
      text = text.replace(/(['"])((?:tinycolor2|dayjs)(?:\/[^'"]*)?)\1/g, (match, quote, ref) => {
        let dependency = path.join(targetRoot, 'miniprogram_npm', ref);
        if (fs.existsSync(path.join(sourceRoot, 'miniprogram_npm', ref, 'index.js'))) dependency = path.join(dependency, 'index');
        let next = path.relative(path.dirname(target), dependency).replaceAll('\\', '/');
        if (!next.startsWith('.')) next = './' + next;
        return quote + next + quote;
      });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    }
  }
  fs.copyFileSync(path.join(root, 'node_modules/tdesign-miniprogram/LICENSE'), path.join(targetRoot, 'LICENSE'));
  console.log(`frontend: generated ${families.size} TDesign component/dependency families`);
  buildMainIcon();
}
if (require.main === module) build();
module.exports = { build };
