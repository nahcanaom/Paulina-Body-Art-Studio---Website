const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/js/admin-editweb.js','utf8');
(async()=>{for(const [name,tab,key] of [['Gallery','gallery','images'],['Catalogue','catalogue','items']]){
const start=source.indexOf(`async function loadAdmin${name}(`),end=source.indexOf('\nfunction ',start);
let resolve,calls=0,spinners=0,renders=0,fail=false;
const state={loaded:{},[tab]:[]};
const context={state,[tab+'Loading']:false,galleryLoadRequest:0,GALLERY_API:'gallery',CATALOGUE_API:'catalogue',JSON,
setContentStatus(){},showGridLoading(){spinners++;},showGridError(){},friendlyError:x=>x.message,byId:()=>({classList:{add(){}}}),
['normalize'+name]:x=>x,['render'+name]:()=>renders++,apiRequest:()=>{calls++;return new Promise((yes,no)=>{resolve=()=>fail?no(Error('timeout')):yes({[key]:[{id:'1',displayOrder:0}]});});}};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
let request=context['loadAdmin'+name]();await context['loadAdmin'+name](true,true);assert.equal(calls,1);resolve();await request;assert.equal(spinners,1);assert.equal(renders,1);
request=context['loadAdmin'+name](true,true);resolve();await request;assert.equal(spinners,1);assert.equal(renders,1);
fail=true;request=context['loadAdmin'+name](true,true);resolve();await request;assert.equal(state[tab].length,1);assert.equal(state.loaded[tab+'-tab'],true);
fail=false;request=context['loadAdmin'+name](true,true);resolve();await request;assert.equal(calls,4);
} console.log('Admin refresh checks passed: no overlapping reads, no background spinners or unchanged redraws, failed refresh retains content and can retry.');})().catch(e=>{console.error(e);process.exitCode=1;});
