import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from './game.js';

function event(type, fields={}) { const value=new Event(type,{cancelable:true});for(const [name,data] of Object.entries(fields))Object.defineProperty(value,name,{value:data});return value; }
function fixture(mode='online') {
 const previousWindow=globalThis.window, win=new EventTarget(), doc=new EventTarget(), canvas=new EventTarget(), sent=[],locks=[];
 globalThis.window=win;
 let measurements=0,requests=0;
 Object.assign(canvas,{ownerDocument:doc,getContext:()=>null,getBoundingClientRect:()=>{measurements++;return {left:20,top:40,width:1200,height:700};},requestPointerLock(){requests++;doc.pointerLockElement=canvas;doc.dispatchEvent(new Event('pointerlockchange'));}});
 doc.exitPointerLock=()=>{doc.pointerLockElement=null;doc.dispatchEvent(new Event('pointerlockchange'));};
 const game=new Game(canvas,{mode,onInput:input=>sent.push(input),onCursorLockChange:locked=>locks.push(locked)});game.state.kickoff=null;game.bind();
 return {game,win,doc,canvas,sent,locks,get measurements(){return measurements;},get requests(){return requests;},close(){game.stop();if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}};
}

test('real cursor-lock state uses relative document movement while ignoring duplicate absolute pointer events',()=>{
 const f=fixture('guest');try{
  assert.equal(f.game.requestCursorLock(),true);assert.equal(f.requests,1);assert.equal(f.game.isCursorLocked(),true);assert.deepEqual(f.locks,[true]);
  const origin={...f.game.localInput.aim};
  f.doc.dispatchEvent(event('mousemove',{movementX:-30,movementY:15,clientX:0,clientY:0}));
  assert.deepEqual(f.game.localInput.aim,{x:origin.x-30,y:origin.y+15});
  f.canvas.dispatchEvent(event('pointermove',{clientX:0,clientY:0}));
  assert.equal(f.game.localInput.aim.x,origin.x-30);assert.equal(f.sent.length,0);
  f.game.flushAimInput(0);assert.equal(f.sent.length,1);assert.equal(f.sent[0].aim.x,origin.x-30);
  f.game.requestCursorLock();assert.equal(f.requests,1,'an active lock is not requested again');
 }finally{f.close();}
});

test('1,000 mouse movements update aim immediately but use at most thirty aim packets and one layout read',()=>{
 const f=fixture('guest');try{
  for(let i=0;i<1000;i++){
   f.canvas.dispatchEvent(event('pointermove',{clientX:20+i,clientY:390}));
   f.game.flushAimInput(i);
  }
  assert.ok(f.sent.length<=30,`${f.sent.length} aim packets`);
  assert.equal(f.game.localInput.aim.x,999);assert.equal(f.measurements,1);
  const before=f.sent.length;f.game.startShot();f.game.releaseShot();f.game.useAction();
  assert.equal(f.sent.length,before+3,'presses, releases, and actions are sent immediately');
  assert.equal(f.sent.at(-2).shootRelease,true);assert.equal(f.sent.at(-1).action,true);
  f.game.flushAimInput(1040);assert.equal(f.sent.length,before+3,'an edge already includes the latest aim');
 }finally{f.close();}
});

test('unlocking or losing focus clears movement and cancels a charged shot without accidentally kicking it',()=>{
 const f=fixture();try{
  const p=f.game.state.players[0];f.game.setOwner(p);f.game.requestCursorLock();
  f.game.localInput.keys={w:true};f.game.startShot();f.game.update(.01);f.game.update(.1);assert.ok(p.charging);
  f.doc.exitPointerLock();assert.deepEqual(f.game.localInput.keys,{});assert.equal(p.charging,false);assert.equal(f.game.localInput.shootHeld,false);
  f.game.update(.1);assert.equal(f.game.hasBall(p),true);assert.equal(p.shotsTaken,0);assert.equal(f.sent.at(-1).cancelShot,true);assert.deepEqual(f.locks,[true,false]);
  f.game.requestCursorLock();f.game.localInput.keys={d:true};f.game.startShot();f.win.dispatchEvent(new Event('blur'));
  assert.equal(f.game.isCursorLocked(),false);assert.deepEqual(f.game.localInput.keys,{});assert.equal(f.game.hasBall(p),true);
 }finally{f.close();}
});

