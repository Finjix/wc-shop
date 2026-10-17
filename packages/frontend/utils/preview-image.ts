/** Use the page's single-image overlay; native preview still shows 1/1. */
export function previewSingleImage(src: unknown, fail?: WechatMiniprogram.PreviewImageFailCallback) {
  if (typeof src !== 'string' || !src.trim()) return;
  const pages = getCurrentPages();
  const viewer = pages[pages.length - 1]?.selectComponent('#image-preview');
  if (viewer) viewer.open(src, fail);
  else fail?.({ errMsg: 'previewImage:fail viewer unavailable' });
}

export function previewUploadImage(event: { detail?: { file?: { url?: string } } }) {
  previewSingleImage(event.detail?.file?.url);
}
