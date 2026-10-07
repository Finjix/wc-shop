// @ts-nocheck
import props from 'tdesign-miniprogram/dialog/props';
import { getInstance } from 'tdesign-miniprogram/common/utils';

// 与锁定的 TDesign 1.9.5 Dialog API 保持一致；调用封装归订单分包，组件仍由 npm 提供。
const defaultOptions = {
  actions: [],
  buttonLayout: props.buttonLayout.value,
  cancelBtn: '取消',
  closeOnOverlayClick: props.closeOnOverlayClick.value,
  confirmBtn: '确定',
  content: '',
  preventScrollThrough: props.preventScrollThrough.value,
  showOverlay: props.showOverlay.value,
  title: '',
  visible: props.visible.value,
};

// TDesign's virtual-host button accepts a style on its flex item.
function confirmOnLeft(options) {
  const button = options.confirmBtn;
  const confirmBtn = button ? { ...(typeof button === 'object' ? button : {}), content: '确定' } : button;
  if (confirmBtn) confirmBtn.style = `${confirmBtn.style || ''}; order: -1; margin-left: 0;`;
  const cancel = options.cancelBtn;
  const cancelBtn = cancel ? (typeof cancel === 'object' ? { ...cancel, content: '取消' } : '取消') : cancel;
  return { ...options, confirmBtn, cancelBtn };
}

export default {
  alert(options) {
    const { context, selector = '#t-dialog', ...rest } = { ...options };
    const dialog = getInstance(context, selector);
    if (!dialog) return Promise.reject();
    return new Promise((resolve) => {
      dialog.setData(confirmOnLeft({ ...defaultOptions, ...dialog.properties, ...rest, cancelBtn: '', visible: true }));
      dialog._onConfirm = resolve;
    });
  },
  confirm(options) {
    const { context, selector = '#t-dialog', ...rest } = { ...options };
    const dialog = getInstance(context, selector);
    if (!dialog) return Promise.reject();
    return new Promise((resolve, reject) => {
      dialog.setData(confirmOnLeft({ ...defaultOptions, ...dialog.properties, ...rest, visible: true }));
      dialog._onConfirm = resolve;
      dialog._onCancel = reject;
    });
  },
};
