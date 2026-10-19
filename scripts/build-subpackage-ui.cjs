const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'miniprogram');
const packages = ['', 'goods', 'order', 'user', 'services', 'utils'];
const sourceRoot = [path.join(miniRoot, 'miniprogram_npm/tdesign-miniprogram'), path.join(root, 'miniprogram_npm/tdesign-miniprogram')].find(fs.existsSync);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const slash = value => value.replaceAll('\\', '/');
const packageOf = file => packages.slice(1).find(p => file.startsWith(path.join(miniRoot, p) + path.sep)) || '';
const generated = file => /[\\/]components[\\/]tdesign[\\/]|[\\/]miniprogram_npm[\\/]/.test(file);
function resolveSource(from, ref) {
  const base = ref.startsWith('.') ? path.resolve(path.dirname(from), ref) : path.join(sourceRoot, 'miniprogram_npm', ref);
  return ['', '.js', '.json', '.wxs', '.wxss', '.wxml', '/index.js'].map(ext => base + ext)
    .find(file => file.startsWith(sourceRoot + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile());
}
function build() {
  if (!sourceRoot) throw new Error('请先在微信开发者工具执行「工具 → 构建 npm」');
  const files = walk(miniRoot).filter(file => !generated(file) && /\.(ts|js|json|wxml|wxss|wxs)$/.test(file));
  const families = new Map(packages.map(p => [p, new Set()]));
  const uiRef = /(["'])([^"'\s]*\/tdesign\/([^/'"]+)[^"'\s]*)\1/g;
  for (const file of files) for (const match of fs.readFileSync(file, 'utf8').matchAll(uiRef)) families.get(packageOf(file)).add(match[3]);
  for (const set of families.values()) {
    for (const family of set) {
      const dir = path.join(sourceRoot, family);
      if (!fs.existsSync(dir)) throw new Error(`Missing TDesign family: ${family}`);
      for (const file of walk(dir).filter(f => /\.(js|json|wxss|wxml|wxs)$/.test(f))) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/(["'])(\.{1,2}\/[^"'\s]+|tslib|(?:tinycolor2|dayjs)(?:\/[^"'\s]*)?)\1/g)) {
          const dependency = resolveSource(file, match[2]);
          if (dependency) set.add(path.relative(sourceRoot, dependency).split(path.sep)[0]);
        }
      }
    }
  }
  function uiTarget(pack, relative) {
    const family = relative.split(/[\\/]/)[0];
    return path.join(miniRoot, families.get('').has(family) ? '' : pack, 'components/tdesign', relative);
  }
  // Put only main-package dependencies in shared components; other UI stays in its business package.
  for (const file of files) {
    const pack = packageOf(file);
    const source = fs.readFileSync(file, 'utf8');
    const next = source.replace(uiRef, (match, quote, ref) => {
      const relative = ref.split('/tdesign/')[1];
      const target = uiTarget(pack, relative);
      const next = ref.startsWith('/') ? '/' + slash(path.relative(miniRoot, target)) : slash(path.relative(path.dirname(file), target));
      return quote + (ref.startsWith('/') || next.startsWith('.') ? next : './' + next) + quote;
    });
    if (next !== source) fs.writeFileSync(file, next);
  }
  const outputs = new Set();
  for (const [pack, set] of families) {
    let count = 0;
    for (const family of set) {
      if (pack && families.get('').has(family)) continue;
      for (const file of walk(path.join(sourceRoot, family)).filter(f => /\.(js|json|wxss|wxml|wxs)$/.test(f))) {
        const target = uiTarget(pack, path.relative(sourceRoot, file));
        let source = fs.readFileSync(file, 'utf8');
        source = source.replace(/(["'])(\.{1,2}\/[^"'\s]+|tslib|(?:tinycolor2|dayjs)(?:\/[^"'\s]*)?)\1/g, (match, quote, ref) => {
          const dependency = resolveSource(file, ref);
          if (!dependency) return match;
          let dep = uiTarget(pack, path.relative(sourceRoot, dependency));
          if (!path.extname(ref)) dep = dep.slice(0, -path.extname(dep).length);
          let next = slash(path.relative(path.dirname(target), dep));
          if (!next.startsWith('.')) next = './' + next;
          return quote + next + quote;
        });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, source);
        outputs.add(target);
        count++;
      }
    }
    console.log(`${pack || 'main'}: generated ${count} TDesign files`);
  }
  // Compute dependencies per file, so subpackage-only mixins do not stay in shared common/.
  const references = /(["'])(\.{1,2}\/[^"'\s]+|\/[^"'\s]+)\1/g;
  function dependencies(file, ref) {
    const base = ref.startsWith('/') ? path.join(miniRoot, ref) : path.resolve(path.dirname(file), ref);
    return ['', '.js', '.json', '.wxs', '.wxss', '.wxml'].map(ext => base + ext).filter(target => outputs.has(target));
  }
  const uses = new Map();
  for (const pack of packages) {
    const set = new Set();
    const queue = files.filter(file => packageOf(file) === pack);
    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      for (const match of fs.readFileSync(file, 'utf8').matchAll(references)) {
        for (const target of dependencies(file, match[2])) if (!set.has(target)) { set.add(target); queue.push(target); }
      }
    }
    uses.set(pack, set);
  }
  const originalOutput = new Map([...outputs].map(file => [file, fs.readFileSync(file, 'utf8')]));
  function finalTarget(file, pack) {
    const relative = slash(file).split('/components/tdesign/')[1];
    return path.join(miniRoot, uses.get('').has(file) ? '' : pack, 'components/tdesign', relative);
  }
  function rebase(source, from, to, pack) {
    return source.replace(references, (match, quote, ref) => {
      const dependency = dependencies(from, ref)[0];
      if (!dependency) return match;
      let target = finalTarget(dependency, pack);
      if (!path.extname(ref)) target = target.slice(0, -path.extname(target).length);
      let next = ref.startsWith('/') ? '/' + slash(path.relative(miniRoot, target)) : slash(path.relative(path.dirname(to), target));
      if (!next.startsWith('/') && !next.startsWith('.')) next = './' + next;
      return quote + next + quote;
    });
  }
  const finalOutput = new Map();
  for (const [pack, set] of uses) for (const file of set) {
    const target = finalTarget(file, pack);
    finalOutput.set(target, rebase(originalOutput.get(file), file, target, pack));
  }
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const next = rebase(source, file, file, packageOf(file));
    if (next !== source) fs.writeFileSync(file, next);
  }
  for (const [file, source] of finalOutput) {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  }
  // Prune stale and unused generated files when components move between packages.
  for (const pack of packages) {
    const dir = path.join(miniRoot, pack, 'components/tdesign');
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) if (!finalOutput.has(file) && path.basename(file) !== 'LICENSE') fs.unlinkSync(file);
    fs.copyFileSync(path.join(root, 'node_modules/tdesign-miniprogram/LICENSE'), path.join(dir, 'LICENSE'));
  }
}
if (require.main === module) build();
module.exports = { build };
