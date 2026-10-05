const createEncoder = require('./codec/webp_enc');
const defaults = require('./codec/options');
let encoderPromise;
let queue = Promise.resolve();

function encoder() {
  if (!encoderPromise) {
    if (typeof WXWebAssembly === 'undefined') throw new Error('当前微信版本不支持图片处理，请升级微信');
    encoderPromise = new Promise((resolve, reject) => createEncoder({
      instantiateWasm(imports, receive) {
        WXWebAssembly.instantiate('packages/form-ui/image-processor/codec/webp_enc.wasm', imports)
          .then((result) => receive(result.instance || result, result.module))
          .catch(reject);
        return {};
      },
      onAbort: reject,
    }).then(resolve, reject));
    encoderPromise = encoderPromise.catch((error) => {
      console.error('WebP encoder initialization failed', error);
      encoderPromise = undefined;
      throw new Error('图片编码器加载失败，请重试');
    });
  }
  return encoderPromise;
}

function call(target, method, options) {
  return new Promise((resolve, reject) => target[method]({ ...options, success: resolve, fail: reject }));
}

function inspectSource(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 33 && signature.every((value, index) => bytes[index] === value)) {
    const view = new DataView(buffer);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      if (offset + length + 12 > bytes.length) break;
      const tag = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (['acTL', 'fcTL', 'fdAT'].includes(tag)) throw new Error('不支持动态图片，请选择静态 JPG 或 PNG');
      if (tag === 'IEND' && offset + length + 12 === bytes.length) return;
      offset += length + 12;
    }
    throw new Error('图片文件已损坏');
  }
  throw new Error('只能选择 JPG 或 PNG 图片');
}

async function prepare(file, quality) {
  const path = file.tempFilePath || file.path || file.url;
  const fs = wx.getFileSystemManager();
  const info = await call(fs, 'getFileInfo', { filePath: path });
  if (!info.size) throw new Error('图片文件为空');
  if (info.size > 10 * 1024 * 1024) throw new Error('原图片不能超过 10MB');
  const source = await call(fs, 'readFile', { filePath: path });
  inspectSource(source.data);
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 });
  const image = canvas.createImage();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('图片解码失败，请更换图片'));
    image.src = path;
  });
  const scale = Math.min(1, 1080 / Math.min(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  try {
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const codec = await encoder();
    const output = codec.encode(pixels.data, pixels.width, pixels.height,
      { ...defaults, quality, lossless: 0, exact: 1, alpha_quality: 100 });
    if (!output || !output.byteLength) throw new Error('图片编码失败');
    const bytes = new Uint8Array(output);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const resultPath = `${wx.env.USER_DATA_PATH}/upload-${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
    await call(fs, 'writeFile', { filePath: resultPath, data });
    return { url: resultPath, tempFilePath: resultPath, name: resultPath.split('/').pop(),
      size: data.byteLength, type: 'image', percent: 100 };
  } finally {
    canvas.width = canvas.height = 1;
  }
}

module.exports = {
  inspectSource,
  prepare(file, quality) {
    const result = queue.then(() => prepare(file, quality));
    queue = result.catch(() => undefined);
    return result;
  },
};
