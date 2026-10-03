export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp';
export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
export type UploadPhase = '处理图片中…' | '上传中…';

/** Inspect container chunks before a decoder can silently flatten an animation. */
export function inspectStaticImage(bytes: Uint8Array, filename: string): 'png' | 'jpeg' | 'webp' {
  const extension = filename.match(/\.(png|jpe?g|webp)$/i)?.[1].toLowerCase();
  if (!extension) throw new Error('仅支持静态 PNG、JPG/JPEG、WebP 图片');
  const expected = extension === 'jpg' ? 'jpeg' : extension;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const invalid = () => { throw new Error('图片格式不匹配或文件已损坏'); };
  const animated = () => { throw new Error('不支持动态图片，请选择静态 PNG、JPG/JPEG、WebP'); };
  if (expected === 'png') {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return invalid();
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      if (offset + length + 12 > bytes.length) return invalid();
      const type = tag(offset + 4, 4);
      if (offset === 8 && (type !== 'IHDR' || length !== 13)) return invalid();
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return animated();
      offset += length + 12;
      if (type === 'IEND') { ended = true; break; }
    }
    if (!ended || offset !== bytes.length) return invalid();
  } else if (expected === 'webp') {
    if (bytes.length < 20 || tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) return invalid();
    let offset = 12;
    let image = false;
    while (offset + 8 <= bytes.length) {
      const type = tag(offset, 4);
      const length = view.getUint32(offset + 4, true);
      if (offset + 8 + length > bytes.length) return invalid();
      if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && length >= 1 && (bytes[offset + 8] & 2))) return animated();
      if (type === 'VP8 ' || type === 'VP8L') image = true;
      offset += 8 + length + (length & 1);
    }
    if (!image || offset !== bytes.length) return invalid();
  } else {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return invalid();
    if (!bytes.some((v, i) => v === 255 && bytes[i + 1] === 217)) return invalid();
  }
  return expected as 'png' | 'jpeg' | 'webp';
}

let processingQueue: Promise<unknown> = Promise.resolve();

export function prepareImageUpload(file: File, options: { existingResource?: boolean } = {}): Promise<File> {
  const run = async () => {
    if (!file.size) throw new Error('图片文件为空');
    if (!options.existingResource && file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('原图片不能超过 10MB');
    const bytes = await file.arrayBuffer();
    const format = inspectStaticImage(new Uint8Array(bytes), file.name);
    return new Promise<File>((resolve, reject) => {
      const worker = new Worker(new URL('./image-upload.worker.ts', import.meta.url), { type: 'module' });
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      const timer = setTimeout(() => { finish(); reject(new Error('图片处理超时，请选择尺寸更小的图片后重试')); }, 120_000);
      worker.onerror = () => { finish(); reject(new Error('图片处理失败，请重试或更换图片')); };
      worker.onmessageerror = () => { finish(); reject(new Error('图片处理结果读取失败，请重试')); };
      worker.onmessage = (event: MessageEvent<{ error?: string; original?: boolean; bytes?: ArrayBuffer }>) => {
        finish();
        if (event.data.error) { reject(new Error(event.data.error)); return; }
        if (event.data.original) { resolve(file); return; }
        if (!event.data.bytes?.byteLength) { reject(new Error('图片编码失败')); return; }
        resolve(new File([event.data.bytes], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' }));
      };
      try { worker.postMessage({ bytes, format, reencodeWebp: Boolean(options.existingResource) }, [bytes]); }
      catch { finish(); reject(new Error('浏览器无法启动图片处理，请重试')); }
    });
  };
  const result = processingQueue.then(run);
  processingQueue = result.catch(() => undefined);
  return result;
}
