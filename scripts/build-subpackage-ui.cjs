const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'miniprogram_npm/tdesign-miniprogram');
const groups = {
  'form-ui': ['upload', 'input', 'textarea', 'cascader', 'switch', 'radio', 'radio-group', 'tabs', 'tab-panel', 'sticky', 'mixins/page-scroll.js', 'mixins/touch.js'],
  'order-ui': ['steps', 'step-item', 'pull-down-refresh', 'swipe-cell', 'divider', 'grid', 'grid-item'],
};

// 从微信工具构建的 npm 产物生成组件分包。共用基础组件、工具及样式继续引用主包。
function build() {
  if (!fs.existsSync(sourceRoot)) throw new Error('请先在微信开发者工具执行「工具 → 构建 npm」');
  for (const [name, families] of Object.entries(groups)) {
    const targetRoot = path.join(root, 'packages', name, 'tdesign');
    if (fs.existsSync(targetRoot)) {
      for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || families.includes(entry.name) || !Object.values(groups).flat().includes(entry.name)) continue;
        const obsolete = path.resolve(targetRoot, entry.name);
        if (!obsolete.startsWith(targetRoot + path.sep)) throw new Error(`Invalid cleanup path: ${obsolete}`);
        fs.rmSync(obsolete, { recursive: true });
      }
    }
    let bytes = 0;
    function relocate(original) {
      const relative = path.relative(sourceRoot, original);
      const family = relative.split(path.sep)[0];
      const module = relative.replaceAll('\\', '/');
      return families.includes(family) || families.includes(`${module}.js`) || families.includes(module) ? path.join(targetRoot, relative) : original;
    }
    function copy(directory, onlyFile) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (onlyFile && entry.name !== onlyFile) continue;
        const source = path.join(directory, entry.name);
        if (entry.isDirectory()) { copy(source); continue; }
        if (!/\.(js|json|wxml|wxss|wxs)$/.test(entry.name)) continue;
        const target = relocate(source);
        if (!target.startsWith(targetRoot + path.sep)) throw new Error(`Invalid output path: ${target}`);
        let text = fs.readFileSync(source, 'utf8');
        text = text.replace(/(['"])(\.{1,2}\/[^'"\s]+)\1/g, (match, quote, reference) => {
          const dependency = path.resolve(path.dirname(source), reference);
          const relocated = relocate(dependency);
          let next = path.relative(path.dirname(target), relocated).replaceAll('\\', '/');
          if (!next.startsWith('.')) next = `./${next}`;
          return `${quote}${next}${quote}`;
        });
        // 保持 TDesign 原来对内嵌 tslib 的解析，避免迁移后误用主包另一份 tslib。
        const tslib = path.relative(path.dirname(target), path.join(sourceRoot, 'miniprogram_npm/tslib/index.js')).replaceAll('\\', '/');
        text = text.replace(/(['"])tslib\1/g, `$1${tslib}$1`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
        bytes += Buffer.byteLength(text);
      }
    }
    families.forEach((family) => {
      const source = path.join(sourceRoot, family);
      if (fs.statSync(source).isDirectory()) copy(source);
      else copy(path.dirname(source), path.basename(source));
    });
    const license = path.join(root, 'node_modules/tdesign-miniprogram/LICENSE');
    fs.copyFileSync(license, path.join(targetRoot, 'LICENSE'));
    console.log(`${name}: ${(bytes / 1024).toFixed(1)} KB generated`);
  }
}

if (require.main === module) build();
module.exports = { groups, build };
