import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,fitViewport} from './game.js';

function event(type,fields={}){const value=new Event(type,{cancelable:true});for(const [name,data] of Object.entries(fields))Object.defineProperty(value,name,{value:data});return value;}
function fixture(mode='online',initial={}){
 const previousWindow=globalThis.window,win=new EventTarget(),doc=new EventTarget(),canvas=new EventTarget(),sent=[];globalThis.window=win;
 let measurements=0,requests=0,rect={left:20,top:40,width:1200,height:700,...initial};
 Object.assign(canvas,{ownerDocument:doc,getContext:()=>null,getBoundingClientRect:()=>{measurements++;return {...rect};},requestPointerLock(){requests++;throw new Error('Pointer lock must never be requested.');}});
 const game=new Game(canvas,{mode,onInput:input=>sent.push(input)});game.state.kickoff=null;game.bind();
 return {game,win,doc,canvas,sent,get measurements(){return measurements;},get requests(){return requests;},resize(value){Object.assign(rect,value);},close(){game.stop();if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}};
}
const own=f=>{const p=f.game.localPlayer();Object.assign(p,{x:400,y:350});f.game.setOwner(p);return p;};

test('free absolute mouse aiming follows the ordinary pointer without requesting lock or using relative movement',()=>{
 const f=fixture('guest');try{
  f.canvas.dispatchEvent(event('pointermove',{pointerType:'mouse',clientX:850,clientY:200,movementX:-999,movementY:999}));
  assert.deepEqual(f.game.localInput.aim,{x:830,y:160});
  f.doc.dispatchEvent(event('mousemove',{movementX:200,movementY:-200}));assert.deepEqual(f.game.localInput.aim,{x:830,y:160});
  assert.equal(f.requests,0);assert.equal(f.game.requestCursorLock,undefined);assert.equal(f.game.isCursorLocked,undefined);assert.equal(f.game.unlockCursor,undefined);
  f.game.flushAimInput(0);assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0].aim,{x:830,y:160});
 }finally{f.close();}
});

test('pointer mapping exactly follows the visible aspect-fit pitch and clamps every letterboxed edge',()=>{
 for(const [width,height] of [[375,667],[1920,1080],[2200,500],[500,1600]]){
  const f=fixture('guest',{left:37,top:91,width,height});try{
   const view=fitViewport(width,height),point=(x,y)=>({clientX:37+view.x+x*view.scale,clientY:91+view.y+y*view.scale});
   for(const [x,y] of [[0,0],[1200,700],[600,350],[170,520]]){f.canvas.dispatchEvent(event('pointermove',point(x,y)));assert.ok(Math.abs(f.game.localInput.aim.x-x)<1e-8);assert.ok(Math.abs(f.game.localInput.aim.y-y)<1e-8);}
   f.canvas.dispatchEvent(event('pointermove',{clientX:0,clientY:0}));assert.deepEqual(f.game.localInput.aim,{x:0,y:0});
   f.canvas.dispatchEvent(event('pointermove',{clientX:5000,clientY:5000}));assert.deepEqual(f.game.localInput.aim,{x:1200,y:700});
  }finally{f.close();}
 }
});

test('hidden or invalid canvas dimensions preserve a finite last aim until layout returns',()=>{
 const f=fixture('guest');try{
  const aim={...f.game.localInput.aim};
  for(const [width,height] of [[0,700],[1200,0],[NaN,700],[-1200,700],[Infinity,700]]){
   f.resize({width,height});assert.deepEqual(f.game.pointerToPitch(900,300,true),aim);
  }
  f.resize({width:1200,height:700});assert.deepEqual(f.game.pointerToPitch(900,300,true),{x:880,y:260});
 }finally{f.close();}
});

test('1,000 mouse moves update aim immediately with at most thirty aim packets and one layout read',()=>{
 const f=fixture('guest');try{
  for(let i=0;i<1000;i++){f.canvas.dispatchEvent(event('pointermove',{pointerType:'mouse',clientX:20+i,clientY:390}));f.game.flushAimInput(i);}
  assert.ok(f.sent.length<=30);assert.equal(f.game.localInput.aim.x,999);assert.equal(f.measurements,1);
  const before=f.sent.length;f.game.startShot();f.game.releaseShot();f.game.useAction();
  assert.equal(f.sent.length,before+3);assert.equal(f.sent.at(-2).shootRelease,true);assert.equal(f.sent.at(-1).action,true);
  f.game.flushAimInput(1040);assert.equal(f.sent.length,before+3);assert.equal(f.requests,0);
 }finally{f.close();}
});

test('mouse press and release each refresh canvas layout and release toward the latest point without a move event',()=>{
 const f=fixture();try{
  const p=own(f);f.canvas.dispatchEvent(event('pointermove',{clientX:500,clientY:200}));assert.equal(f.measurements,1);
  f.resize({left:100,top:80,width:600,height:350});
  f.canvas.dispatchEvent(event('pointerdown',{pointerType:'mouse',button:0,clientX:600,clientY:130}));f.game.update(.01);
  assert.deepEqual(f.game.localInput.aim,{x:1000,y:100});assert.equal(f.measurements,2);
  f.win.dispatchEvent(event('pointerup',{pointerType:'mouse',button:0,clientX:600,clientY:330}));f.game.update(.01);
  assert.deepEqual(p.aim,{x:1000,y:500});assert.equal(f.measurements,3);assert.equal(p.shotsTaken,1);assert.ok(f.game.state.ball.vy>0);assert.equal(f.requests,0);
 }finally{f.close();}
});

