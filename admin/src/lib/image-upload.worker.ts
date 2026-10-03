import encode, { init as initEncode } from '@jsquash/webp/encode';
import decode, { init as initDecode } from '@jsquash/webp/decode';
import encodeWasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import encodeSimdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';
import decodeWasm from '@jsquash/webp/codec/dec/webp_dec.wasm?url';

const workerScope = self as unknown as {
  onmessage: (event: MessageEvent<{ bytes: ArrayBuffer; format: 'png' | 'jpeg' | 'webp'; reencodeWebp?: boolean }>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = async ({ data: { bytes, format, reencodeWebp } }) => {
  let bitmap: ImageBitmap | undefined;
  try {
    let pixels: ImageData;
    if (format === 'webp') {
      await initDecode({ locateFile: () => decodeWasm });
      pixels = await decode(bytes);
      if (!reencodeWebp && Math.min(pixels.width, pixels.height) <= 1080) {
        workerScope.postMessage({ original: true });
        return;
      }
    } else {
      bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${format}` }), { imageOrientation: 'from-image' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('浏览器无法处理图片');
      context.drawImage(bitmap, 0, 0);
      pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      canvas.width = canvas.height = 1;
      bitmap.close();
      bitmap = undefined;
    }
    const shortest = Math.min(pixels.width, pixels.height);
    if (shortest > 1080) {
      const source = new OffscreenCanvas(pixels.width, pixels.height);
      const sourceContext = source.getContext('2d');
      const target = new OffscreenCanvas(Math.round(pixels.width * 1080 / shortest), Math.round(pixels.height * 1080 / shortest));
      const targetContext = target.getContext('2d', { willReadFrequently: true });
      if (!sourceContext || !targetContext) throw new Error('浏览器无法缩放图片');
      sourceContext.putImageData(pixels, 0, 0);
      targetContext.imageSmoothingEnabled = true;
      targetContext.imageSmoothingQuality = 'high';
      targetContext.drawImage(source, 0, 0, target.width, target.height);
      pixels = targetContext.getImageData(0, 0, target.width, target.height);
      source.width = source.height = target.width = target.height = 1;
    }
    await initEncode({ locateFile: (path: string) => path.includes('simd') ? encodeSimdWasm : encodeWasm });
    const output = await encode(pixels, { lossless: 0, quality: 100, exact: 1, alpha_quality: 100, method: 4 });
    workerScope.postMessage({ bytes: output }, [output]);
  } catch (error) {
    workerScope.postMessage({ error: error instanceof Error && error.message.startsWith('浏览器') ? error.message : '图片解码或编码失败，请检查图片是否损坏' });
  } finally {
    bitmap?.close();
  }
};
