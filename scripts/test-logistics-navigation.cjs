const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let page, component, failRequest = false, responseToken = 'official-token', blocked;
const opens = [], requests = [], modals = [], clipboard = [];
const pageContext = {};
let platform = 'ios';
let pluginLoads = 0, pluginError;
const requirePlugin = () => { throw new Error("must load the subpackage plugin asynchronously"); };
requirePlugin.async = async name => { pluginLoads++; assert.equal(name, "logisticsPlugin"); if (pluginError) throw pluginError; return { openWaybillTracking: options => opens.push(options) }; };
const wx = {
  getDeviceInfo: () => ({ platform }),
  navigateTo: () => { throw new Error("logistics must not open an intermediate page"); },
  openBusinessView: () => { throw new Error('logistics must not open receipt confirmation'); },
  navigateToMiniProgram: () => { throw new Error('third-party logistics is forbidden'); },
  setClipboardData: (options) => clipboard.push(options),
};
const dialogApi = { default: { alert: (options) => { modals.push(options); return Promise.resolve({ index: 0 }); } } };
function load(relative) {
  const filename = path.resolve(root, relative);
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, wx, console, getCurrentPages: () => [pageContext],
    requirePlugin,
    Page: value => { page = value; }, Component: value => { component = value; },
    require: name => name === './dialog' ? dialogApi : name.endsWith('/utils/api') ? { request: async (action, data) => {
      requests.push({ action, data });
      if (blocked) await blocked;
      if (failRequest) throw new Error('unavailable');
      return { waybillToken: responseToken };
    } } : name.endsWith('/utils/logistics') ? logisticsApi : {},
  }, { filename });
  return exports;
}
const logisticsApi = load('miniprogram/components/_shared/frontend/order/utils/logistics.ts');
const { openLogistics } = logisticsApi;

async function run() {
  const shipment = { logisticsNo: 'SF123', receiverPhone: '13800000000', receiverName: '收件人', receiverAddress: '地址' };
  await openLogistics(shipment, 'order-1');
  assert.equal(requests[0].action, 'orders.logistics');
  assert.equal(JSON.stringify(requests[0].data), JSON.stringify({ orderId: 'order-1' }), 'only the order ID is accepted from the client');
  assert.equal(opens[0].waybillToken, 'official-token');
  assert.equal(modals.length, 0);
  let release;
  blocked = new Promise(resolve => { release = resolve; });
  const first = openLogistics(shipment, 'order-1');
  await openLogistics(shipment, 'order-1');
  assert.equal(requests.length, 2, 'repeated taps share the busy guard');
  release(); await first; blocked = null;

  failRequest = true;
  await openLogistics(shipment, 'order-1');
  assert.equal(modals.at(-1).title, '物流查询失败');
  assert.equal(modals.at(-1).context, pageContext);
  assert.equal(clipboard.at(-1).data, 'SF123');
  const beforeCancel = modals.length;
  failRequest = false; responseToken = '';
  await openLogistics(shipment, 'order-1');
  assert.equal(modals.length, beforeCancel + 1, 'a missing server token is not passed to the plugin');
  responseToken = 'retry-token';
  await openLogistics(shipment, 'order-1');
  assert.equal(opens.at(-1).waybillToken, 'retry-token', 'failure releases the busy guard');
  platform = 'devtools'; const beforeDevice = opens.length;
  await openLogistics(shipment, 'order-1');
  assert.equal(opens.length, beforeDevice);
  assert.equal(modals.at(-1).title, '请使用手机微信查看');
  platform = 'ios';
  const requestCount = requests.length;
  await openLogistics({ logisticsNo: '' }, 'order-1');
  assert.equal(requests.length, requestCount);
  assert.equal(modals.at(-1).actions[0].disabled, true);
  await openLogistics({ logisticsNo: 'RETURN-1' });
  assert.equal(requests.length, requestCount, 'return tracking is not submitted with the outbound recipient or payment');

  pluginError = new Error('load failed');
  await openLogistics(shipment, 'order-1');
  assert.equal(modals.at(-1).title, '物流查询失败');
  pluginError = undefined;
  await openLogistics(shipment, 'order-1');
  assert.equal(opens.at(-1).waybillToken, 'retry-token');
  load('miniprogram/pages/order/order-detail/index.ts');
  await page.onDeliveryClick.call({ data: { order: { orderId: 'order-from-page', logisticsVO: shipment } } });
  assert.equal(requests.at(-1).data.orderId, 'order-from-page');
  page.onLogisticsNoCopy.call({ data: { order: { logisticsVO: shipment } } });
  assert.equal(clipboard.at(-1).data, 'SF123');
  load('miniprogram/pages/order/after-service-detail/index.ts');
  page.onLogisticsTap.call({ data: { service: { logistics: { logisticsNo: 'RETURN-1' } } } });
  load('miniprogram/components/order/after-service-button-bar/index.ts');
  component.methods.viewDelivery({ logisticsVO: { logisticsNo: 'RETURN-2' } });
const template = fs.readFileSync(path.join(root, 'miniprogram/pages/order/order-detail/index.wxml'), 'utf8');
assert.match(template, /class="pay-item pay-item--logistics" wx:if="\{\{order.logisticsVO.logisticsNo\}\}"/);
assert.match(template, /bindtap="onLogisticsNoCopy"/);
assert(template.indexOf('物流单号') > template.indexOf('下单时间'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
assert(!app.subpackages.find((pack) => pack.root === 'pages').pages.some((name) => /delivery-detail|logistics-webview/.test(name)));
assert.equal(app.plugins, undefined);
assert.equal(app.subpackages.find(p => p.root === 'logistics').pages.length, 0, 'plugin package has no intermediate page');
assert(pluginLoads > 0);
assert.equal(app.subpackages.find(p => p.root === 'logistics').plugins.logisticsPlugin.provider, 'wx9ad912bf20548d92');
assert.equal(app.subpackages.find(p => p.root === 'logistics').plugins.logisticsPlugin.version, '2.3.0');
console.log('PASS logistics query never opens receipt confirmation; direct async plugin opening without any intermediate page');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
