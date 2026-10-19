const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('../cloudfunctions/node_modules/sharp');

function load(file, globals) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    .replaceAll('import.meta.env', "({VITE_ADMIN_API_URL:'https://api.test/admin'})").replaceAll('import.meta.url', "'https://test/image-upload.ts'");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, File, console, Date, URL, setTimeout, clearTimeout, Uint8Array, DataView,
    crypto: require('node:crypto').webcrypto, ...globals });
  return exports;
}

async function main() {
  const calls = [];
  let workerOutput;
  let workerCount = 0;
  let workerError = false;
  class Worker {
    constructor() { workerCount++; }
    postMessage() {
      queueMicrotask(() => this.onmessage({ data: workerError ? { error: '图片编码失败' } : { bytes: workerOutput } }));
    }
    terminate() {}
  }
  const images = load('../admin/src/lib/image-upload.ts', { Worker });
  const fetch = async (url, options) => {
    assert.equal(options.credentials, 'omit');
    if (url === 'https://api.test/admin') {
      const request = JSON.parse(options.body);
      assert.equal(request.action, 'storage.prepareUpload', 'reserve upload without invoking pixel conversion');
      assert.deepEqual(Object.keys(options.headers), ['content-type']);
      return { status: 200, json: async () => ({ ok: true, data: {
        cloudPath: `${request.data.folder}/leased.webp`, fileID: `cloud://test/${request.data.folder}/leased.webp`,
        upload: { url: 'https://upload.test', method: 'PUT', headers: { authorization: 'scoped-signature', 'x-cos-security-token': 'scoped-token', 'x-cos-meta-fileid': 'scoped-file' } },
      } }) };
    }
    assert.equal(url, 'https://upload.test');
    assert.equal(options.method, 'PUT', 'current Node SDK metadata signs raw PUT');
    const file = options.body;
    assert.ok(file instanceof File);
    assert.equal(options.headers.authorization, 'scoped-signature');
    assert.equal(options.headers['x-cos-meta-fileid'], 'scoped-file');
    calls.push({ params: { filePath: file }, bytes: Buffer.from(await file.arrayBuffer()) });
    return { ok: true, status: 204 };
  };
  const api = load('../admin/src/lib/api.ts', { fetch, FormData, require(name) {
    if (name === './image-upload') return images;
    if (name === '../../../miniprogram/services/utils/temp-file-urls') return load('../miniprogram/services/utils/temp-file-urls.ts', {});
    if (name === '../../../miniprogram/services/utils/cloud-read-retry') return load('../miniprogram/services/utils/cloud-read-retry.ts', {});
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#12345680' } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp({ lossless: true }).toBuffer();
  workerOutput = Uint8Array.from(webp).buffer;
  for (const extension of ['png', 'PNG', 'PnG', 'jpg', 'JPG', 'jpeg', 'JPEG', 'JpEg']) {
    const bytes = /png/i.test(extension) ? png : jpeg;
    const phases = [];
    const selected = new File([bytes], `图片.${extension}`, { type: 'application/octet-stream' });
    const result = await api.uploadCloudFile(selected, 'admin/categories', (phase) => phases.push(phase));
    assert.match(result, /^cloud:\/\/test\/admin\/categories\//);
    assert.deepEqual(phases, ['处理图片中…', '上传中…']);
    const upload = calls.pop();
    assert.deepEqual(upload.bytes, webp);
    assert.equal(upload.params.filePath.type, 'image/webp');
  }
  for (const extension of ['webp', 'WEBP', 'gif', 'svg', 'bmp', 'avif', 'heic', 'tiff', 'ico', 'psd']) {
    await assert.rejects(() => api.uploadCloudFile(new File([png], `photo.${extension}`)), /仅支持静态/);
  }
  await assert.rejects(() => api.uploadCloudFile(new File([jpeg], 'fake.png')), /格式不匹配/);
  await assert.rejects(() => api.uploadCloudFile(new File([Buffer.from('broken')], 'broken.png')), /已损坏/);
  await assert.rejects(() => api.uploadCloudFile(new File([png.subarray(0, 30)], 'broken.png')), /已损坏/);
  await assert.rejects(() => api.uploadCloudFile(new File([], 'empty.png')), /图片文件为空/);
  await assert.rejects(() => api.uploadCloudFile(new File([Buffer.alloc(images.MAX_SOURCE_IMAGE_BYTES + 1)], 'large.png')), /10MB/);
  // A valid JPEG can contain trailing padding; exercise the exact source boundary.
  const boundary = Buffer.alloc(images.MAX_SOURCE_IMAGE_BYTES);
  jpeg.copy(boundary);
  await api.uploadCloudFile(new File([boundary], 'boundary.JPG'));
  calls.length = 0;
  workerOutput = new ArrayBuffer(15 * 1024 * 1024);
  await api.uploadCloudFile(new File([png], 'large-output.png'));
  assert.equal(calls.pop().bytes.length, 15 * 1024 * 1024);
  workerError = true;
  await assert.rejects(() => api.uploadCloudFile(new File([png], 'failure.png')), /编码失败/);
  workerError = false;
  await api.uploadCloudFile(new File([png], 'retry.png'));
  assert.equal(calls.length, 1, 'Queue recovers after failure');
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0); chunk.write('acTL', 4); chunk.writeUInt32BE(2, 8);
  const apng = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  assert.throws(() => images.inspectStaticImage(apng, 'animated.PNG'), /动态图片/);
  const vp8x = Buffer.alloc(18);
  vp8x.write('VP8X'); vp8x.writeUInt32LE(10, 4); vp8x[8] = 2;
  const animated = Buffer.concat([webp.subarray(0, 12), vp8x, webp.subarray(12)]);
  animated.writeUInt32LE(animated.length - 8, 4);
  assert.throws(() => images.inspectStaticImage(animated, 'animated.WEBP'), /仅支持静态/);
  assert.ok(workerCount > 0);
  console.log('Admin upload checks passed: format, animation, source boundary, output size, phases, retry and direct upload.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
