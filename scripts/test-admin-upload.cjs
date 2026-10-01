const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function main() {
  const calls = [];
  const app = {
    async uploadFile(params) {
      // Match the Web SDK adapter: filePath becomes the HTTP request body.
      assert.ok(params.filePath instanceof File, 'The upload body must be the selected File, not its name');
      calls.push({ action: 'upload', params, bytes: Buffer.from(await params.filePath.arrayBuffer()) });
      return { fileID: `cloud://test/${params.cloudPath}` };
    },
    async callFunction() { assert.fail('Direct uploads must not invoke a conversion function'); },
  };
  const source = fs.readFileSync(path.join(__dirname, '../admin/src/lib/api.ts'), 'utf8')
    .replaceAll('import.meta.env', '({})');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, File, console, Date, crypto: require('node:crypto').webcrypto,
    require(name) {
      assert.equal(name, './cloudbase');
      return { cloudbaseApp: app, requireCloudBase: () => ({ app }) };
    },
  });
  const bytes = Buffer.from([137, 80, 78, 71, 0, 255, 12]);
  const file = new File([bytes], '测试.png', { type: 'image/png' });
  const uploaded = await exports.uploadCloudFile(file, 'admin/categories');
  assert.equal(uploaded, `cloud://test/${calls[0].params.cloudPath}`);
  assert.deepEqual(calls[0].bytes, bytes);
  assert.match(calls[0].params.cloudPath, /^admin\/categories\/\d+-[a-f0-9-]+-__\.png$/);
  assert.deepEqual(calls.map((call) => call.action), ['upload']);
  for (const extension of ['jpg', 'jpeg', 'png', 'webp', 'JPG', 'JPEG', 'PNG', 'WEBP', 'JpG', 'gif', 'GIF', 'svg', 'SVG', 'bmp', 'avif', 'heic', 'tiff', 'ico', 'psd']) {
    for (const type of [`image/${extension.toLowerCase()}`, '', 'application/octet-stream']) {
      calls.length = 0;
      const image = new File([bytes], `图片.${extension}`, { type });
      await exports.uploadCloudFile(image, 'admin/categories');
      assert.deepEqual(calls[0].bytes, bytes);
      assert.ok(calls[0].params.cloudPath.endsWith(`.${extension}`));
      assert.deepEqual(calls.map((call) => call.action), ['upload']);
    }
  }
  calls.length = 0;
  await exports.uploadCloudFile(new File([Buffer.alloc(3 * 1024 * 1024)], 'boundary.png'));
  assert.equal(calls.length, 1, 'Exactly 3MB is allowed');
  calls.length = 0;
  await assert.rejects(() => exports.uploadCloudFile(new File([Buffer.alloc(3 * 1024 * 1024 + 1)], 'large.png')), /图片不能超过 3MB/);
  assert.equal(calls.length, 0, 'Oversized files must be rejected before any upload');
  await assert.rejects(() => exports.uploadCloudFile(new File([], 'empty.png')), /图片文件为空/);
  assert.equal(calls.length, 0);
  console.log('Admin image upload regression checks passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
