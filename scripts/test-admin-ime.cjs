const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let slots = [], index = 0;
const exportsObject = {};
const jsx = (type, props) => ({ type, props });
vm.runInNewContext(ts.transpileModule(fs.readFileSync('admin/src/components/NativeUi.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: exportsObject, require(name) {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react') return {
    useId: () => 'count', useEffect() {},
    useRef(value) { const i = index++; return slots[i] ??= { current: value }; },
    useState(value) { const i = index++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = next; }]; },
  };
  return {};
} });
for (const [kind, limit] of [['Input', 16], ['Input', 5], ['Textarea', 100], ['Textarea', 200]]) {
  slots = [];
  let value = '好'.repeat(limit - 1), published = [], entered = 0;
  const render = () => { index = 0; return exportsObject[kind]({ value, maxLength: limit, onChange(next) { value = next; published.push(next); }, onEnter() { entered++; } }).props; };
  let field = render();
  assert.equal(field.maxLength, undefined, 'native maxlength must not truncate IME pre-edit text');
  const element = { value, selectionStart: value.length, type: 'text', setSelectionRange(start) { this.selectionStart = start; } };
  const event = () => ({ currentTarget: element, nativeEvent: { isComposing: true } });
  field.onCompositionStart(event());
  element.value += 'zhongwen';
  field.onChange(event());
  field = render();
  assert.equal(field.value, '好'.repeat(limit - 1) + 'zhongwen', 'long pinyin remains intact');
  assert.equal(published.length, 0, 'pre-edit text never reaches parent normalization');
  if (kind === 'Input') {
    field.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true } });
    assert.equal(entered, 0, 'candidate confirmation must not trigger submit/search');
  }
  element.value = '好'.repeat(limit - 1) + '中文';
  field.onCompositionEnd(event());
  assert.equal(value, '好'.repeat(limit - 1) + '中');
  assert.equal(element.value, value);
  field = render();
  field.onChange({ currentTarget: element, nativeEvent: {} });
  assert.equal(value, '好'.repeat(limit - 1) + '中', 'trailing input event cannot restore unbounded text');
  value = '甲'.repeat(limit - 2) + '尾'; field = render();
  element.value = '甲'.repeat(limit - 2) + '新增内容尾';
  field.onChange({ currentTarget: element, nativeEvent: {} });
  assert.equal(value, '甲'.repeat(limit - 2) + '新尾', 'overflow insertion preserves original suffix');
  value = ''; field = render(); element.value = '😀'.repeat(limit + 1);
  field.onChange({ currentTarget: element, nativeEvent: {} });
  assert.equal(value, '😀'.repeat(kind === 'Input' ? limit : limit / 2), 'preserve complete code points and the field counting contract');
}
console.log('PASS admin IME: 16/5/100/200 limits, long pre-edit, confirmation, trailing events, middle insertion, Unicode and Enter guard');