test('blocked Promise and unsupported cursor-lock requests recover gracefully and can be retried',async()=>{
 const f=fixture();try{
  f.canvas.requestPointerLock=()=>Promise.reject(new Error('blocked'));
  assert.equal(f.game.requestCursorLock(),true);await Promise.resolve();await Promise.resolve();
  assert.equal(f.game.cursorLockPending,false);assert.match(f.game.state.message,/blocked/);assert.equal(f.game.isCursorLocked(),false);
  f.canvas.requestPointerLock=()=>{f.doc.pointerLockElement=f.canvas;f.doc.dispatchEvent(new Event('pointerlockchange'));return Promise.resolve();};
  assert.equal(f.game.requestCursorLock(),true);assert.equal(f.game.isCursorLocked(),true);f.game.suspendControls();
  delete f.canvas.requestPointerLock;assert.equal(f.game.requestCursorLock(),false);assert.match(f.game.state.message,/unavailable/);
 }finally{f.close();}
});

test('clicking the pitch or pressing L requests lock, and stopping releases it and removes listeners',()=>{
 const f=fixture();try{
  f.canvas.dispatchEvent(event('pointerdown',{pointerType:'mouse',button:0}));assert.equal(f.game.isCursorLocked(),true);
  f.win.dispatchEvent(event('pointerup',{pointerType:'mouse'}));
  f.win.dispatchEvent(event('keydown',{key:'l',code:'KeyL'}));assert.equal(f.game.isCursorLocked(),false);
  f.win.dispatchEvent(event('keydown',{key:'l',code:'KeyL'}));assert.equal(f.game.isCursorLocked(),true);
  f.game.stop();assert.equal(f.game.isCursorLocked(),false);assert.equal(f.game.handlers.length,0);
  const before={...f.game.localInput.aim};f.doc.dispatchEvent(event('mousemove',{movementX:200,movementY:200}));assert.deepEqual(f.game.localInput.aim,before);
 }finally{f.close();}
});

test('a cancellation edge clears an already queued release on the authoritative host',()=>{
 const game=new Game(null,{mode:'online'}),p=game.state.players[1];game.state.kickoff=null;game.setOwner(p);
 game.setInput(1,{shootHeld:true});game.update(.01);game.setInput(1,{shootHeld:false,shootRelease:true});
 assert.ok(game.pending[1].some(([kind])=>kind==='shoot'));
 game.setInput(1,{keys:{},shootHeld:false,cancelShot:true});game.update(.01);
 assert.equal(game.hasBall(p),true);assert.equal(p.charging,false);assert.equal(p.shotsTaken,0);
});

test('late Promise or legacy cursor-lock grants are immediately released after stopping or opening a menu',async()=>{
 for(const legacy of [false,true])for(const stop of [false,true]){
  const f=fixture();try{
   let grant;f.canvas.requestPointerLock=()=>legacy?undefined:new Promise(resolve=>{grant=resolve;});
   f.game.requestCursorLock();assert.equal(f.game.cursorLockPending,true);
   if(stop)f.game.stop();else f.game.suspendControls();
   f.doc.pointerLockElement=f.canvas;f.doc.dispatchEvent(new Event('pointerlockchange'));grant?.();await Promise.resolve();await Promise.resolve();
   assert.equal(f.game.isCursorLocked(),false,`${legacy?'legacy':'promise'} / ${stop?'stop':'menu'}`);
   assert.equal(f.game.cursorLockPending,false);assert.equal(f.game.cursorLockGuard,null);
  }finally{f.close();}
 }
});

test('browser modifier shortcuts do not activate the cursor-lock shortcut',()=>{
 const f=fixture();try{
  const shortcut=event('keydown',{key:'l',code:'KeyL',metaKey:true});f.win.dispatchEvent(shortcut);
  assert.equal(f.requests,0);assert.equal(shortcut.defaultPrevented,false);
 }finally{f.close();}
});

test('tapping either Ctrl key toggles cursor lock on release while preserving the press for browser shortcuts',()=>{
 for(const code of ['ControlLeft','ControlRight']){
  const f=fixture();try{
   const down=event('keydown',{key:'Control',code,ctrlKey:true});f.win.dispatchEvent(down);
   assert.equal(f.requests,0,'a Ctrl press waits to distinguish a tap from a shortcut');assert.equal(down.defaultPrevented,false);
   const up=event('keyup',{key:'Control',code,ctrlKey:false});f.win.dispatchEvent(up);
   assert.equal(f.requests,1);assert.equal(f.game.isCursorLocked(),true);assert.equal(up.defaultPrevented,false);
   const p=f.game.state.players[0];f.game.setOwner(p);f.game.startShot();f.game.localInput.keys={w:true};
   f.win.dispatchEvent(event('keydown',{key:'Control',code,ctrlKey:true}));f.win.dispatchEvent(event('keyup',{key:'Control',code,ctrlKey:false}));
   assert.equal(f.game.isCursorLocked(),false);assert.equal(f.game.hasBall(p),true);assert.equal(p.shotsTaken,0);assert.deepEqual(f.game.localInput.keys,{});assert.equal(f.sent.at(-1).cancelShot,true);
  }finally{f.close();}
 }
});

