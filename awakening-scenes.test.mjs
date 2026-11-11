import test from 'node:test';import assert from 'node:assert/strict';
import {Game} from './game.js';import {ROSTER,getSkills,activateSkill} from './characters.js';
import {awakeningScene,drawFootballPose,drawAwakeningScene} from './awakening-scenes.js';
const ctx=()=>{const calls=[];return {calls,c:new Proxy({}, {get:(o,k)=>o[k]||((...args)=>calls.push([k,...args]))})};};
test('every normal/DLSI awakening move has its own stable presentation and recognizable pose',()=>{
 const seen=new Map(),poses=new Set(),themes=new Set();
 for(const r of ROSTER.filter(r=>r.awakening))for(const dl of[false,true])for(const own of[false,true]){
  const p={character:r.id,awakened:true,awakeningLeft:45,ability:{},dlsi:dl?{moves:[true,true,true,true],awakening:true}:null};
  getSkills(p,true,own).forEach((s,slot)=>{const fx=awakeningScene(p,{title:s.name,slot});const meaning=[p.character,dl,slot,s.name].join('|');assert.equal(seen.has(fx.id)?seen.get(fx.id):meaning,meaning);seen.set(fx.id,meaning);poses.add(fx.pose);themes.add(fx.theme);assert.deepEqual(fx,awakeningScene(p,{title:s.name,slot}));});
 }
 assert.ok(seen.size>=80);assert.ok(poses.size>=10);assert.ok(themes.size>=14);
});
test('bicycle, scorpion, header, volley, backheel, trap and feint draw different limbs instead of one shared kick',()=>{
 const poses=['bicycle','scorpion','header','volley','backheel','trap','feint','pass','block'],signatures=new Set();
 for(const pose of poses){const{calls,c}=ctx();drawFootballPose(c,{pose},0);signatures.add(JSON.stringify(calls));}
 assert.equal(signatures.size,poses.length);
});
test('unique awakening views and effects are read-only and keep the simulation and RNG untouched',()=>{
 const g=new Game(null,{mode:'online',gameFormat:'standard-2v2',character:'ice',seed:'ce'.repeat(16)}),p=g.localPlayer();
 const fx=awakeningScene(p,{title:'ICE cold',slot:2});g.cutscene(2,['ICE cold'],'#8ceaff',()=>{},{kind:'awakening-pose',actorId:p.id,presentation:fx});
 const before=JSON.stringify(g.state);const a=g.cutsceneView(.25),b=g.cutsceneView(.75);assert.notDeepEqual(a.players[0],b.players[0]);
 for(const t of[0,.3,.6,1]){const{c}=ctx();drawAwakeningScene(g,c,fx,t,{actor:g.cutsceneView(t).players[0]});}assert.equal(JSON.stringify(g.state),before);
});
test('a real instantaneous awakening move gets a live themed burst without freezing its gameplay',()=>{
 const g=new Game(null,{mode:'online',gameFormat:'standard-1v1',character:'falcon'}),p=g.localPlayer();p.awakened=true;p.awakeningLeft=45;
 assert.equal(activateSkill(g,p,1),true);assert.equal(g.state.phase,'play');assert.equal(p.awakeningFx.title,'Predator Eye');assert.equal(p.awakeningFx.theme,'wings');
 g.update(1/30);assert.ok(p.awakeningFx.left<1.2);
});
test('a refused awakening move never emits an effect or spends its cooldown',()=>{
 const g=new Game(null,{mode:'online',character:'falcon'}),p=g.localPlayer();p.awakened=true;p.awakeningLeft=45;g.state.ball.owner=1;
 assert.equal(activateSkill(g,p,0),false);assert.equal(p.awakeningFx,undefined);assert.equal(p.cooldowns[0],0);
});
