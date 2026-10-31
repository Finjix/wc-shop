const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const repoRoot = path.resolve(__dirname, '..');
const root = path.join(repoRoot, 'miniprogram');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
function check() {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.deepEqual(app.subpackages.map(p => p.root), ['components', 'pages', 'services', 'utils']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repoRoot, 'project.config.json'), 'utf8')).miniprogramRoot, 'miniprogram/');
  assert.deepEqual(app.pages, ['tabs/home/home', 'tabs/category/index', 'tabs/cart/index', 'tabs/usercenter/index']);
  assert.deepEqual(app.tabBar.list.map(p => p.pagePath), app.pages);
  for (const oldRoot of ['goods', 'order', 'user']) assert.ok(!fs.existsSync(path.join(root, oldRoot)), `${oldRoot}: retired package directory`);
  assert.deepEqual(app.subpackages.find(p => p.root === 'components').pages, []);
  assert.equal(app.subpackages.find(p => p.root === 'pages').pages.length, 19);
  assert.ok(!fs.existsSync(path.join(root, 'common/ui/control.ts')), 'component-only controller must not ship in main');
  assert.ok(!fs.existsSync(path.join(root, 'style/native-ui.wxss')), 'component-only stylesheet must not ship in main');
  const packOf = file => app.subpackages.find(p => file.startsWith(path.join(root, p.root) + path.sep))?.root || 'main';
  function resolve(file, ref) {
    const target = ref.startsWith('/') ? path.join(root, ref) : ref.startsWith('.') || /\.(wxss|wxml)$/.test(file) ? path.resolve(path.dirname(file), ref)
      : path.join(root, 'miniprogram_npm', ref);
    const found = ['', '.ts', '.js', '.json', '.wxml', '.wxss', '.wxs'].map(ext => target + ext).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    assert.ok(found, `${path.relative(root, file)}: unresolved ${ref}`);
    assert.ok(!found.startsWith(path.join(root, 'miniprogram_npm') + path.sep), `${file}: runtime depends on excluded npm generation source`);
    return found;
  }
  let asyncReferences = 0;
  let asyncComponents = 0;
  let modules = 0;
  const mainDependencies = new Map();
  const sourceFiles = walk(root).filter(file => !file.includes(`${path.sep}miniprogram_npm${path.sep}`));
  for (const file of sourceFiles) {
    if (!/\.(ts|js|json|wxml|wxss|wxs)$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /['"`]\/(?:goods|order|user)\//, `${file}: retired absolute route`);
    assert.doesNotMatch(source, /['"`]\/?pages\/(?:home|category|cart|usercenter)\//, `${file}: retired tab route`);
    if (/\.(ts|js)$/.test(file)) {
      const dependencies = [];
      mainDependencies.set(file, dependencies);
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      assert.equal(parsed.parseDiagnostics.length, 0, `${file}: syntax error`);
      function dependency(ref, async) {
        const target = resolve(file, ref);
        const targetPack = packOf(target);
        if (!async && targetPack === 'main') dependencies.push(target);
        assert.ok(async || targetPack === 'main' || targetPack === packOf(file), `${path.relative(root, file)}: synchronous cross-package import ${ref}`);
        if (async) asyncReferences++;
        modules++;
      }
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && !node.importClause?.isTypeOnly && !node.isTypeOnly) dependency(node.moduleSpecifier.text, false);
        if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          if (ts.isIdentifier(node.expression) && node.expression.text === 'require') dependency(node.arguments[0].text, false);
          if (ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(parsed) === 'require' && node.expression.name.text === 'async') dependency(node.arguments[0].text, true);
        }
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      if (packOf(file) === 'services') assert.doesNotMatch(source, /getCurrentPages\s*\(|\b(?:Page|Component)\s*\(/, `${file}: UI logic in services`);
    }
    if (file.endsWith('.json')) {
      const json = JSON.parse(source);
      const dependencies = [];
      mainDependencies.set(file, dependencies);
      for (const alias of Object.keys(json.componentPlaceholder || {})) assert.ok(json.usingComponents?.[alias], `${file}: placeholder without a component: ${alias}`);
      for (const [alias, ref] of Object.entries(json.usingComponents || {})) {
        const target = resolve(file, ref);
        if (packOf(target) === 'main') dependencies.push(target, target.replace(/\.json$/, '.ts'));
        if (packOf(target) !== 'main' && packOf(target) !== packOf(file)) {
          assert.ok(json.componentPlaceholder?.[alias], `${file}: missing async placeholder for ${alias}`);
          asyncReferences++;
          asyncComponents++;
        }
      }
    }
    if (/\.(wxss|wxml)$/.test(file)) {
      const refs = [...source.matchAll(/@import\s+['"]([^'"]+)['"]/g), ...source.matchAll(/<(?:import|include|wxs)\b[^>]*\bsrc=['"]([^'"]+)['"]/g)];
      for (const match of refs) {
        if (match[1].includes('{{')) continue;
        const target = resolve(file, match[1]);
        assert.ok(packOf(target) === 'main' || packOf(target) === packOf(file), `${file}: cross-package stylesheet/template`);
      }
    }
  }
  const reachable = new Set();
  const pending = ['app.ts', 'custom-tab-bar/index.ts', 'custom-tab-bar/index.json', ...app.pages.flatMap(p => [p + '.ts', p + '.json'])].map(p => path.join(root, p));
  while (pending.length) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    pending.push(...(mainDependencies.get(file) || []));
  }
  for (const file of mainDependencies.keys()) {
    if (packOf(file) === 'main' && /\.(ts|js)$/.test(file) && !file.endsWith('.d.ts')) assert.ok(reachable.has(file), `${path.relative(root, file)}: unused by main; move into its consuming package`);
  }
  for (const p of [...app.pages, ...app.subpackages.flatMap(pack => pack.pages.map(p => `${pack.root}/${p}`))]) {
    for (const ext of ['.ts','.json','.wxml']) assert.ok(fs.existsSync(path.join(root, p + ext)), `${p}: missing ${ext}`);
  }
  for (const page of app.pages) {
    const source = fs.readFileSync(path.join(root, page + '.ts'), 'utf8');
    assert.match(source, /\bPage\s*\(/, `${page}: tabs must run directly in main`);
    assert.doesNotMatch(source, /tabContent|createTabPage|loadFrontend/);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(root, page + '.json'), 'utf8')).component);
  }
  const include = JSON.parse(fs.readFileSync(path.join(repoRoot, 'project.config.json'), 'utf8')).packOptions.include;
  assert.ok(include.some(p => p.value === 'utils/image-processor/codec/webp_enc.wasm'));
  assert.ok(fs.existsSync(path.join(root, 'utils/image-processor/codec/webp_enc.wasm')));
  assert.equal(asyncReferences, asyncComponents + 1, 'all cross-package components plus the shared services entry load asynchronously');
  assert.ok(asyncComponents > 0);
  // Small synchronous helpers need a local copy across package boundaries, but
  // those copies must not drift. Service implementations and state stay unique.
  const componentShared = path.join(root, 'components/_shared');
  for (const file of walk(componentShared)) {
    const counterpart = path.join(root, 'pages/_shared', path.relative(componentShared, file));
    if (!fs.existsSync(counterpart)) continue;
    const normalize = filename => fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n').trim();
    assert.equal(normalize(file), normalize(counterpart), `${path.relative(root, file)}: shared package copies diverged`);
  }
  const orderView = JSON.parse(fs.readFileSync(path.join(root, 'components/order/order-list-view/index.json'), 'utf8'));
  for (const ref of Object.values(orderView.usingComponents)) assert.ok(ref.startsWith('/components/'), 'slotted order view must compose synchronously within components');
  console.log(`PASS main + components/pages/services/utils graph: ${modules} module dependencies, ${asyncReferences} async references and all page/template/style paths`);
}
if (require.main === module) check();
module.exports = { check };