test('a held mouse shot continues aiming outside the canvas, then releases once at the clamped edge',()=>{
 const f=fixture();try{
  const p=own(f);f.canvas.dispatchEvent(event('pointerdown',{pointerType:'mouse',button:0,clientX:900,clientY:300}));f.game.update(.01);
  f.win.dispatchEvent(event('pointermove',{pointerType:'mouse',clientX:1600,clientY:900}));assert.deepEqual(f.game.localInput.aim,{x:1200,y:700});
  f.win.dispatchEvent(event('pointerup',{pointerType:'mouse',clientX:1600,clientY:900}));f.game.update(.01);
  f.win.dispatchEvent(event('pointerup',{pointerType:'mouse',clientX:1600,clientY:900}));f.game.update(.01);
  assert.equal(p.shotsTaken,1);assert.equal(p.shotType,'normal');assert.equal(f.game.mouseShotActive,false);
 }finally{f.close();}
});

test('blur, pointer cancellation and menus cancel charge and movement without kicking or spending Ultra',()=>{
 for(const cancel of ['blur','pointercancel','menu']){
  const f=fixture();try{
   const p=own(f);p.ultraCharge=3;f.game.localInput.keys={w:true};f.canvas.dispatchEvent(event('pointerdown',{pointerType:'mouse',button:0,clientX:900,clientY:300}));f.game.update(.1);
   if(cancel==='menu')f.game.suspendControls();else f.win.dispatchEvent(new Event(cancel));
   f.win.dispatchEvent(event('pointerup',{pointerType:'mouse',clientX:900,clientY:300}));f.game.update(.01);
   assert.deepEqual(f.game.localInput.keys,{});assert.equal(p.charging,false);assert.equal(f.game.localInput.shootHeld,false);assert.equal(f.game.hasBall(p),true);assert.equal(p.shotsTaken,0);assert.equal(p.ultraCharge,3);assert.equal(f.sent.at(-1).cancelShot,true);
  }finally{f.close();}
 }
});

test('Control and L no longer capture the pointer, and browser shortcuts keep their normal actions',()=>{
 for(const key of ['l','f','w','1','+','t'])for(const modifier of ['ctrlKey','metaKey','altKey']){
  const f=fixture();try{
   const events=[event('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true}),event('keyup',{key:'Control',code:'ControlLeft'}),event('keydown',{key:'l',code:'KeyL'}),event('keyup',{key:'l',code:'KeyL'}),event('keydown',{key,[modifier]:true}),event('keyup',{key,[modifier]:true})];
   for(const e of events)f.win.dispatchEvent(e);
   assert.equal(f.requests,0);assert.equal(f.game.localInput.shootHeld,false);assert.deepEqual(f.game.localInput.keys,{});assert.ok(events.every(e=>!e.defaultPrevented));
  }finally{f.close();}
 }
});

test('normal F, Q, movement and skill controls remain active while editable fields and repeat actions are ignored',()=>{
 const f=fixture('guest');try{
  const p=own(f);p.ultraCharge=3;p.character='manmarker';
  for(const key of ['q','c','e','1'])f.win.dispatchEvent(event('keydown',{key}));
  assert.equal(f.sent.filter(input=>input.pass).length,1);assert.equal(f.sent.filter(input=>input.action).length,1);assert.equal(f.sent.filter(input=>input.awaken).length,1);assert.equal(f.sent.filter(input=>input.skill===1).length,1);
  const before=f.sent.length;f.win.dispatchEvent(event('keydown',{key:'1',repeat:true}));f.win.dispatchEvent(event('keydown',{key:'f',target:{tagName:'INPUT'}}));assert.equal(f.sent.length,before);
  f.win.dispatchEvent(event('keydown',{key:'f',code:'KeyF'}));assert.equal(f.game.localInput.ultraShot,true);
  f.win.dispatchEvent(event('keyup',{key:'f',code:'KeyF'}));assert.equal(f.sent.at(-1).shootRelease,true);assert.equal(f.sent.at(-1).ultraShot,true);
  f.win.dispatchEvent(event('keydown',{key:'ArrowUp',code:'ArrowUp'}));assert.equal(f.game.localInput.keys.w,true);f.win.dispatchEvent(event('keyup',{key:'ArrowUp',code:'ArrowUp',ctrlKey:true}));assert.equal(f.game.localInput.keys.w,false);
 }finally{f.close();}
});

test('a cancellation edge still clears a queued authoritative release',()=>{
 const value=new Game(null,{mode:'online'}),p=value.state.players[1];value.state.kickoff=null;value.setOwner(p);value.setInput(1,{shootHeld:true});value.update(.01);value.setInput(1,{shootHeld:false,shootRelease:true});
 assert.ok(value.pending[1].some(([kind])=>kind==='shoot'));value.setInput(1,{keys:{},shootHeld:false,cancelShot:true});value.update(.01);assert.equal(value.hasBall(p),true);assert.equal(p.shotsTaken,0);
});

test('stopping removes all pointer and keyboard listeners without touching browser lock services',()=>{
 const f=fixture('guest');try{
  f.game.stop();assert.equal(f.game.handlers.length,0);const before={...f.game.localInput.aim},count=f.sent.length;
  f.canvas.dispatchEvent(event('pointermove',{clientX:500,clientY:500}));f.canvas.dispatchEvent(event('pointerdown',{pointerType:'mouse',button:0,clientX:500,clientY:500}));f.win.dispatchEvent(event('keydown',{key:'f'}));
  assert.deepEqual(f.game.localInput.aim,before);assert.equal(f.sent.length,count);assert.equal(f.requests,0);
 }finally{f.close();}
});
