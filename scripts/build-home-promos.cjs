const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const sharp = require('../cloudfunctions/node_modules/sharp');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'design/home-promos');
const output = path.join(source, 'animations');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const gifsicle = process.env.GIFSICLE || 'gifsicle';
const FPS = 14;
const FRAMES = 35;
const DURATION = FRAMES / FPS;
const OUTPUT_SIZE = 256;
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `${command} exited ${result.status}: ${result.stderr}`);
}

function particles(frame, peach) {
  const angle = frame / FRAMES * Math.PI * 2;
  const positions = [[28,165],[480,190],[40,340],[470,350],[100,460],[400,465],[34,265],[478,270],[160,160],[350,145],[220,480],[290,28],[78,30],[430,100],[80,400],[450,430]];
  const colors = peach ? ['#D9937D', '#B9A2BF', '#F4B89C'] : ['#D5AF64', '#B8995C', '#EDCF8C'];
  const shapes = positions.map(([baseX,baseY], i) => {
    const x = peach ? (baseX-frame/FRAMES*512+512)%512 : baseX + 12*Math.sin(angle + i*1.7);
    const y = peach ? (baseY+frame/FRAMES*512)%512 : baseY + 20*Math.cos(angle + i*1.3);
    const radius = 4 + (i%3)*1.3;
    const opacity = 0.5 + 0.4 * (0.5 + 0.5*Math.sin(angle+i));
    const color = colors[i%colors.length];
    if (peach) {
      const points = Array.from({length:10},(_,point) => {
        const a=-Math.PI/2+point*Math.PI/5;
        const r=radius*(point%2 ? 0.45 : 1.35);
        return `${x+Math.cos(a)*r},${y+Math.sin(a)*r}`;
      }).join(' ');
      return `<path d="M ${x+7} ${y-7} l 12 -12" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="${opacity*0.22}"/><polygon points="${points}" fill="${color}" opacity="${opacity}"/>`;
    }
    if (!peach && i%3 === 0) return `<path d="M ${x} ${y-radius*2} Q ${x} ${y} ${x+radius*2} ${y} Q ${x} ${y} ${x} ${y+radius*2} Q ${x} ${y} ${x-radius*2} ${y} Q ${x} ${y} ${x} ${y-radius*2}" fill="${color}" opacity="${opacity}"/>`;
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" fill-opacity="${peach ? 0.4 : 1}" stroke="${color}" stroke-width="${peach ? 1.3 : 0}" opacity="${opacity}"/>`;
  }).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${shapes}</svg>`);
}

function highlights(frame, peach) {
  const angle = frame / FRAMES * Math.PI * 2;
  const bounce = 0;
  const glow = Math.pow(Math.max(0, Math.cos(angle)), 3);
  const star = (x,y,radius,opacity,color) => `<g opacity="${opacity}"><circle cx="${x}" cy="${y}" r="${radius*1.5}" fill="${color}" opacity="0.13"/><path d="M ${x} ${y-radius} Q ${x} ${y} ${x+radius} ${y} Q ${x} ${y} ${x} ${y+radius} Q ${x} ${y} ${x-radius} ${y} Q ${x} ${y} ${x} ${y-radius}" fill="${color}"/></g>`;
  let shapes;
  if (peach) {
    shapes = star(167,110+bounce,14,0.2+0.8*glow,'#FFFDF6') + star(345,242+bounce,12,1-glow,'#FFFDF6');
    for (let i=0;i<7;i++) {
      const a = i/7*Math.PI*2;
      const radius = 177 + 5*Math.sin(angle);
      const x=256+radius*Math.cos(a),y=205+radius*Math.sin(a);
      shapes += `<path d="M ${x} ${y} l ${9*Math.cos(a)} ${9*Math.sin(a)}" stroke="#D9937D" stroke-width="3" stroke-linecap="round" opacity="${0.15+glow*0.6}"/>`;
    }
  } else {
    const shineX=280+180*(frame/FRAMES);
    shapes = `<defs><linearGradient id="shine"><stop stop-color="white" stop-opacity="0"/><stop offset="0.5" stop-color="white" stop-opacity="0.55"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><clipPath id="coin"><ellipse cx="354" cy="${318+bounce}" rx="58" ry="85"/></clipPath></defs><g clip-path="url(#coin)" opacity="${Math.sin(frame/FRAMES*Math.PI)}"><path d="M ${shineX} ${220+bounce} l 42 0 -45 220 -42 0 Z" fill="url(#shine)"/></g>`;
    shapes += star(390,265+bounce,18,0.15+0.85*glow,'#FFFDF0') + star(160,260+bounce,12,0.2+0.8*(1-glow),'#FFFDF0');
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${shapes}</svg>`);
}

