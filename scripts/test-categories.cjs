const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const plain = (value) => JSON.parse(JSON.stringify(value));
const transpile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const tick = () => new Promise(setImmediate);

async function testMiniProgram() {
  const normalized = {};
  vm.runInNewContext(transpile('miniprogram/services/good/normalize.ts'), { exports: normalized });
  const records = [
    { _id: 'r1', name: '鞋靴' }, { _id: 'r2', name: '配件', sort: 1 },
    { _id: 's1', name: '皮鞋', parentId: 'r1', image: 'local://banner' },
    { _id: 's2', name: '运动鞋', parentId: 'r1', sort: 1 },
    { _id: 't1', name: '男鞋 / 礼物', parentId: 's1', image: 'cloud://men', sort: 1 },
    { _id: 't2', name: '女鞋', parentId: 's1', image: 'local://women' },
    { _id: 'hidden', name: '隐藏', parentId: 's1', status: 'inactive' },
    { _id: 'orphan', name: '孤立', parentId: 'missing' },
  ];
  const tree = normalized.normalizeCategoryList({ items: records });
  assert.deepEqual(plain(tree.map((item) => item._id)), ['r1', 'r2']);
  assert.deepEqual(plain(tree[0].children[0].children.map((item) => item._id)), ['t2', 't1']);
  const images = {};
  vm.runInNewContext(transpile('miniprogram/services/good/resolveImages.ts'), { exports: images, require: () => ({ resolveImage: async (url) => url ? `resolved:${url}` : '' }) });
  const resolved = await images.resolveCategoryListImages(tree);
  assert.equal(resolved[0].children[0].image, 'resolved:local://banner');
  assert.equal(resolved[0].children[0].children[1].image, 'resolved:cloud://men');
  let definition;
  let fail = false;
  let reads = 0;
  const navigations = [];
  const dependencies = {
    '../../common/services/good/fetchCategoryList': { getCategoryList: async () => { reads++; if (fail) throw new Error('断网'); return resolved; } },
    '../../common/services/good/fetchSearchHistory': { addSearchHistory: async () => {} },
    '../../common/services/utils/api': { getApiErrorMessage: (error) => error.message },
    '../../common/share': { shopShareHandlers: {}, enablePageSharing() {} },
  };
  vm.runInNewContext(transpile('miniprogram/tabs/category/index.ts'), {
    exports: {}, Page(value) { definition = value; }, require: (name) => { assert(dependencies[name], `Unexpected dependency ${name}`); return dependencies[name]; },
    wx: { navigateTo: ({ url }) => navigations.push(url) },
  });
  const page = { ...definition, data: plain(definition.data), setData(patch, callback) { Object.assign(this.data, patch); callback?.(); } };
  await page.loadCategories();
  assert.equal(reads, 1);
  assert.equal(page.data.categorySections[0]._id, 's1');
  page.openCategoryResults({ currentTarget: { dataset: { categoryId: 't1', categoryName: '男鞋 / 礼物' } } });
  page.openCategoryResults({ currentTarget: { dataset: { categoryId: 's1', categoryName: '皮鞋' } } });
  const params = navigations.map((url) => new URL(`https://test${url}`).searchParams);
  assert.equal(params[0].get('categoryId'), 't1');
  assert.equal(params[0].get('categoryName'), '男鞋 / 礼物');
  assert.equal(params[1].get('categoryId'), 's1');
  page.handleCategoryScroll({ detail: { scrollTop: 300 } });
  page.selectParent({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.activeParentIndex, 1);
  assert.equal(page.data.categorySections.length, 0);
  assert.equal(page.data.categoryScrollTop, 0);
  assert.equal(reads, 1, 'switching roots needs no product or category request');
  await page.loadCategories();
  assert.equal(page.data.activeParentIndex, 1, 'refresh preserves selection');
  fail = true;
  await page.loadCategories();
  assert.equal(page.data.categoryError, '断网');
  assert.equal(page.data.categorySections.length, 0);
  fail = false;
  page.retryCategories();
  await tick();
  assert.equal(page.data.categoryError, '');
  const markup = fs.readFileSync('miniprogram/tabs/category/index.wxml', 'utf8');
  assert.match(markup, /wx:for="\{\{categorySections\}\}"/);
  assert.match(markup, /wx:for="\{\{section.children\}\}"/);
  assert.match(markup, /src="\{\{category.image\}\}"/);
  assert.doesNotMatch(markup, /goodsList|goods\.thumb|openGoods/);
}

async function testAdmin() {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let tree;
  let saved = [];
  let id = 0;
  const calls = [];
  const warnings = [];
  const messages = [];
  const element = (type, props) => ({ type, props: props || {} });
  const react = {
    useState(initial) {
      const position = cursor++;
      if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
      return [slots[position], (value) => { slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
    },
    useRef(initial) { const position = cursor++; if (!(position in slots)) slots[position] = { current: initial }; return slots[position]; },
    useEffect(effect, deps) {
      const position = cursor++;
      if (!slots[position] || deps.some((value, index) => slots[position][index] !== value)) { slots[position] = deps; effects.push(effect); }
    },
  };
  const draftImages = { processing: false, select: async () => 'blob:category', images: {
    upload: async (rows) => JSON.parse(JSON.stringify(rows).replaceAll('blob:category', 'category.webp')),
    commit() {},
  } };
  const api = { async call(action, data) {
    calls.push({ action, data: plain(data) });
    if (action === 'categories.list') return { items: plain(saved), total: saved.length };
    if (action === 'categories.save') {
      const parent = saved.find((item) => item._id === data.parentId);
      if (data.parentId) assert(parent, 'parents must be saved before descendants');
      const level = parent ? parent.level + 1 : 1;
      assert(level <= 3);
      if (level === 3) assert(data.image, 'leaf images must be uploaded before saving');
      if (data.id) Object.assign(saved.find((item) => item._id === data.id), data);
      else saved.push({ ...data, _id: `real-${++id}`, level });
      return saved.at(-1);
    }
    if (action === 'categories.reorder') {
      assert(data.ids.every((id) => !id.startsWith('draft-')));
      data.ids.forEach((id, sort) => { saved.find((item) => item._id === id).sort = sort; });
      return {};
    }
    if (action === 'categories.delete') {
      const ids = new Set([data.id]);
      for (let index = 0; index < 3; index++) saved.forEach((item) => { if (ids.has(item.parentId)) ids.add(item._id); });
      saved = saved.filter((item) => !ids.has(item._id));
      return {};
    }
    throw new Error(action);
  } };
  const dependencies = {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
    'react-router-dom': { useBlocker: () => ({ state: 'unblocked' }) },
    '../components/NativeUi': { Button: 'Button', Input: 'Input', MessagePlugin: { warning: (value) => warnings.push(value), error: (value) => messages.push(value), success() {} } },
    '../components/Icons': {}, '../lib/api': { adminApi: api }, '../lib/image-upload': { IMAGE_ACCEPT: 'image/*' },
    '../lib/useDraftImages': { useDraftImages: () => draftImages }, '../lib/useBrowserLeaveWarning': { useBrowserLeaveWarning() {} },
    '../components/ConfirmProvider': { useConfirm: () => async () => true },
    '../components/Ui': { ErrorState: 'ErrorState', LoadingState: 'LoadingState', Panel: 'Panel' },
  };
  const exports = {};
  vm.runInNewContext(transpile('admin/src/pages/CategoriesPage.tsx'), { exports, require: (name) => { assert(dependencies[name], name); return dependencies[name]; }, console });
  function render() {
    cursor = 0;
    tree = exports.CategoriesPage();
    while (effects.length) effects.shift()();
  }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((item) => nodes(item));
    return [node, ...nodes(node.props?.children)];
  }
  function text(node) {
    if (node == null) return '';
    if (Array.isArray(node)) return node.map(text).join('');
    return typeof node === 'object' ? text(node.props?.children) : String(node);
  }
  const find = (predicate) => { const node = nodes(tree).find(predicate); assert(node, 'UI element not found'); return node; };
  const button = (label) => find((node) => node.type === 'Button' && text(node) === label);
  const input = (label) => find((node) => node.type === 'Input' && node.props['aria-label'] === label);
  async function create(level, name) {
    input(`${level}级类别名称`).props.onChange(name); render();
    button(`新增${level}级类别`).props.onClick(); render();
  }
  render(); await tick(); render();
  assert.equal(input('一级类别名称').props.maxlength, 5);
  assert.equal(input('二级类别名称').props.maxlength, 5);
  assert.equal(input('三级类别名称').props.maxlength, 5);
  for (const level of ['一', '二', '三']) assert.equal(input(`${level}级类别名称`).props.showLimitNumber, true);
  await create('一', '名'.repeat(6));
  assert(warnings.some((message) => /一级类别名称最多 5 个字/.test(message)));
  assert(!nodes(tree).some((node) => node.props['aria-label'] === `删除 ${'名'.repeat(6)}`));
  await create('一', '鞋靴');
  button('保存更改').props.onClick(); await tick(); render();
  assert(warnings.some((message) => /鞋靴.*至少包含一个三级类别/.test(message)), 'a root without third-level descendants cannot be saved');
  await create('二', '名'.repeat(6));
  assert(warnings.some((message) => /二级类别名称最多 5 个字/.test(message)));
  await create('二', '皮鞋');
  const warningCount = warnings.length;
  button('保存更改').props.onClick(); await tick(); render();
  assert.equal(warnings.length, warningCount + 1, 'a two-level-only branch cannot be saved');
  await create('三', '名'.repeat(6));
  assert(warnings.some((message) => /三级类别名称最多 5 个字/.test(message)));
  await create('三', '男鞋');
  assert.equal(calls.filter((item) => item.action === 'categories.save').length, 0, 'draft edits must not save immediately');
  await button('保存更改').props.onClick(); await tick(); render();
  assert(warnings.some((message) => /男鞋.*图片/.test(message)), 'saving a leaf without an image must be blocked');
  const upload = find((node) => node.type === 'Button' && node.props['aria-label'] === '上传 男鞋 的类别图片');
  upload.props.onClick();
  find((node) => node.type === 'input' && node.props['aria-label'] === '选择类别图片').props.onChange({ target: { files: [{}], value: 'file' } });
  await tick(); render();
  button('保存更改').props.onClick(); await tick(); await tick(); render();
  assert.deepEqual(saved.map((row) => [row.level, row.name, row.parentId || null, row.image]), [
    [1, '鞋靴', null, ''], [2, '皮鞋', 'real-1', ''], [3, '男鞋', 'real-2', 'category.webp'],
  ]);
  assert.equal(messages.length, 0, messages.join('\n'));
  assert.equal(button('保存更改').props.disabled, true);
  for (const [name, max] of [['鞋靴', 5], ['皮鞋', 5], ['男鞋', 5]]) {
    find((node) => node.type === 'Button' && node.props['aria-label'] === `改名 ${name}`).props.onClick(); render();
    assert.equal(input(`分类名称 ${name}`).props.maxlength, max);
    assert.equal(input(`分类名称 ${name}`).props.showLimitNumber, true);
    input(`分类名称 ${name}`).props.onChange('名'.repeat(max + 1)); render();
    input(`分类名称 ${name}`).props.onBlur(); render();
    assert(warnings.some((message) => message === `分类名称最多 ${max} 个字，已保留原名称`));
    assert.equal(button('保存更改').props.disabled, true, 'invalid rename preserves the saved name');
  }
  await create('二', '运动鞋');
  button('保存更改').props.onClick(); await tick(); render();
  assert(warnings.some((message) => /运动鞋.*至少包含一个三级类别/.test(message)), 'every second-level group requires a leaf, even when a sibling group has one');
  assert.equal(saved.length, 3, 'invalid branches must not trigger partial saves');
  await find((node) => node.type === 'Button' && node.props['aria-label'] === '删除 运动鞋').props.onClick();
  await tick(); render();
  await find((node) => node.type === 'Button' && node.props['aria-label'] === '删除 男鞋').props.onClick();
  await tick(); render();
  const deletesBefore = calls.filter((entry) => entry.action === 'categories.delete').length;
  button('保存更改').props.onClick(); await tick(); render();
  assert.equal(calls.filter((entry) => entry.action === 'categories.delete').length, deletesBefore, 'deleting the final leaf cannot leave empty ancestors saved');
  assert.equal(saved.length, 3);
  await find((node) => node.type === 'Button' && node.props['aria-label'] === '删除 鞋靴').props.onClick();
  await tick(); render();
  assert.equal(saved.length, 3, 'deletions stay in draft until save');
  button('保存更改').props.onClick(); await tick(); await tick(); render();
  assert.equal(saved.length, 0);
  assert.deepEqual(calls.filter((entry) => entry.action === 'categories.delete').map((entry) => entry.data.id), ['real-1'], 'delete root once and cascade all descendants');
}

(async () => {
  await testMiniProgram();
  await testAdmin();
  console.log('PASS categories: three-level tree/images, category-only page, search links, selection/error states; admin draft save order, required image, mandatory third-level descendants, real-ID mapping and full cascade deletion');
})().catch((error) => { console.error(error); process.exitCode = 1; });
