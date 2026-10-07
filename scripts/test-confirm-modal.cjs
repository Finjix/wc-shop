const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

let modal;
const exportsObject = {};
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../utils/confirm-modal.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(source, { exports: exportsObject, wx: { showModal(options) { modal = options; } } });
let success;
let complete;
exportsObject.showConfirmModal({
  confirmText: '删除', cancelText: '取消', confirmColor: '#695941', cancelColor: '#000000',
  success: (result) => { success = result; },
  complete: (result) => { complete = result; },
});
assert.equal(modal.cancelText, '确定', 'the native left button must display the confirm action');
assert.equal(modal.confirmText, '取消', 'the native right button must display cancel');
assert.equal(modal.cancelColor, '#695941');
for (const leftClicked of [true, false]) {
  const result = { confirm: !leftClicked, cancel: leftClicked, errMsg: 'showModal:ok' };
  modal.success(result);
  modal.complete(result);
  assert.equal(success.confirm, leftClicked);
  assert.equal(success.cancel, !leftClicked);
  assert.equal(complete.confirm, leftClicked);
}
const oneButton = { showCancel: false, confirmText: '确定' };
exportsObject.showConfirmModal(oneButton);
assert.equal(modal.showCancel, false);
assert.equal(modal.confirmText, '确定', 'single-button dialogs use the same confirm label');
console.log('PASS native dialogs place confirm left and cancel right without changing callback semantics');
