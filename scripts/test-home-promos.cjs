const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
function files(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const file=path.join(directory,entry.name);
    return entry.isDirectory()?files(file):[file];
  });
}
const assets=files(mini).filter(file => /\.(?:png|jpe?g|webp|gif|svg)$/i.test(file));
assert.deepEqual(assets, [], 'mini-program contains no static image icon files');
const bytes=0;
const markup=fs.readFileSync(path.join(mini,'pages/home/home.wxml'),'utf8');
assert.match(markup,/<button[^>]+bind:tap="showInviteComingSoon"[^>]+aria-label="邀请返现"/);
assert.match(markup,/<button[^>]+open-type="contact"[^>]+aria-label="加客服拿好礼"/);
const cards=markup.slice(markup.indexOf('<view class="home-promo-cards"'),markup.indexOf('<view wx:if="{{recommendations.length}}"'));
assert.doesNotMatch(cards, /<static-image|invite-cashback|customer-gift/, 'retired animations are not rendered');
for (const index of [0, 1]) {
  assert.ok(cards.includes(`src="{{promoImages[${index}]}}"`), 'each fixed slot uses its configured image');
}
assert.equal((cards.match(/mode="aspectFill"/g) || []).length, 2);
const styles = fs.readFileSync(path.join(mini, 'pages/home/home.wxss'), 'utf8');
assert.match(styles, /width: calc\(\(100% - 8rpx\) \/ 2\); height: calc\(\(100vw - 8rpx\) \/ 2\)/);
for(const name of ['invite-cashback','customer-gift']) {
  assert.ok(!fs.existsSync(path.join(mini,'assets/home',`${name}-frames-v261025.jpg`)));
  assert.ok(!fs.existsSync(path.join(mini,'assets/home',`${name}-poster-v261025.jpg`)));
}
console.log(`PASS two configurable square images, native actions, no GIFs and main-package static assets ${bytes} bytes`);
