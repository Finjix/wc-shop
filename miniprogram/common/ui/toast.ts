// @ts-nocheck
export default function toast(options = {}) {
  wx.showToast({ title: String(options.message || ''), icon: options.icon === 'check-circle' ? 'success' : 'none', duration: options.duration || 2000 });
}
