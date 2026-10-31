const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const events = [];
let choose;
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/common/ui/control.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, {exports:exportsObject,wx:{chooseMedia(options){choose=options;},showToast(){},arrayBufferToBase64(buffer){return Buffer.from(buffer).toString('base64');},getWindowInfo:()=>({statusBarHeight:24}),getMenuButtonBoundingClientRect:()=>({top:28,height:32,left:280})},Uint8Array});
function instance(kind, patch={}) {
 const d=exportsObject.control(kind);const data={...structuredClone(d.data)};
 for(const [key,value] of Object.entries(d.properties)){data[key]=typeof value==='function'?(value===Boolean?false:value===Number?0:''):value.value??null;}
 return {...d.methods,data:{...data,...patch},setData(p){Object.assign(this.data,p);},triggerEvent(name,detail){events.push({name,detail});}};
}
const button=instance('button');button.tapButton({detail:{}});assert.equal(events.pop().name,'tap');button.data.disabled=true;const count=events.length;button.tapButton({detail:{}});assert.equal(events.length,count);
const field=instance('input');field.input({detail:{value:'测试'}});assert.equal(events.pop().detail.value,'测试');assert.equal(field.data.value,'测试');
const textArea=instance('textarea');textArea.input({detail:{value:'多行\n评价内容'}});assert.equal(textArea.data.value,'多行\n评价内容');assert.equal(events.pop().detail.value,'多行\n评价内容');
const {measureControlLayout}=exportsObject;
const phoneLayout=measureControlLayout({statusBarHeight:47,windowWidth:375,windowHeight:812},{top:51,height:32,left:278},88);
assert.equal(phoneLayout.statusHeight+phoneLayout.navHeight+88*375/750+phoneLayout.scrollHeight,812);
assert.ok(375/2+phoneLayout.titleWidth/2<278,'title stays clear of the system capsule');
const desktopLayout=measureControlLayout({statusBarHeight:0,windowWidth:320,windowHeight:600},{top:4,height:32,left:223});
assert.equal(desktopLayout.statusHeight,0,'zero status-bar height is valid');
assert.equal(desktopLayout.scrollHeight,556);
assert.equal(measureControlLayout({statusBarHeight:24,windowWidth:320,windowHeight:40},{top:28,height:32,left:223}).scrollHeight,0,'short viewports never produce a negative scroll height');
const quantity=instance('stepper',{value:2,min:1,max:3});quantity.changeQuantity({currentTarget:{dataset:{action:1}}});assert.equal(events.at(-2).detail.value,3);quantity.changeQuantity({currentTarget:{dataset:{}},detail:{value:999}});assert.equal(events.pop().detail.value,3);
const area=instance('cascader',{areaColumns:[[{label:'省',value:'p',children:[{label:'市',value:'c',children:[{label:'区',value:'d'}]}]}]],selectedArea:[]});
for(let column=0;column<3;column++)area.chooseArea({currentTarget:{dataset:{column,index:0}}});assert.equal(events.at(-1).detail.selectedOptions.length,3);assert.equal(events.at(-1).detail.value,'d');
const upload=instance('upload',{files:[],max:3,sizeLimit:100});upload.chooseFiles();assert.equal(choose.count,3);choose.success({tempFiles:[{tempFilePath:'wxfile://a.png',size:50}]});assert.equal(events.findLast(e=>e.name==='success').detail.files[0].url,'wxfile://a.png');upload.removeFile({currentTarget:{dataset:{index:0}}});assert.equal(events.pop().detail.index,0);
const popup=instance('popup');popup.close();assert.equal(events.at(-2).detail.visible,false);assert.equal(events.at(-1).name,'close');
const dialog=instance('dialog',{visible:true});let confirmed=false;dialog._onConfirm=()=>{confirmed=true;};dialog.confirm();assert.equal(confirmed,true);assert.equal(dialog.data.visible,false);
const icon=instance('icon');icon.updateIcon('home','#695941');assert.ok(icon.data.iconSource.startsWith('data:image/svg+xml;base64,'));
const tabs=instance('tabs');tabs.getRelationNodes=()=>[{data:{value:1,label:'待发货'}},{data:{value:2,label:'已发货'}}];tabs.updateTabs();tabs.selectTab({currentTarget:{dataset:{index:1}}});assert.equal(events.pop().detail.value,2);
for (const file of ['package.json','admin/package.json']) { const p=JSON.parse(fs.readFileSync(file,'utf8'));assert(!Object.keys({...p.dependencies,...p.devDependencies}).some(name=>name.includes('tdesign'))); }
assert(!fs.existsSync('miniprogram/components/tdesign'));
console.log('PASS owned native controls: disabled actions, input events, quantity limits, full three-level selection, upload/remove, popup/dialog, icons, tabs and no vendor dependencies');
