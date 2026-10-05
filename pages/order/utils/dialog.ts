// @ts-nocheck
import props from 'tdesign-miniprogram/dialog/props';
import { getInstance } from 'tdesign-miniprogram/common/utils';

// 与锁定的 TDesign 1.9.5 Dialog API 保持一致；调用封装归订单分包，组件仍由 npm 提供。
const defaultOptions = {
  actions: [],
  buttonLayout: props.buttonLayout.value,
  cancelBtn: props.cancelBtn.value,
  closeOnOverlayClick: props.closeOnOverlayClick.value,
  confirmBtn: props.confirmBtn.value,
  content: '',
  preventScrollThrough: props.preventScrollThrough.value,
  showOverlay: props.showOverlay.value,
  title: '',
  visible: props.visible.value,
};

export default {
  alert(options) {
    const { context, selector = '#t-dialog', ...rest } = { ...options };
    const dialog = getInstance(context, selector);
    if (!dialog) return Promise.reject();
    return new Promise((resolve) => {
      dialog.setData({ cancelBtn: '', ...defaultOptions, ...dialog.properties, ...rest, visible: true });
      dialog._onConfirm = resolve;
    });
  },
  confirm(options) {
    const { context, selector = '#t-dialog', ...rest } = { ...options };
    const dialog = getInstance(context, selector);
    if (!dialog) return Promise.reject();
    return new Promise((resolve, reject) => {
      dialog.setData({ ...defaultOptions, ...dialog.properties, ...rest, visible: true });
      dialog._onConfirm = resolve;
      dialog._onCancel = reject;
    });
  },
};
