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
const assets=files(path.join(mini,'assets'));
assert.ok(!assets.some(file=>/\.gif$/i.test(file)),'no GIF files in the resource package');
const bytes=assets.reduce((sum,file)=>sum+fs.statSync(file).size,0);
assert.ok(bytes<2*1024*1024,`resource package exceeds 2 MiB: ${bytes}`);
const markup=fs.readFileSync(path.join(mini,'pages/home/home.wxml'),'utf8');
assert.match(markup,/<button[^>]+bind:tap="showInviteComingSoon"[^>]+aria-label="邀请返现"/);
assert.match(markup,/<button[^>]+open-type="contact"[^>]+aria-label="加客服拿好礼"/);
const cards=markup.slice(markup.indexOf('<view class="home-promo-cards"'),markup.indexOf('<view wx:if="{{recommendations.length}}"'));
assert.doesNotMatch(cards,/<text|wx:if|promos|data-product-id/,'fixed cards contain all visible text and never depend on the home API');
for(const name of ['invite-cashback','customer-gift']) {
  assert.ok(fs.existsSync(path.join(mini,'assets/home',`${name}-frames-v261025.jpg`)));
  assert.ok(fs.existsSync(path.join(mini,'assets/home',`${name}-poster-v261025.jpg`)));
}
console.log(`PASS two JPG animations, static posters, native actions, no GIFs and resource package ${bytes} bytes`);
