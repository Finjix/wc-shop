const { readSource: readMiniProgramSource } = require('./miniprogram-test-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const requests = [];
const uploads = [];
const previews = [];
const cleanups = [];
const wx = { env: { USER_DATA_PATH: 'http://usr' }, previewImage: (options) => previews.push(options) };
let uploadError;
let page;
let component;
let items = [{
  _id: 'comment-1', productId: 'product-1', content: '好用', rating: 5,
  reply: '谢谢支持', createdAt: '2026-01-01', images: ['cloud://comment.webp'],
}];
function load(file) {
  const filename = require("./miniprogram-test-source.cjs").resolveSource(path.resolve(root, file));
  if (filename === path.join(root, 'miniprogram/services/utils/api.ts')) return {
    request: async (action, payload) => {
      requests.push({ action, payload });
      return action === 'comments.create' ? { ...payload, createdAt: '2026-01-01' } : { items, total: items.length, page: 1 };
    },
    uploadCloudFile: async (file, folder) => {
      uploads.push({ file, folder });
      if (uploadError) throw uploadError;
      return `cloud://test/user/comments/${uploads.length}.webp`;
    },
    getApiErrorMessage: (error) => error.message,
    cleanupCloudFiles: async (ids) => { cleanups.push(...ids); },
  };
  if (filename === path.join(root, 'miniprogram/services/utils/images.ts')) return { resolveImage: async (id) => `https://example.test/${id.split('://')[1]}` };
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  vm.runInNewContext(ts.transpileModule(readMiniProgramSource(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports, wx, Page: (definition) => { page = definition; }, Component: (definition) => { component = definition; },
    getCurrentPages: () => [{ selectComponent: () => ({ open(src) { previews.push({ current: src, urls: [src] }); } }) }],
    require(name) {
      if (name.endsWith('/common/ui/toast')) name = 'native-toast';
      if (name === 'native-toast') return { default() {} };
      if (name.startsWith('.')) return load(`${path.resolve(path.dirname(filename), name)}.ts`);
      throw new Error(`Unexpected dependency ${name}`);
    },
  }, { filename });
  return exports;
}
async function run() {
  const api = load('miniprogram/services/goods/services/comments/api.ts');
  const list = await load('miniprogram/services/goods/services/comments/fetchComments.ts').fetchComments({ spuId: 'product-1' });
  assert.equal(list.pageList[0].sellerReply, '谢谢支持');
  assert.equal(list.pageList[0].commentContent, '好用');
  assert.equal(list.pageList[0].commentScore, 5);
  assert.equal(list.pageList[0].commentTime, '01/01');
  assert.equal(list.pageList[0].commentResources[0].image, 'https://example.test/comment.webp');
  assert.equal(list.pageList[0].commentResources[0].fileID, 'cloud://comment.webp');
  const own = await load('miniprogram/services/goods/services/comments/fetchOrderComment.ts').fetchOrderComment('order-1', 'product-1');
  assert.equal(own.sellerReply, '谢谢支持');
  assert.equal(own.commentTime, '01/01');
  assert.equal(api.normalizeComment({ images: [], createdAt: 'invalid' }).commentTime, '');
  assert.equal(api.normalizeComment({ images: [], createdAt: 0 }).commentTime, '01/01');
  assert.equal(requests.at(-1).payload.mineOnly, true);
  for (const reply of ['', undefined]) assert.equal(api.normalizeComment({ images: [], reply }).sellerReply, '');
  assert.equal(api.normalizeComment(null), null);
  items = [{ ...items[0], content: '', rating: 1, reply: '' }];
  const imageOnly = await load('miniprogram/services/goods/services/comments/fetchOrderComment.ts').fetchOrderComment('order-1');
  assert.equal(imageOnly.commentContent, '');
  assert.equal(imageOnly.commentScore, 1);
  assert.equal(imageOnly.commentResources.length, 1);
  items = [{ ...items[0], images: ['http://usr/deleted.webp'] }];
  const expired = await load('miniprogram/services/goods/services/comments/fetchOrderComment.ts').fetchOrderComment('order-1');
  assert.equal(expired.commentResources[0].expired, true);
  assert.equal(expired.commentResources[0].image, '');
  items = [];
  assert.equal(await load('miniprogram/services/goods/services/comments/fetchOrderComment.ts').fetchOrderComment('order-1'), null);
  const create = load('miniprogram/services/goods/services/comments/createComment.ts').createComment;
  await create({ productId: 'product-1', commentContent: '测试', rating: 5, commentResources: [
    { tempFilePath: 'http://usr/prepared.webp' }, { url: 'http://tmp/selected.jpg' }, 'wxfile://usr/native.webp',
  ] });
  assert.equal(uploads.length, 3);
  assert.equal(cleanups.length, 3, 'uploaded images are checked after save, including idempotent retries');
  assert.ok(uploads.every((upload) => upload.folder === 'comments'));
  assert.ok(requests.at(-1).payload.images.every((image) => image.startsWith('cloud://')));
  wx.env.USER_DATA_PATH = '/native/user';
  await create({ commentResources: [{ url: '/native/user/prepared.webp' }] });
  assert.equal(uploads.length, 4);
  await create({ commentResources: ['cloud://test/existing.webp', 'local://comments/existing.webp', 'https://example.test/existing.webp'] });
  assert.equal(uploads.length, 4, 'do not re-upload durable image IDs/URLs');
  const beforeFailure = requests.length;
  uploadError = new Error('上传失败');
  await assert.rejects(() => create({ commentResources: ['http://usr/failed.webp'] }), /上传失败/);
  assert.equal(requests.length, beforeFailure, 'failed uploads must not save a temporary path');
  load('miniprogram/pages/goods/comments/index.ts');
  const instance = { ...page, data: { ...page.data, commentType: 'latest' }, setData(patch) { Object.assign(this.data, patch); } };
  instance.setCommentResult({ totalCount: 2, pageList: [
    api.normalizeComment({ _id: 'older', createdAt: '2025-12-31', images: [] }),
    api.normalizeComment({ _id: 'newer', createdAt: '2026-01-01', images: [] }),
  ] }, { pageNum: 1 }, true, []);
  assert.equal(instance.data.commentList[0]._id, 'newer', 'sort by full timestamp, not month/day');
  assert.equal(instance.data.commentList[0].commentTime, '01/01');
  const ownPending = instance.getOwnComment('order-1');
  assert.equal(instance.data.ownLoading, true);
  await ownPending;
  assert.equal(instance.data.ownLoading, false);
  assert.equal(instance.data.ownComment, null);
  items = [{ rating: 5, content: '评价', images: [], reply: '回'.repeat(100) }];
  await instance.getOwnComment('order-1');
  assert.equal(instance.data.ownComment.sellerReply.length, 100);
  items[0].reply = '';
  await instance.getOwnComment('order-1');
  assert.equal(instance.data.ownComment.sellerReply, '');
  const pageMarkup = readMiniProgramSource(path.join(root, 'miniprogram/pages/goods/comments/index.wxml'), 'utf8');
  assert.doesNotMatch(pageMarkup, /自己\(|data-commentType="5"/);
  for (const label of ['全部(', '带图(', '最新']) assert.ok(pageMarkup.includes(label));
  const ownMarkup = pageMarkup.split('<block wx:if="{{mineOnly}}">')[1].split('</block>')[0];
  assert.match(ownMarkup, /ownView="\{\{true\}\}"/);
  const ownReviewComponent = ownMarkup.match(/<comments-card[\s\S]*?\/>/)[0];
  assert.doesNotMatch(ownReviewComponent, /commentTime|sellerReply|goodsDetailInfo|isAnonymity/);
  assert.match(ownMarkup, /class="own-seller-reply" wx:if="\{\{ownComment\.sellerReply\}\}"/);
  assert.match(ownMarkup, /class="own-seller-reply-content">\{\{ownComment\.sellerReply\}\}/);
  const ownStyles = readMiniProgramSource(path.join(root, 'miniprogram/pages/goods/comments/index.wxss'), 'utf8');
  assert.match(ownStyles, /\.comments-page-own \.comments-scroll-content\s*\{\s*background-color:\s*#fff;/);
  assert.match(ownStyles, /\.own-seller-reply-content\s*\{[^}]*white-space:\s*pre-wrap;[^}]*word-break:\s*break-all;[^}]*overflow-wrap:\s*anywhere;/);
  const cardStyles = readMiniProgramSource(path.join(root, 'miniprogram/components/goods/comments/comments-card/index.wxss'), 'utf8');
  const ownCardStyles = cardStyles.match(/\.comments-card-own\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(ownCardStyles, /border:|border-radius:|box-shadow:/);
  assert.match(cardStyles, /\.comments-card-reply \.content\s*\{[^}]*display:\s*block;[^}]*white-space:\s*pre-wrap;[^}]*word-break:\s*break-all;[^}]*overflow-wrap:\s*anywhere;/);
  const cardMarkup = readMiniProgramSource(path.join(root, 'miniprogram/components/goods/comments/comments-card/index.wxml'), 'utf8');
  assert.match(cardMarkup, /wx:if="\{\{ownView\}\}"[\s\S]*?'好评' : '差评'/);
  assert.match(cardMarkup, /wx:else class="comments-title"/);
  assert.match(cardMarkup, /sellerReply && !ownView/);
  load('miniprogram/components/goods/comments/comments-card/index.ts');
  assert.equal(component.properties.ownView.value, false, 'public cards retain their metadata by default');
  load('miniprogram/components/goods/comments/comments-card/components/images-videos/index.ts');
  const gallery = { ...component.methods, data: { imageResources: [
    { image: 'https://example.test/one.webp' }, { image: 'https://example.test/two.webp' },
    { image: '', expired: true }, { image: 'https://example.test/broken.webp', failed: true },
  ] } };
  gallery.onPreview({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(previews[0].current, 'https://example.test/two.webp');
  assert.deepEqual(Array.from(previews[0].urls), ['https://example.test/two.webp']);
  gallery.onPreview({ currentTarget: { dataset: { index: 2 } } });
  gallery.onPreview({ currentTarget: { dataset: { index: 3 } } });
  assert.equal(previews.length, 1);
  console.log('PASS own reviews show rating/content/images and a separate merchant reply card, handle empty states and preview usable images without altering public-card metadata');
  const commerce = readMiniProgramSource(path.join(root, 'admin/src/pages/CommercePages.tsx'), 'utf8');
  const markup = commerce.split('export function CommentsPage()')[1].split('function afterSaleType')[0];
  assert.doesNotMatch(markup, /<PageTitle>|<th>用户<\/th>|<th>评分<\/th>|row\.userId|row\.userName|home-config-dialog/);
  for (const pattern of [/className="orders-page comments-page"/, /className="toolbar commerce-toolbar orders-toolbar"/, /orders-empty-panel/, /row\.productTitle/, /row\.productSpecs/, /showTotal=\{false\}/, /'好评'/, /'差评'/]) assert.match(markup, pattern);
  assert.doesNotMatch(markup, /评价时间|formatMonthDay\(row\.createdAt\)/);
  assert.doesNotMatch(markup, /<Link|to=\{`\/orders\//);
  assert.match(markup, /<td>\{row\.orderNo \|\| '—'\}<\/td>/);
  assert.match(markup, /EmptyTable colSpan=\{7\}/);
  assert.match(markup, /comments-content-preview\$\{expandedCommentId === id \? ' is-expanded' : ''\}/);
  assert.match(markup, /aria-expanded=\{expandedCommentId === id\}/);
  assert.match(markup, /setExpandedCommentId\(\(old\) => old === id \? null : id\)/);
  assert.doesNotMatch(markup, /contentOpen|comments-content-dialog/);
  const replyDialog = markup.split('{replyOpen && <Dialog')[1].split('</Dialog>}')[0];
  assert.match(replyDialog, /header=\{false\}/);
  assert.match(replyDialog, /<Field label="回复">/);
  assert.match(replyDialog, /maxLength=\{100\}/);
  assert.match(replyDialog, /\{replyText\.length\}\/100/);
  assert.match(replyDialog, /confirmBtn=\{\{ content: '确定'/);
  assert.doesNotMatch(replyDialog, /hint=|header="商家回复"|label="回复内容"/);
  const styles = readMiniProgramSource(path.join(root, 'admin/src/styles.css'), 'utf8');
  assert.match(markup, /colSpan=\{contentExpanded \? 4 : 1\}/);
  assert.match(markup, /<th colSpan=\{contentExpanded \? 4 : 1\}>内容<\/th>\{!contentExpanded && <>/);
  assert.match(markup, /\{!contentExpanded && <>[\s\S]*className="commerce-image-row"[\s\S]*className="commerce-actions"[\s\S]*<\/>\}/);
  assert.match(markup, /<colgroup><col \/><col \/><col \/><col \/><col \/><col \/><col \/><\/colgroup>/);
  assert.doesNotMatch(markup, /修改回复/);
  assert.match(styles, /\.comments-page tbody tr\s*\{\s*height:\s*74px;/);
  assert.match(styles, /\.comments-content-preview\.is-expanded\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow-x:\s*auto;[^}]*height:\s*48px;/);
  assert.match(styles, /\.comments-reply-input\s*\{[^}]*resize:\s*none;/);
  assert.match(styles, /\.comments-page table\s*\{\s*table-layout:\s*fixed;/);
  assert.match(styles, /\.comments-page col:nth-child\(2\)\s*\{\s*width:\s*20%;/);
  assert.match(styles, /\.comments-page col:nth-child\(4\)\s*\{\s*width:\s*22%;/);
  assert.match(styles, /\.comments-page col:nth-child\(5\)\s*\{\s*width:\s*12%;/);
  assert.match(styles, /\.comments-page \.commerce-image-row\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*min-width:\s*0;/);
  assert.match(styles, /\.comments-page \.commerce-thumb\s*\{[^}]*width:\s*calc\(\(100% - 14px\) \/ 3\);[^}]*aspect-ratio:\s*1;[^}]*flex-shrink:\s*0;/);
  assert.doesNotMatch(markup, /'通过'|>通过</);
  assert.match(markup, /moderate\(row, 'active'\)\}>展示<\/Button>/);
  assert.match(markup, /moderate\(row, 'rejected'\)\}>隐藏<\/Button>/);
  assert.doesNotMatch(markup, /\{!?isActive && <Button/);
  assert.match(markup, /disabled=\{busy \|\| isActive\}/);
  assert.match(markup, /disabled=\{busy \|\| \['rejected', 'inactive'\]\.includes\(normalized\)\}/);
  assert.match(styles, /\.comments-content-preview\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
  assert.match(markup, /await confirm\(`/);
  assert.match(markup, /run\('comments\.delete'/);
  assert.match(markup, /void deleteComment\(row\)/);
  assert.match(markup, /rows\.length === 1 && search\.page > 1/);
  console.log('PASS durable WeChat image uploads, upload failure guards, expired images, month/day dates and cross-year review sorting');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