test('Ctrl taps support legacy keyboard events and repeated keydown events toggle only once',()=>{
 for(const fields of [{key:'Control'},{key:'Control',location:2},{keyCode:17},{which:17}]){
  const f=fixture();try{
   f.win.dispatchEvent(event('keydown',{...fields,ctrlKey:true}));
   for(let i=0;i<10;i++)f.win.dispatchEvent(event('keydown',{...fields,ctrlKey:true,repeat:true}));
   assert.equal(f.requests,0);f.win.dispatchEvent(event('keyup',{...fields,ctrlKey:false}));
   assert.equal(f.requests,1);assert.equal(f.game.isCursorLocked(),true);
   f.win.dispatchEvent(event('keyup',{...fields,ctrlKey:false}));assert.equal(f.game.isCursorLocked(),true,'an unpaired release has no effect');
  }finally{f.close();}
 }
});

test('Ctrl browser shortcuts neither toggle cursor lock nor prevent their browser action',()=>{
 for(const [key,code] of [['l','KeyL'],['w','KeyW'],['f','KeyF'],['1','Digit1'],['+','Equal'],['t','KeyT']])for(const locked of [false,true]){
  const f=fixture();try{
   if(locked)f.game.requestCursorLock();const requests=f.requests;
   const events=[event('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true}),event('keydown',{key,code,ctrlKey:true}),event('keyup',{key,code,ctrlKey:true}),event('keyup',{key:'Control',code:'ControlLeft',ctrlKey:false})];
   for(const e of events)f.win.dispatchEvent(e);
   assert.equal(f.requests,requests,`${code} did not request lock`);assert.equal(f.game.isCursorLocked(),locked,`${code} did not change lock`);assert.equal(f.game.localInput.shootHeld,false);
   for(const e of events)assert.equal(e.defaultPrevented,false,`${code} remains available to the browser`);
  }finally{f.close();}
 }
});

test('two Ctrl keys or another already-held key do not count as a standalone Ctrl tap',()=>{
 const f=fixture();try{
  f.win.dispatchEvent(event('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true}));f.win.dispatchEvent(event('keydown',{key:'Control',code:'ControlRight',ctrlKey:true}));
  f.win.dispatchEvent(event('keyup',{key:'Control',code:'ControlRight',ctrlKey:true}));f.win.dispatchEvent(event('keyup',{key:'Control',code:'ControlLeft',ctrlKey:false}));assert.equal(f.requests,0);
  f.win.dispatchEvent(event('keydown',{key:'Shift',code:'ShiftLeft',shiftKey:true}));f.win.dispatchEvent(event('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true,shiftKey:true}));
  f.win.dispatchEvent(event('keyup',{key:'Shift',code:'ShiftLeft',ctrlKey:true}));f.win.dispatchEvent(event('keyup',{key:'Control',code:'ControlLeft',ctrlKey:false}));assert.equal(f.requests,0);
  f.win.dispatchEvent(event('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true}));f.win.dispatchEvent(event('keyup',{key:'Control',code:'ControlLeft',ctrlKey:false}));assert.equal(f.requests,1,'a subsequent clean tap works');
 }finally{f.close();}
});

test('Ctrl cannot lock from an editable field or when another modifier is held',()=>{
 for(const fields of [{target:{tagName:'INPUT'}},{target:{isContentEditable:true}},{metaKey:true},{altKey:true},{shiftKey:true}]){
  const f=fixture();try{
   f.win.dispatchEvent(event('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true,...fields}));f.win.dispatchEvent(event('keyup',{key:'Control',code:'ControlLeft',ctrlKey:false,...fields}));
   assert.equal(f.requests,0);assert.equal(f.game.isCursorLocked(),false);
  }finally{f.close();}
 }
});

test('a Ctrl release after losing focus or opening a menu cannot request cursor lock',()=>{
 for(const locked of [false,true])for(const blur of [false,true]){
  const f=fixture();try{
   if(locked)f.game.requestCursorLock();const requests=f.requests;
   f.win.dispatchEvent(event('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true}));
   if(blur)f.win.dispatchEvent(new Event('blur'));else f.game.suspendControls();
   f.win.dispatchEvent(event('keyup',{key:'Control',code:'ControlLeft',ctrlKey:false}));assert.equal(f.requests,requests);assert.equal(f.game.isCursorLocked(),false);
  }finally{f.close();}
 }
});
