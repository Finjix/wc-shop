// Native modals place cancel on the left. Swap labels and map the result back
// so callers still receive confirm/cancel according to the displayed action.
export function showConfirmModal(options: WechatMiniprogram.ShowModalOption) {
  if (options.showCancel === false) return wx.showModal({ ...options, confirmText: '确定' });
  const mapResult = (result: WechatMiniprogram.ShowModalSuccessCallbackResult) => ({
    ...result,
    confirm: result.cancel,
    cancel: result.confirm,
  });
  return wx.showModal({
    ...options,
    cancelText: '确定',
    cancelColor: options.confirmColor || '#576B95',
    confirmText: '取消',
    confirmColor: options.cancelColor || '#000000',
    success: (result) => options.success?.(mapResult(result)),
    complete: (result) => options.complete?.(
      'confirm' in result ? mapResult(result as WechatMiniprogram.ShowModalSuccessCallbackResult) : result,
    ),
  });
}
