const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let page, component;
const jumps = [], routes = [], modals = [], clipboard = [];
const pageContext = {};
const dialogApi = { default: { alert: (options) => { modals.push(options); return Promise.resolve(); } } };
const wx = {
  navigateToMiniProgram: (options) => jumps.push(options),
  navigateTo: (options) => routes.push(options),
  showModal: () => { throw new Error('logistics errors must use the app dialog'); },
  setClipboardData: (options) => clipboard.push(options),
};
function load(relative) {
  const filename = path.resolve(root, relative);
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, wx, console, getCurrentPages: () => [pageContext],
    Page: (value) => { page = value; },
    Component: (value) => { component = value; },
    require: (name) => name === './dialog' ? dialogApi : name.endsWith('/utils/logistics') ? logisticsApi : {},
  }, { filename });
  return exports;
}
const logisticsApi = load('miniprogram/order/utils/logistics.ts');
const { openLogistics } = logisticsApi;

const shipment = {
  logisticsNo: ' SF123&?#中文 ', logisticsCompanyName: '顺丰', logisticsCompanyCode: 'SF',
  receiverPhone: '13800000000', receiverName: '收件人', receiverAddress: '收货地址',
};
openLogistics(shipment);
assert.equal(jumps[0].appId, 'wx6885acbedba59c14');
assert.equal(jumps[0].envVersion, 'release');
const query = new URLSearchParams(jumps[0].path.split('?').slice(1).join('?'));
assert.equal(query.get('nu'), shipment.logisticsNo.trim());
assert.equal(query.get('querysource'), 'third_xcx');
assert.deepEqual([...query.keys()], ['nu', 'querysource'], 'send only the tracking number and source');
assert.equal(routes.length, 0, 'the click opens the destination directly');
assert.equal(modals.length, 0, 'no extra confirmation before the platform jump');
jumps[0].fail({ errMsg: 'navigateToMiniProgram:fail cancel' });
assert.equal(routes.length, 0, 'cancel stays on the current page');
assert.equal(modals.length, 0, 'user cancellation is not an error');
jumps[0].fail({ errMsg: 'navigateToMiniProgram:fail unavailable' });
assert.equal(routes.length, 0, 'failure must not open another local page');
assert.equal(modals.length, 1);
assert.equal(modals[0].title, '物流查询失败');
assert.equal(Object.hasOwn(modals[0], 'content'), false, 'app error dialog shows only the title');
assert.equal(modals[0].confirmBtn, '确认');
assert.equal(modals[0].context, pageContext, 'errors use the current page dialog, including component entry points');

for (const key of ['trackingNo', 'trackingNumber']) {
  openLogistics({ [key]: 'TRACK-ALIAS' });
  assert.match(jumps.at(-1).path, /nu=TRACK-ALIAS&/);
}
const beforeMissing = jumps.length;
openLogistics({ logisticsNo: '  ' });
assert.equal(jumps.length, beforeMissing);
assert.equal(modals.at(-1).title, '物流查询失败');
openLogistics({ nodes: [{ title: '已发货' }] });
assert.equal(routes.length, 0, 'cached nodes must not reopen the removed local page');
const navigate = wx.navigateToMiniProgram;
delete wx.navigateToMiniProgram;
const beforeUnsupported = modals.length;
openLogistics({ trackingNo: 'UNSUPPORTED' });
assert.equal(modals.length, beforeUnsupported + 1);
assert.equal(modals.at(-1).title, '物流查询失败');
assert(modals.every((modal) => !Object.hasOwn(modal, 'content')), 'all failures omit explanatory text');
wx.navigateToMiniProgram = navigate;

load('miniprogram/order/order-detail/index.ts');
page.onDeliveryClick.call({ data: { order: { logisticsVO: shipment } } });
assert.equal(new URLSearchParams(jumps.at(-1).path.split('?')[1]).get('nu'), shipment.logisticsNo.trim());
assert.equal(clipboard.length, 0, 'navigation never overwrites the clipboard');
page.onLogisticsNoCopy.call({ data: { order: { logisticsVO: shipment } } });
assert.equal(clipboard[0].data, shipment.logisticsNo.trim());
page.onLogisticsNoCopy.call({ data: { order: {} } });
assert.equal(clipboard.length, 1, 'missing tracking number must not overwrite the clipboard');
load('miniprogram/order/after-service-detail/index.ts');
page.onLogisticsTap.call({ data: { service: { logistics: { logisticsNo: 'RETURN-1' } } } });
assert.match(jumps.at(-1).path, /nu=RETURN-1&/);
load('miniprogram/order/components/after-service-button-bar/index.ts');
component.methods.viewDelivery({ logisticsVO: { logisticsNo: 'RETURN-2' } });
assert.match(jumps.at(-1).path, /nu=RETURN-2&/);

const template = fs.readFileSync(path.join(root, 'miniprogram/order/order-detail/index.wxml'), 'utf8');
assert.match(template, /class="pay-item pay-item--logistics" wx:if="\{\{order.logisticsVO.logisticsNo\}\}"/);
assert.match(template, /bindtap="onLogisticsNoCopy"/);
assert(template.indexOf('物流单号') > template.indexOf('下单时间'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
assert(!app.subpackages.find((pack) => pack.root === 'order').pages.some((name) => /delivery-detail|logistics-webview/.test(name)));
assert.equal(routes.length, 0, 'all order and return entry points use the external mini program');
console.log('PASS logistics direct navigation, error modal, cancel, privacy, order/return entry points and tracking copy row');
