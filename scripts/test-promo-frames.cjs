const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('../cloudfunctions/node_modules/sharp');
async function run() {
  const manifest=JSON.parse(fs.readFileSync('design/home-promos/animations/frame-manifest.json','utf8'));
  assert.equal(manifest.length,2);
  for(const promo of manifest) {
  const source = `design/home-promos/animations/${promo.name}-source.webp`;
  const metadata = await sharp(source,{animated:true}).metadata();
  assert.equal(metadata.pages,35);assert.equal(metadata.width,256);assert.equal(metadata.pageHeight,256);
  assert.equal(metadata.delay.reduce((a,b)=>a+b,0),2500);
  const file=`miniprogram/assets/home/${promo.file}`;
  assert.ok(Math.abs(fs.statSync(file).size/promo.originalGifBytes-1)<0.05,'keep each JPG within 5% of its original GIF size');
  const encodedMetadata=await sharp(file).metadata();
  assert.equal(encodedMetadata.format,'jpeg');
  assert.equal(encodedMetadata.chromaSubsampling,'4:2:0');
  const {data:atlas,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,metadata.width*7);assert.equal(info.height,metadata.pageHeight*5);
  const css=fs.readFileSync('miniprogram/assets/components/static-image/promo-frames.wxss','utf8').split(`@keyframes ${promo.key}-promo-frames {`)[1].split('\n}')[0];
  const keyframes=Array.from(css.matchAll(/([\d.]+)% \{ transform: translate\(([-\d.]+)%, ([-\d.]+)%\); \}/g));
  assert.equal(keyframes.length,metadata.pages+1);
  let elapsed=0;
  let worstRmse=0;
  for(let frame=0;frame<metadata.pages;frame++) {
    const decoded=await sharp(source,{page:frame}).ensureAlpha().raw().toBuffer();
    let squaredError=0;
    for(let row=0;row<metadata.pageHeight;row++) {
      const offset=((Math.floor(frame/7)*metadata.pageHeight+row)*info.width+(frame%7)*metadata.width)*4;
      for(let column=0;column<metadata.width;column++) {
        const reference=(row*metadata.width+column)*4, actual=offset+column*4;
        for(let channel=0;channel<3;channel++) squaredError+=(atlas[actual+channel]-decoded[reference+channel])**2;
        assert.equal(atlas[actual+3],255,'JPEG frames stay opaque');
      }
    }
    const rmse=Math.sqrt(squaredError/(metadata.width*metadata.pageHeight*3));
    assert.ok(rmse<15,`frame ${frame}: JPEG quality unexpectedly low (${rmse})`);
    worstRmse=Math.max(worstRmse,rmse);
    const [,time,x,y]=keyframes[frame].map(Number);
    assert.ok(Math.abs(time-elapsed/2500*100)<0.000001);
    assert.ok(Math.abs(x+(frame%7)/7*100)<0.000001);
    assert.ok(Math.abs(y+Math.floor(frame/7)/5*100)<0.000001);
    elapsed+=metadata.delay[frame];
  }
  assert.deepEqual(keyframes.at(-1).slice(1).map(Number),[100,0,0]);
  const poster=await sharp(`miniprogram/assets/home/${promo.name}-poster-v261025.jpg`).metadata();
  assert.equal(poster.width,256);assert.equal(poster.height,256);assert.equal(poster.format,'jpeg');
  let definition, visibility, disconnected=false;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/assets/components/static-image/index.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText,{Component(value){definition=value;}});
  const changes=[];
  const instance={...definition.methods,data:{asset:promo.name,framesReady:false,framesPlaying:false},
    setData(value){Object.assign(this.data,value);changes.push(value);},
    createIntersectionObserver(){return{relativeToViewport(){return this;},
      observe(selector,callback){assert.equal(selector,'.promo-frame-window');visibility=callback;},
      disconnect(){disconnected=true;}};},
  };
  definition.lifetimes.attached.call(instance);definition.lifetimes.ready.call(instance);
  visibility({intersectionRatio:1});assert.equal(instance.data.framesPlaying,false,'wait for the static image to load');
  instance.onFrameLoad();assert.equal(instance.data.framesPlaying,true);
  const changeCount=changes.length;
  visibility({intersectionRatio:1});assert.equal(changes.length,changeCount,'no repeated bridge updates for the same visibility');
  visibility({intersectionRatio:0});assert.equal(instance.data.framesPlaying,false);
  visibility({intersectionRatio:1});assert.equal(instance.data.framesPlaying,true);
  definition.pageLifetimes.hide.call(instance);assert.equal(instance.data.framesPlaying,false);
  definition.pageLifetimes.show.call(instance);assert.equal(instance.data.framesPlaying,true);
  instance.onFrameError();assert.equal(instance.data.framesReady,false);assert.equal(instance.data.framesPlaying,false);assert.equal(disconnected,true);
  instance.onFrameLoad();assert.equal(instance.data.framesReady,false,'a late load cannot undo fallback');
  definition.lifetimes.detached.call(instance);const afterDetach=changes.length;
  visibility({intersectionRatio:1});instance.onFrameLoad();instance.onFrameError();assert.equal(changes.length,afterDetach);
  const markup=fs.readFileSync('miniprogram/assets/components/static-image/index.wxml','utf8');
  assert.doesNotMatch(markup,/<canvas\b/,'no native overlay that can drift during scroll');
  assert.doesNotMatch(markup,/\.gif\b/,'no runtime GIF or GIF fallback');
  assert.match(markup,/animation-play-state/);
  assert.ok(markup.includes(promo.file));
  console.log(`PASS ${promo.name}: 35 frames, worst RGB RMSE ${worstRmse.toFixed(3)}, original-size JPG, exact delays, loop, visibility/page pause, static fallback and no Canvas/GIF`);
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