// Smooth inverse mapping makes the bow and ribbon flutter without cutting the sprite into rectangles.
function flutterRibbon({data,info}, angle) {
  const {width,height,channels}=info;
  const warped=Buffer.alloc(data.length);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const bow=Math.exp(-Math.pow((y-85)/72,4));
    const tails=Math.exp(-Math.pow((x-125)/42,2)-Math.pow((y-175)/65,2)) + Math.exp(-Math.pow((x-275)/45,2)-Math.pow((y-160)/65,2));
    const ribbon=Math.exp(-Math.pow((x-195)/24,2)-Math.pow((y-260)/100,4));
    const sx=x-4*Math.sin(angle+y*0.025)*bow-2.5*Math.sin(angle+0.8)*tails-1.5*Math.sin(angle+y*0.025)*ribbon;
    const sy=y-1.8*Math.cos(angle)*bow-2*Math.cos(angle+1)*tails;
    const left=Math.floor(sx),top=Math.floor(sy),fx=sx-left,fy=sy-top;
    if(left<0||top<0||left+1>=width||top+1>=height) continue;
    for(let c=0;c<channels;c++) {
      const at=(top*width+left)*channels+c;
      warped[(y*width+x)*channels+c]=Math.round(data[at]*(1-fx)*(1-fy)+data[at+channels]*fx*(1-fy)+data[at+width*channels]*(1-fx)*fy+data[at+(width+1)*channels]*fx*fy);
    }
  }
  return sharp(warped,{raw:info}).png().toBuffer();
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-shop-promos-'));
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const [name, input, backdrop, peach] of [
      ['invite-cashback', 'coins.png', 'invite-background.png', false],
      ['customer-gift', 'gift.png', 'gift-background.png', true],
    ]) {
      if (process.argv[2] && process.argv[2] !== name) continue;
      const particleDir = path.join(temporary, name);
      fs.mkdirSync(particleDir);
      const giftPixels=peach ? await sharp(path.join(source,input)).resize(390,390).blur(0.55).ensureAlpha().raw().toBuffer({resolveWithObject:true}) : null;
      const glyphs=[];
      if(peach) {
        const atlas=path.join(source,'gift-glyphs.png');
        const meta=await sharp(atlas).metadata();
        for(let i=0;i<6;i++) {
          const left=Math.floor(i%3*meta.width/3);
          // 客's shadow crosses the atlas row seam above 好. Exclude that seam before trimming.
          const top=Math.floor(Math.floor(i/3)*meta.height/2)+(i===4 ? Math.round(meta.height/2*0.08) : 0);
          const width=Math.floor((i%3+1)*meta.width/3)-left,height=Math.floor((Math.floor(i/3)+1)*meta.height/2)-top;
          const cell=await sharp(atlas).extract({left,top,width,height}).png().toBuffer();
          glyphs.push(await sharp(cell).trim({background:'#00000000',threshold:8}).resize({width:68,height:84,fit:'inside'}).png().toBuffer({resolveWithObject:true}));
        }
      } else {
        const atlas=path.join(source,'invite-glyphs.png');
        const meta=await sharp(atlas).metadata();
        const width=Math.floor(meta.width/2);
        // The top row's bevel extends below the geometric midpoint; split in the empty row gap.
        const rowBoundary=Math.round(meta.height*0.515625);
        for(let i=0;i<4;i++) {
          const top=i<2 ? 0 : rowBoundary,height=i<2 ? rowBoundary : meta.height-rowBoundary;
          const cell=await sharp(atlas).extract({left:i%2*width,top,width,height}).png().toBuffer();
          glyphs.push(await sharp(cell).trim({background:'#00000000',threshold:8}).resize({width:82,height:100,fit:'inside'}).png().toBuffer({resolveWithObject:true}));
        }
      }
      for (let frame=0;frame<FRAMES;frame++) {
        const angle=frame/FRAMES*Math.PI*2;
        const iconWidth=peach ? 390 : 440;
        const art=peach ? await flutterRibbon(giftPixels,angle) : await sharp(path.join(source,input)).resize(iconWidth,iconWidth).blur(0.55).png().toBuffer();
        const iconX=Math.round((512-iconWidth)/2);
        const iconY=peach ? 18 : 88;
        const canvas=()=>sharp({create:{width:512,height:512,channels:4,background:'#00000000'}});
        await canvas().composite([{input:art,left:iconX,top:iconY}]).png().toFile(path.join(particleDir,`art-${String(frame).padStart(3,'0')}.png`));
        const lettering=[];
        if(peach) {
          for(let i=0;i<6;i++) {
            const scale=1+0.18*Math.pow(Math.max(0,Math.cos(angle-i/6*Math.PI*2)),6);
            const glyph=await sharp(glyphs[i].data).resize({width:Math.round(glyphs[i].info.width*scale)}).png().toBuffer({resolveWithObject:true});
            lettering.push({input:glyph.data,left:Math.round(80+i*72-glyph.info.width/2),top:Math.round(434-glyph.info.height/2)});
          }
        } else {
          const t=frame/FRAMES;
          const smooth=x=>x*x*(3-2*x);
          const spread=t<0.1 ? 0 : t<0.4 ? smooth((t-0.1)/0.3) : t<0.55 ? 1 : t<0.85 ? 1-smooth((t-0.55)/0.3) : 0;
          for(let i=0;i<4;i++) {
            const glyph=glyphs[i];
            lettering.push({input:glyph.data,left:Math.round(256+(i-1.5)*(80+28*spread)-glyph.info.width/2),top:Math.round(98-glyph.info.height/2)});
          }
        }
        await canvas().composite(lettering).png().toFile(path.join(particleDir,`title-${String(frame).padStart(3,'0')}.png`));
        await sharp(particles(frame, peach)).png().toFile(path.join(particleDir, `${String(frame).padStart(3,'0')}.png`));
        await sharp(highlights(frame, peach)).png().toFile(path.join(particleDir, `fx-${String(frame).padStart(3,'0')}.png`));
      }
      const graph = '[0:v]scale=512:512,format=rgba[backdrop];' +
        '[backdrop][3:v]overlay=0:0:format=auto:shortest=1[background];' +
        '[background][1:v]overlay=0:0:format=auto:shortest=1[card];' +
        `[card][4:v]overlay=0:0:format=auto:shortest=1[litCard];` +
        '[litCard][2:v]overlay=0:0:format=auto:shortest=1,' +
        `scale=${OUTPUT_SIZE}:${OUTPUT_SIZE}:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:reserve_transparent=0[p];[b][p]paletteuse=dither=none`;
      const raw = path.join(temporary, `${name}.gif`);
      run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1',
        '-loop', '1', '-framerate', String(FPS), '-t', String(DURATION), '-i', path.join(source, backdrop),
        '-framerate', String(FPS), '-i', path.join(particleDir, 'art-%03d.png'),
        '-framerate', String(FPS), '-i', path.join(particleDir, 'title-%03d.png'),
        '-framerate', String(FPS), '-i', path.join(particleDir, '%03d.png'),
        '-framerate', String(FPS), '-i', path.join(particleDir, 'fx-%03d.png'),
        '-filter_complex', graph, '-frames:v', String(FRAMES), '-loop', '0', '-final_delay', '7', raw]);
      const destination=path.join(output,`${name}-source.webp`);
      const optimized=path.join(temporary,`${name}-optimized.gif`);
      const budget=peach ? 700000 : 500000;
      let lossiness;
      for(lossiness of [20,40,80,120,200]) {
        run(gifsicle, ['--colors', '128', `--lossy=${lossiness}`, '-O3', '-Okeep-empty', raw, '-o', optimized]);
        if(fs.statSync(optimized).size<=budget) break;
      }
      if(fs.statSync(optimized).size>budget) throw new Error(`${name}: ${fs.statSync(optimized).size} bytes exceeds the resource package budget`);
      await sharp(optimized,{animated:true}).webp({lossless:true,effort:6}).toFile(destination);
      console.log(`${name}: lossy=${lossiness}`);
      console.log(`${name}-source.webp: ${fs.statSync(destination).size} bytes`);
    }
  } finally {
    // Only remove the unique temporary directory created by this process.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
