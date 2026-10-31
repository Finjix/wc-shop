// @ts-nocheck
function open(options, alert) {
  const { context, selector, ...rest } = options;
  const page = context || getCurrentPages().slice(-1)[0];
  const dialog = page?.selectComponent(selector || '#t-dialog');
  if (!dialog) return Promise.reject(new Error('弹窗尚未准备好'));
  return new Promise((resolve, reject) => {
    const confirmBtn = options.confirmBtn === null ? null : { ...(typeof options.confirmBtn === 'object' ? options.confirmBtn : {}), content: alert ? (typeof options.confirmBtn === 'string' ? options.confirmBtn : options.confirmBtn?.content || '确定') : '确定' };
    dialog.setData({ title: '', content: '', actions: [], ...rest, confirmBtn, cancelBtn: alert ? null : '取消', visible: true });
    dialog._onConfirm = resolve; dialog._onAction = resolve; dialog._onCancel = alert ? resolve : reject;
  });
}
export default { alert(options) { return open(options, true); }, confirm(options) { return open(options, false); } };
