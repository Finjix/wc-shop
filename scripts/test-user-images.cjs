const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('../cloudfunctions/node_modules/sharp');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'packages/form-ui/image-processor');

async function main() {
  // Exercise the shipped Emscripten glue and real WASM through the WeChat adapter.
  const inputs = new Map();
  const outputs = new Map();
  let dimensions = [1200, 1800];
  let instantiations = 0;
  const wx = {
    env: { USER_DATA_PATH: '/test' },
    getFileSystemManager() { return {
      getFileInfo({ filePath, success }) { success({ size: inputs.get(filePath).length }); },
      readFile({ filePath, success }) { const bytes = inputs.get(filePath); success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }); },
      writeFile({ filePath, data, success }) { outputs.set(filePath, Buffer.from(data)); success({}); },
    }; },
    createOffscreenCanvas() {
      const canvas = { width: 1, height: 1, createImage() {
        return { width: dimensions[0], height: dimensions[1], set src(value) { queueMicrotask(() => this.onload()); } };
      }, getContext() { return {
        drawImage() {}, getImageData() {
          const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          for (let i = 0; i < data.length; i += 4) {
            data[i] = (i * 13) % 255; data[i + 1] = (i * 7) % 255; data[i + 2] = (i * 3) % 255; data[i + 3] = 255;
          }
          return { data, width: canvas.width, height: canvas.height };
        },
      }; } };
      return canvas;
    },
  };
  const WXWebAssembly = Object.assign({}, WebAssembly, {
    Memory: WebAssembly.Memory, Table: WebAssembly.Table,
    async instantiate(file, imports) {
      instantiations++;
      assert.equal(file, 'packages/form-ui/image-processor/codec/webp_enc.wasm');
      return WebAssembly.instantiate(fs.readFileSync(path.join(root, file)), imports);
    },
  });
  const context = vm.createContext({ console, wx, WXWebAssembly, Uint8Array, Uint8ClampedArray, DataView, ArrayBuffer,
    Promise, Math, Date, setTimeout, clearTimeout, TextDecoder });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const wrapper = vm.runInContext(`(function(module, exports, require) { ${fs.readFileSync(file, 'utf8')}\n})`, context);
    wrapper(module, module.exports, (ref) => load(path.resolve(path.dirname(file), ref + '.js')));
    cache.set(file, module.exports);
    return module.exports;
  }
  const processor = load(path.join(base, 'processor.js'));
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#12345680' } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  inputs.set('/photo.png', png);
  inputs.set('/photo.jpg', jpeg);
  inputs.set('/photo.webp', webp);
  await assert.rejects(processor.prepare({ url: '/photo.webp' }, 50), /JPG 或 PNG/);
  // Reject a disguised WebP too.
  inputs.set('/fake.png', webp);
  await assert.rejects(processor.prepare({ url: '/fake.png' }, 50), /JPG 或 PNG/);
  inputs.set('/huge.png', Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(processor.prepare({ url: '/huge.png' }, 100), /10MB/);
  const fifty = await processor.prepare({ url: '/photo.png' }, 50);
  const hundred = await processor.prepare({ url: '/photo.jpg' }, 100);
  for (const file of [fifty, hundred]) {
    const metadata = await sharp(outputs.get(file.url)).metadata();
    assert.equal(metadata.format, 'webp');
    assert.deepEqual([metadata.width, metadata.height], [1080, 1620]);
    assert.equal(file.size, outputs.get(file.url).length);
  }
  assert(outputs.get(fifty.url).length < outputs.get(hundred.url).length, 'Quality 50 should encode fewer bytes than 100');
  dimensions = [10, 20];
  const small = await processor.prepare({ url: '/photo.png' }, 50);
  const metadata = await sharp(outputs.get(small.url)).metadata();
  assert.deepEqual([metadata.width, metadata.height], [10, 20]);
  assert.equal(instantiations, 1, 'Reuse the subpackage encoder');
  await testPageAndUpload();
  console.log('PASS real subpackage WASM, WebP output, qualities 50/100, proportional scaling, small images, source format and 10MB cap');
}

async function testPageAndUpload() {
  let page;
  let prepareOptions;
  let finish;
  let apiCalls = 0;
  function loadPage(relative) {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(compiled, { exports, Page(value) { page = value; },
      wx: { showLoading() {}, hideLoading() {} },
      require(ref) {
        if (ref.includes('toast')) return { default() {} };
        if (ref === '../config') return {
          OrderStatus: {}, ServiceType: { RETURN_GOODS: 10, ONLY_REFUND: 20 },
          ServiceReceiptStatus: { NOT_RECEIPTED: 0, RECEIPTED: 1 },
        };
        return { createComment() { apiCalls++; }, getApiErrorMessage: (error) => error.message };
      }, console, Date, Promise, setTimeout });
    return { ...page, data: { ...page.data }, setData(value, callback) { Object.assign(this.data, value); callback?.(); },
      selectComponent() { return { prepare(files, quality) {
        prepareOptions = { files, quality };
        return new Promise((resolve) => { finish = resolve; });
      } }; },
    };
  }
  for (const [file, quality, callback] of [
    ['pages/goods/comments/create/index.ts', 50, 'onSubmitBtnClick'],
    ['pages/order/apply-service/index.ts', 100, 'onSubmit'],
  ]) {
    const instance = loadPage(file);
    instance.data.isAllowedSubmit = true;
    instance.orderNo = 'order-1';
    const processing = instance.handleSuccess({ detail: { files: [{ url: '/photo.png' }] } });
    assert.equal(instance.data.processingImages, true);
    assert.equal(prepareOptions.quality, quality);
    instance[callback]();
    assert.equal(apiCalls, 0, 'Do not submit while images are being prepared');
    finish({ files: [{ url: '/compressed.webp' }] });
    await processing;
    assert.equal(instance.data.processingImages, false);
    const selected = quality === 50 ? instance.data.uploadFiles : instance.data['serviceFrom.rightsImageUrls'];
    assert.equal(selected[0].url, '/compressed.webp');
  }
  let uploadOptions;
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'utils/cloud.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require() { return { useLocalBackend: true, localBackendUrl: 'http://localhost' }; },
    wx: {
      getFileInfo({ success }) { success({ size: 15 * 1024 * 1024 }); },
      uploadFile(options) { uploadOptions = options; options.success({ data: JSON.stringify({ ok: true, data: { fileID: 'local://comments/out.webp' } }) }); },
    }, console });
  assert.equal(await exports.uploadCloudFile('/large-output.webp', 'comments'), 'local://comments/out.webp');
  assert.equal(uploadOptions.header['x-upload-folder'], 'comments');
  console.log('PASS actual page processing/submission guards and upload output above 10MB');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
