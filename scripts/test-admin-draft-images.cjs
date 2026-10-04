const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('admin/src/lib/draft-images.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject });
const { DraftImages } = exportsObject;

async function main() {
  const uploaded = [], cleaned = [], revoked = [], prepared = [];
  let nextUrl = 0, fail = false;
  const store = new DraftImages({
    prepare: async (file) => { prepared.push(file); return file; },
    upload: async (file) => { if (fail) throw new Error('network'); uploaded.push(file); return `cloud://env.bucket/home/${file.name}.webp`; },
    cleanup: async (ids) => { cleaned.push(...ids); },
    createUrl: () => `blob:${++nextUrl}`,
    revokeUrl: (url) => revoked.push(url),
  });
  const replaced = await store.select(new File(['a'], 'replaced'));
  const cover = await store.select(new File(['b'], 'cover'));
  assert.equal(uploaded.length, 0, 'selection never uploads');
  assert.equal(prepared.length, 2);
  const saved = await store.upload({ cover, images: [cover], old: 'cloud://existing.webp' });
  assert.equal(uploaded.length, 1, 'upload only referenced drafts and deduplicate shared preview');
  assert.equal(saved.cover, saved.images[0]);
  assert.equal(saved.old, 'cloud://existing.webp');
  await store.upload({ cover });
  assert.equal(uploaded.length, 1, 'save retries reuse completed uploads');
  fail = true;
  const detail = await store.select(new File(['c'], 'detail'));
  await assert.rejects(() => store.upload({ detail }), /network/);
  fail = false;
  const retry = await store.upload({ cover, detail });
  assert.equal(uploaded.length, 2);
  store.commit(retry);
  assert.equal(cleaned.length, 0, 'committed images are never queued as orphans');
  assert(revoked.includes(replaced));
  const orphan = await store.select(new File(['d'], 'orphan'));
  await store.upload({ orphan });
  await store.discard();
  assert(cleaned.some((id) => id.endsWith('/orphan.webp')), 'abandoned save uploads are cleaned');
  await assert.rejects(() => store.upload({ image: orphan }), /草稿已失效/);

  let finishUpload;
  const late = new DraftImages({
    prepare: async (file) => file,
    upload: () => new Promise((resolve) => { finishUpload = resolve; }),
    cleanup: async (ids) => { cleaned.push(...ids); },
    createUrl: () => 'blob:late', revokeUrl() {},
  });
  const url = await late.select(new File(['e'], 'late'));
  const pending = late.upload({ url });
  late.dispose();
  finishUpload('cloud://env.bucket/home/late.webp');
  await assert.rejects(() => pending, /编辑页面已关闭/);
  assert(cleaned.includes('cloud://env.bucket/home/late.webp'), 'late upload after leaving is cleaned');
  console.log('PASS draft images: local-only selection, save upload, reuse, retries, discard and late completion');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
