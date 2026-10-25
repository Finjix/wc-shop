const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../cloudfunctions/node_modules/sharp');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
function gifInfo(file) {
  const b=fs.readFileSync(file);
  assert.match(b.toString('ascii',0,6),/^GIF8[79]a$/);
  const width=b.readUInt16LE(6),height=b.readUInt16LE(8);
  const colors=b[10]&128 ? 2**((b[10]&7)+1) : 0;
  let i=13+colors*3,frames=0,delay=0,duration=0,loop,firstTransparent;
  function blocks() { const chunks=[];while(b[i]) {const length=b[i++];chunks.push(b.subarray(i,i+length));i+=length;}i++;return Buffer.concat(chunks); }
  while(i<b.length) {
    const kind=b[i++];
    if(kind===0x3b) break;
    if(kind===0x21) {
      const type=b[i++];
      if(type===0xf9) {assert.equal(b[i++],4);if(firstTransparent===undefined)firstTransparent=!!(b[i]&1);delay=b.readUInt16LE(i+1);i+=5;}
      else if(type===0xff) {const n=b[i++],name=b.toString('ascii',i,i+n);i+=n;const v=blocks();if(name==='NETSCAPE2.0')loop=v.readUInt16LE(1);}
      else blocks();
    } else if(kind===0x2c) {
      const packed=b[i+8];i+=9;if(packed&128)i+=3*2**((packed&7)+1);i++;blocks();frames++;duration+=delay;
    } else throw new Error(`Unexpected GIF block ${kind}`);
  }
  return {width,height,colors,frames,duration,loop,firstTransparent};
}
async function run() {
  let bytes=0;
  for(const name of ['invite-cashback','customer-gift']) {
    const file=path.join(root,'design/home-promos/animations',`${name}.gif`);
    const info=gifInfo(file);
    assert.deepEqual(info,{width:256,height:256,colors:128,frames:35,duration:250,loop:0,firstTransparent:false});
    const first=await sharp(file,{page:0}).ensureAlpha().raw().toBuffer();
    const middle=await sharp(file,{page:15}).ensureAlpha().raw().toBuffer();
    assert.notDeepEqual(first,middle,`${name}: animation must change visibly`);
    for(let p=3;p<first.length;p+=4) assert.equal(first[p],255,`${name}: opaque canvas`);
    if(name==='invite-cashback') for(const frame of [0,9,18,27]) {
      const pixels=await sharp(file,{page:frame}).ensureAlpha().raw().toBuffer();
      const scale=info.width/512;
      for(let y=Math.floor(151*scale);y<Math.ceil(160*scale);y++) {
        let run=0;
        for(let x=Math.floor(55*scale);x<Math.ceil(455*scale);x++) {
          const at=(y*info.width+x)*4;
          run=pixels[at]<220&&pixels[at+1]<220&&pixels[at+2]<220 ? run+1 : 0;
          assert.ok(run<125*scale,`frame ${frame}: horizontal resize residue below the title`);
        }
      }
    }
    const atlasFile=path.join(mini,'assets/home',`${name}-frames-v261025.webp`);
    const atlas=await sharp(atlasFile).metadata();
    assert.equal(atlas.format,'webp');
    assert.equal(atlas.width,256*7);
    assert.equal(atlas.height,256*5);
    const timing=(await sharp(file,{animated:true}).metadata()).delay;
    const styles=fs.readFileSync(path.join(mini,'assets/components/static-image/promo-frames.wxss'),'utf8');
    assert.match(styles,/animation: promo-frames 2500ms steps\(1, end\) infinite/);
    let elapsed=0;
    for(let frame=0;frame<35;frame++) {
      const source=await sharp(file,{page:frame}).removeAlpha().raw().toBuffer();
      const tile=await sharp(atlasFile).extract({left:frame%7*256,top:Math.floor(frame/7)*256,width:256,height:256}).removeAlpha().raw().toBuffer();
      let error=0;
      for(let p=0;p<source.length;p++) error+=Math.abs(source[p]-tile[p]);
      assert(error/source.length<4,`${name}: sprite frame ${frame} differs from original (${error/source.length})`);
      const percent=Number((elapsed/2500*100).toFixed(6));
      const x=Number((-(frame%7)/7*100).toFixed(6));
      const y=Number((-Math.floor(frame/7)/5*100).toFixed(6));
      assert(styles.includes(`${percent}% { transform: translate3d(${x}%, ${y}%, 0); }`),`${name}: frame ${frame} keeps its original display time and position`);
      elapsed+=timing[frame];
    }
    console.log(`PASS ${name}: all 35 original frames/timings preserved in a 7x5 WebP atlas, 2.5-second CSS loop`);
  }
  bytes+=fs.readdirSync(path.join(mini,'assets/home')).reduce((sum,name)=>sum+fs.statSync(path.join(mini,'assets/home',name)).size,0);
  bytes+=fs.statSync(path.join(mini,'assets/user/default-avatar.jpg')).size;
  bytes+=fs.readdirSync(path.join(mini,'assets/components/static-image')).reduce((sum,name)=>sum+fs.statSync(path.join(mini,'assets/components/static-image',name)).size,0);
  assert.ok(bytes<2*1024*1024,`resource package exceeds 2 MiB: ${bytes}`);
  const component=fs.readFileSync(path.join(mini,'assets/components/static-image/index.wxml'),'utf8');
  assert.doesNotMatch(component,/\.gif/, 'runtime animation must not depend on native GIF decoding');
  assert.match(component,/promo-frame-window/);
  assert.match(component,/class="promo-frame-sheet"/);
  assert.doesNotMatch(fs.readFileSync(path.join(mini,'assets/components/static-image/index.ts'),'utf8'),/setInterval|setTimeout/);
  const markup=fs.readFileSync(path.join(mini,'pages/home/home.wxml'),'utf8');
  assert.match(markup,/<button[^>]+bind:tap="showInviteComingSoon"[^>]+aria-label="邀请返现"/);
  assert.match(markup,/<button[^>]+open-type="contact"[^>]+aria-label="加客服拿好礼"/);
  const cards=markup.slice(markup.indexOf('<view class="home-promo-cards"'),markup.indexOf('<view wx:if="{{recommendations.length}}"'));
  assert.doesNotMatch(cards,/<text|wx:if|promos|data-product-id/,'fixed GIF cards contain all visible text and never depend on the home API');
  console.log(`PASS fixed native actions, no separate text, and resource package ${bytes} bytes`);
}
run().catch(error=>{console.error(error);process.exitCode=1;});
