import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, fitViewport, finishingChance } from './game.js';

test('direct HUD command API activates the first ability for every equipped character', () => {
  for (const character of ['manmarker','powershooter','ninja','playmaker','streetdribbler','supersonic']) {
    const game=match(character);
    if(['powershooter','streetdribbler','supersonic'].includes(character)) game.setOwner(game.state.players[0]);
    assert.equal(game.useSkill(1),true,character);
    game.update(.01);
    assert.ok(game.state.players[0].cooldowns[0]>0,`${character} must activate and start its cooldown`);
  }
});

test('guest ability buttons send one command directly over the existing input channel', () => {
  const sent=[];
  const game=match('manmarker',{mode:'guest',onInput:input=>sent.push(input)});
  game.useSkill(1);
  assert.equal(sent.length,1);
  assert.equal(sent[0].skill,1);
  assert.equal(game.pending[0].length,0);
});

test('ability shortcuts accept physical number keys across keyboard layouts and numpads', () => {
  const prior=globalThis.window;
  try {
    for(const code of ['Digit1','Numpad1']) {
      const events=new EventTarget();globalThis.window=events;
      const canvas=new EventTarget();canvas.getContext=()=>null;
      const game=new Game(canvas,{mode:'online',character:'manmarker'});game.state.kickoff=null;game.bind();
      const press=new Event('keydown',{cancelable:true});
      Object.defineProperties(press,{key:{value:code==='Digit1'?'&':'End'},code:{value:code},repeat:{value:false}});
      events.dispatchEvent(press);game.update(.01);
      assert.ok(game.state.players[0].cooldowns[0]>0,code);
      game.stop();
    }
  } finally {if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

test('unavailable ability commands explain Characterless, kickoff, and recovery restrictions', () => {
  const game=match();
  assert.equal(game.useSkill(1),false);
  assert.match(game.state.message,/Spin and equip/);
  game.state.players[0].character='manmarker';game.state.kickoff={team:1,left:4};
  assert.equal(game.useSkill(1),false);
  assert.match(game.state.message,/kickoff protection/);
  game.state.kickoff=null;game.state.players[0].recovery=.2;
  assert.equal(game.useSkill(1),false);
  assert.match(game.state.message,/Finish the current move/);
  assert.equal(game.pending[0].length,0);
});

test('a tap kick retains a strong launch and travels more than five hundred units in one second', () => {
  const game=match(),p=game.state.players[0];
  Object.assign(p,{x:150,y:140,aim:{x:1130,y:140}});
  game.setOwner(p);withRandom(()=>0,()=>game.kick(p,5));
  assert.ok(Math.hypot(game.state.ball.vx,game.state.ball.vy)>=300,'tap shots need substantially higher launch speed even when their aim spreads');
  advance(game,1);
  assert.ok(Math.hypot(game.state.ball.x-p.x,game.state.ball.y-p.y)>500,'tap shots should retain enough pace to travel far');
  assert.equal(game.state.ball.power,5,'charge values retain their specified meaning');
});

test('C performs a visible forward and sideways step-over while retaining possession and its counter window', () => {
  const game=match(),p=game.state.players[0],enemy=game.state.players[1];
  game.setOwner(p);const origin={x:p.x,y:p.y};
  game.useAction();advance(game,.12);
  assert.ok(p.x-origin.x>15);
  assert.ok(Math.abs(p.y-origin.y)>20);
  assert.equal(game.state.ball.owner,p.id);
  assert.equal(p.motion.feint,true);
  assert.ok(p.dribble>0);
  assert.equal(game.steal(enemy,p,1),false);
  assert.ok(enemy.stun>0);
  advance(game,.41);
  assert.equal(p.motion,null);
  assert.ok(p.recovery>0);
  assert.ok(p.dribbleCd>1.4);
});

test('scoring replay includes up to ten seconds of buildup and uses the same duration for both peers', () => {
  const game=match();advance(game,8);
  const p=game.state.players[0];Object.assign(p,{x:700,y:350,aim:{x:1130,y:285}});
  game.setOwner(p);game.state.keepers[1].y=870;
  const shotStart=game.state.elapsed;withRandom(()=>0,()=>game.kick(p,40));
  for(let i=0;i<200&&game.state.phase==='play';i++)game.update(.01);
  assert.equal(game.state.phase,'celebrate');
  assert.ok(game.goalReplay.length>90&&game.goalReplay.length<=127);
  assert.ok(game.goalReplay[0].at<shotStart-7);
  assert.ok(game.goalReplay.at(-1).at-game.goalReplay[0].at<=10);
  assert.ok(game.goalReplay.at(-1).ball.x>1130);
  assert.ok(game.state.replayDuration>8&&game.state.replayDuration<=10);
  const guest=new Game(null,{mode:'guest',localTeam:1});guest.importState(game.exportState());
  assert.deepEqual(guest.goalReplay,game.goalReplay);
  assert.equal(guest.state.replayDuration,game.state.replayDuration);
  const pausedTime=game.state.time;advance(game,5.01);
  assert.equal(game.state.phase,'replay');
  advance(game,game.state.replayDuration+.01);
  assert.equal(game.state.phase,'play');
  near(game.state.time,pausedTime,.05);
});

test('awakening readiness publishes the recipient and transfers that identity to the new owner', () => {
  const game=match('manmarker',{opponentCharacter:'powershooter'});
  game.state.players[0].awakeningCharge=99.99;game.update(.02);
  assert.equal(game.state.awakeningOwner,0);
  assert.equal(game.state.awakeningNotice.playerId,0);
  assert.equal(game.state.awakeningNotice.name,game.state.players[0].name);
  game.setInput(0,{awaken:true});game.update(.01);
  assert.equal(game.state.awakeningOwner,0);
  assert.equal(game.state.players[0].awakened,true);
  advance(game,3.5);game.state.players[1].awakeningCharge=99.99;game.update(.02);
  assert.equal(game.state.awakeningOwner,1);
  assert.equal(game.state.awakeningNotice.playerId,1);
  assert.equal(game.state.players[0].awakened,false);
  const guest=new Game(null,{mode:'guest',localTeam:1});guest.importState(game.exportState());
  assert.equal(guest.state.awakeningOwner,1);
  assert.equal(guest.state.awakeningNotice.playerId,1);
});

test('simultaneous awakening readiness alternates its winner instead of favoring loop order', () => {
  const game = new Game(null, {mode:'online',character:'manmarker',opponentCharacter:'powershooter'});
  game.state.kickoff=null;game.awakeningTurn=1;
  game.state.players.forEach(p=>p.awakeningCharge=99.99);
  game.update(.02);
  assert.equal(game.state.players[1].awakeningCharge,100);
  assert.equal(game.state.players[0].awakeningCharge,0);
  game.state.players.forEach(p=>p.awakeningCharge=99.99);
  game.update(.02);
  assert.equal(game.state.players[0].awakeningCharge,100);
  assert.equal(game.state.players[1].awakeningCharge,0);
});

test('the first awakening is a 50/50 draw without favoring the human or a team', () => {
  const random=Math.random;
  try {
    for(const roll of [.25,.75]) for(const mode of ['bot','online']) for(const localTeam of [0,1]) for(const character of ['manmarker','powershooter','playmaker','streetdribbler','supersonic']) {
      Math.random=()=>roll;
      const game=new Game(null,{mode,localTeam,character,opponentCharacter:'manmarker'});
      game.state.kickoff=null;game.state.players.forEach(p=>{p.awakeningCharge=99.99;p.recovery=1;});
      game.update(.02);
      assert.equal(game.state.awakeningOwner,roll<.5?0:1,`${mode}, ${character}, human team ${localTeam}, roll ${roll}`);
    }
  } finally {Math.random=random;}
});

test('the last recipient cannot receive consecutive awakenings, including after expiry or a goal', () => {
  const game=new Game(null,{mode:'online',character:'manmarker',opponentCharacter:'powershooter'});
  game.state.kickoff=null;game.awakeningTurn=0;
  game.state.players.forEach(p=>p.awakeningCharge=99.99);game.update(.02);
  assert.equal(game.state.lastAwakeningRecipient,0);
  game.setInput(0,{awaken:true});game.update(.01);advance(game,3.5);
  assert.equal(game.state.players[0].awakened,true);
  game.state.players[0].awakeningLeft=.01;game.update(.02);
  assert.equal(game.state.awakeningOwner,null);
  game.state.players[0].awakeningCharge=99.99;game.state.players[1].awakeningCharge=0;game.update(.02);
  assert.equal(game.state.awakeningOwner,null,'the previous recipient cannot immediately earn another award');
  game.goal(0);advance(game,5.01);advance(game,game.state.replayDuration+.01);
  assert.equal(game.state.lastAwakeningRecipient,0,'a goal must not reset award history');
  const guest=new Game(null,{mode:'guest',localTeam:1});guest.importState(game.exportState());
  assert.equal(guest.state.lastAwakeningRecipient,0);
  game.state.players.forEach(p=>p.awakeningCharge=99.99);game.update(.02);
  assert.equal(game.state.awakeningOwner,1);
  assert.equal(game.state.lastAwakeningRecipient,1);
  game.state.players.forEach(p=>p.awakeningCharge=99.99);game.update(.02);
  assert.equal(game.state.awakeningOwner,0);
});

test('a bot cannot take an unspent player awakening on the following frame', () => {
  const game=new Game(null,{mode:'bot',character:'playmaker',opponentCharacter:'manmarker'});
  game.awakeningTurn=0;
  game.state.kickoff=null;game.state.players.forEach(p=>{p.awakeningCharge=99.99;p.recovery=2;});
  game.update(.02);advance(game,1);
  assert.equal(game.state.awakeningOwner,0);
  assert.equal(game.state.players[0].awakeningCharge,100);
  assert.ok(game.state.players[1].awakeningCharge<2);
});

test('canvas renders play, celebration, replay, and cutscene using actual game state', () => {
  const gradient={addColorStop(){}};
  const ctx=new Proxy({measureText:t=>({width:t.length*12}),createRadialGradient:()=>gradient},{get:(obj,key)=>obj[key]||(()=>{})});
  const canvas={width:1200,height:700,getContext:()=>ctx,getBoundingClientRect:()=>({width:1200,height:700})};
  const game=new Game(canvas,{mode:'online'});
  game.render();game.history=[{players:game.state.players,ball:game.state.ball,keepers:game.state.keepers}];
  game.goal(0);game.render();game.state.phase='replay';game.state.phaseTime=4;game.render();
  game.cutscene(3,['First line','Second line'],'#ffe45e');game.state.phaseTime=.5;game.render();
});

function match(character = 'none', extra = {}) {
  const game = new Game(null, { mode: 'online', character, ...extra });
  game.state.kickoff = null;
  Object.assign(game.state.players[0], { x:350, y:170, angle: 0 });
  Object.assign(game.state.players[1], { x:850, y:500, angle: Math.PI });
  Object.assign(game.state.ball, { x:600, y:350, owner: null });
  return game;
}
function advance(game, seconds, step = .01) {
  const count = Math.ceil(seconds / step);
  for (let i = 0; i < count; i++) game.update(seconds / count);
}
function near(actual, expected, tolerance = .001) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
}

function botAttack(character='manmarker',localTeam=0,powerShotCooldown=0){
  const kicks=[];let game;
  game=new Game(null,{mode:'bot',localTeam,character:'none',opponentCharacter:character,onEvent:event=>{if(event.type==='kick'){const bot=game.state.players[1-localTeam];kicks.push({x:bot.x,y:bot.y,power:event.power,vx:game.state.ball.vx,at:game.state.elapsed});}}});
  game.state.kickoff=null;
  const bot=game.state.players[1-localTeam],human=game.state.players[localTeam];
  Object.assign(bot,{x:600,y:350});Object.assign(human,{x:localTeam?250:950,y:580});
  bot.cooldowns[0]=powerShotCooldown;game.setOwner(bot);
  return {game,bot,human,kicks};
}

test('bots shoot from midfield in both directions before dribbling into the goalkeeper',()=>{
  for(const localTeam of [0,1])for(const [character,cooldown] of [['none',0],['manmarker',0],['powershooter',0],['powershooter',20]]){
    const {game,bot,kicks}=botAttack(character,localTeam,cooldown);
    for(let i=0;i<200&&!kicks.length;i++){
      game.update(.02);
      if(!kicks.length)assert.equal(typeof game.state.ball.owner,'number',`${character} must not lose possession before shooting`);
    }
    assert.equal(kicks.length,1,`${character}, team ${bot.team} must release a real shot`);
    const goalX=bot.team?70:1130;
    assert.ok(Math.abs(kicks[0].x-goalX)>=300);
    assert.ok(bot.team?kicks[0].vx<0:kicks[0].vx>0);
    assert.ok(kicks[0].at<4);
    if(character==='powershooter'&&cooldown===0)assert.equal(kicks[0].power,45);
    advance(game,.4);assert.equal(kicks.length,1);
    assert.notEqual(game.state.ball.owner,bot.id,'the bot must let its shot travel rather than tackle it back');
  }
});

test('a bot moves while charging with one stable aim and releases a midfield shot promptly',()=>{
  for(const localTeam of [0,1]){
    const {game,bot,kicks}=botAttack('manmarker',localTeam);game.update(.02);
    const aim={...game.botShot.aim},power=game.botShot.power,position={x:bot.x,y:bot.y},charge=bot.charge;
    advance(game,.5);
    assert.deepEqual(game.botShot.aim,aim);assert.equal(game.botShot.power,power);
    assert.ok(Math.hypot(bot.x-position.x,bot.y-position.y)>60,'the charging bot keeps moving');
    assert.ok(Math.abs(bot.y-position.y)>40,'movement creates a sideways shooting angle');
    near(bot.charge-charge,12.5*.5);assert.equal(bot.dribbleCd,0);assert.equal(bot.motion,null);
    for(let i=0;i<100&&!kicks.length;i++)game.update(.02);
    assert.equal(kicks.length,1);assert.ok(kicks[0].at<=1.6,'normal charge must finish within 1.6 seconds');
    assert.ok(kicks[0].power>=18&&kicks[0].power<=24.5);
    assert.ok(Math.abs(kicks[0].x-(bot.team?70:1130))>430,'the bot shoots well outside keeper range');
  }
});

test('a bot releases immediately if it receives possession close to the goalkeeper',()=>{
  const {game,bot,kicks}=botAttack();bot.x=139;game.setOwner(bot);
  advance(game,.1);
  assert.equal(kicks.length,1);
  assert.ok(kicks[0].at<=.05);
  near(kicks[0].x,139);
});

test('bot shot plans reset on possession changes and kickoff',()=>{
  const {game,bot,human}=botAttack();game.update(.02);const firstPlan=game.botShot;
  game.setOwner(human);assert.equal(game.botShot,null);game.update(.02);
  assert.equal(game.inputs[bot.team].shootHeld,false);
  game.setOwner(bot);game.update(.02);
  assert.ok(game.botShot);assert.notEqual(game.botShot,firstPlan);
  game.resetKickoff(human.team);
  assert.equal(game.botShot,null);assert.equal(game.inputs[bot.team].shootHeld,false);
});

test('match lasts five active minutes and ends once', () => {
  const ended = [];
  const game = match('none', { onEnd: result => ended.push(result) });
  assert.equal(game.state.time, 300);
  advance(game, 299);
  assert.equal(game.state.phase, 'play');
  advance(game, 1.1);
  assert.equal(game.state.phase, 'ended');
  assert.equal(game.state.time, 0);
  advance(game, 1);
  assert.equal(ended.length, 1);
});

test('movement normalizes diagonal speed and possession slows movement by 20 percent', () => {
  const walking = match();
  const start = { ...walking.state.players[0] };
  walking.setInput(0, { keys: { d: true, s: true } });
  advance(walking, 1);
  near(Math.hypot(walking.state.players[0].x - start.x, walking.state.players[0].y - start.y), 194);
  const carrying = match();
  carrying.setOwner(carrying.state.players[0]);
  carrying.setInput(0, { keys: { d: true } });
  advance(carrying, 1);
  near(carrying.state.players[0].x - start.x, 194 * .8);
});

test('F tap kicks at five power, charging adds 12.5 per second, cursor controls direction', () => {
  const game = match();
  const player = game.state.players[0];
  game.setOwner(player);
  game.setInput(0, { shootHeld: true, aim: { x: player.x, y: 0 } });
  game.update(.01);
  game.setInput(0, { shootHeld: false, shootRelease: true });
  withRandom(()=>0,()=>game.update(.01));
  assert.equal(game.state.ball.power, 5);
  assert.ok(game.state.ball.vy < 0);
  near(game.state.ball.vx, 0);
  game.setOwner(player);
  game.setInput(0, { shootHeld: true });
  game.update(.01);
  advance(game, 2);
  near(player.charge, 30);
  game.setInput(0, { shootHeld: false, shootRelease: true });
  game.update(.01);
  near(game.state.ball.power, 30);
});

test('a maximum charged kick automatically fires after four seconds with airtime', () => {
  const game = match();
  game.setOwner(game.state.players[0]);
  game.setInput(0, { shootHeld: true });
  game.update(.01);
  advance(game, 11.65);
  assert.equal(game.state.ball.owner, null);
  assert.equal(game.state.ball.power, 100);
  assert.ok(game.state.ball.z > 0);
  assert.equal(game.inputs[0].shootHeld, false);
});

test('walking and tackling cannot intercept an airborne ball', () => {
  const game = match();
  const player = game.state.players[0];
  Object.assign(game.state.ball, { x: player.x, y: player.y, z: 1, vz: 40 });
  game.update(.01);
  assert.equal(game.state.ball.owner, null);
  game.setInput(0, { action: true });
  game.update(.01);
  assert.equal(game.state.ball.owner, null);
});

test('slide steals and stuns for one second, then an independent dribble is available', () => {
  const game = match();
  const [attacker, carrier] = game.state.players;
  Object.assign(carrier, { x: attacker.x + 38, y: attacker.y });
  game.setOwner(carrier);
  game.setInput(0, { action: true });
  game.update(.01);
  assert.equal(game.state.ball.owner, attacker.id);
  assert.ok(carrier.stun > .95 && carrier.stun <= 1);
  assert.ok(attacker.slideCd > 1.9);
  game.setInput(0, { action: true });
  game.update(.01);
  assert.ok(attacker.dribble > .45, 'successful slide must allow immediate dribble');
  assert.ok(attacker.dribbleCd > 1.9);
});

test('dribbling counters a slide and consumes its motion so it cannot resume stealing after stun', () => {
  const game = match();
  const [attacker, carrier] = game.state.players;
  Object.assign(carrier, { x: attacker.x + 38, y: attacker.y, dribble: .5 });
  game.setOwner(carrier);
  game.setInput(0, { action: true });
  game.update(.01);
  assert.equal(game.state.ball.owner, carrier.id);
  assert.ok(attacker.stun > .9);
  assert.equal(attacker.motion, null, 'countered slide must end at contact');
  advance(game, 1.2);
  assert.equal(game.state.ball.owner, carrier.id);
});

test('dribble recovery blocks movement and actions for 0.2 seconds', () => {
  const game = match();
  const player = game.state.players[0];
  game.setOwner(player);
  game.setInput(0, { action: true });
  game.update(.01);
  advance(game, .5);
  assert.ok(player.recovery > .15);
  const x = player.x;
  game.setInput(0, { keys: { d: true }, shootRelease: true });
  advance(game, .15);
  near(player.x, x);
  assert.equal(game.state.ball.owner, player.id);
  advance(game, .1);
  assert.ok(player.x > x);
});

test('grounded low-power shots can cross the goal mouth; side walls bounce elsewhere', () => {
  const game = match();
  game.state.keepers[1].y = 900;
  Object.assign(game.state.ball, { x:1110, y:350, vx: 100, vy: 0, lastTouch: 0, lastKickTeam: 0 });
  advance(game, .5);
  assert.deepEqual(game.state.score, [1, 0]);
  assert.equal(game.state.phase, 'celebrate');
  const wall = match();
  Object.assign(wall.state.ball, { x:1119, y:150, vx: 300, vy: 0 });
  wall.update(.07);
  assert.equal(wall.state.phase, 'play');
  assert.ok(wall.state.ball.vx < 0);
  assert.ok(wall.state.ball.x <= 1130);
});

test('goal celebrates five seconds, replays available buildup, then protects conceded kickoff', () => {
  const game = match();
  advance(game, 8);
  game.state.ball.lastTouch = 0;
  game.goal(0);
  assert.equal(game.state.players[0].stats.goals, 1);
  assert.ok(game.goalReplay.length>90);
  const time = game.state.time;
  advance(game, 4.99);
  assert.equal(game.state.phase, 'celebrate');
  advance(game, .02);
  assert.equal(game.state.phase, 'replay');
  advance(game, game.state.replayDuration + .01);
  assert.equal(game.state.phase, 'play');
  assert.equal(game.state.kickoff.team, 1);
  near(game.state.time, time, .05);
  const lockedX = game.state.players[0].x;
  game.setInput(0, { keys: { d: true } });
  advance(game, .2);
  near(game.state.players[0].x, lockedX);
  game.setOwner(game.state.players[1]);
  game.update(.01);
  assert.equal(game.state.kickoff, null);
  assert.ok(game.state.players[0].x > lockedX);
});

test('keeper holds for two seconds and distributes through the air at up to 65 power', () => {
  const game = match();
  const keeper = game.state.keepers[0];
  game.keeperCatch(keeper);
  advance(game, 1.9);
  assert.equal(game.state.ball.owner, keeper.id);
  advance(game, .12);
  assert.equal(game.state.ball.owner, null);
  assert.ok(game.state.ball.z > 0);
  assert.ok(game.state.ball.power <= 65);
});

test('keepers can save a third shot and legacy bypass flags never guarantee a goal', () => {
  const game=match(),striker=game.state.players[0],keeper=game.state.keepers[1];
  for(let shot=0;shot<3;shot++){
    Object.assign(striker,{x:1000,y:350,aim:{x:1130,y:350}});Object.assign(keeper,{x:1102,y:350});
    game.setOwner(striker);withRandom(()=>.999,()=>game.kick(striker,20,{fromF:true}));
    Object.assign(game.state.ball,{pierceKeeper:true,unsaveable:true});advance(game,.7);
    assert.equal(game.state.ball.owner,keeper.id,`shot ${shot+1} can be saved`);assert.equal(game.state.phase,'play');
    if(shot<2)advance(game,2.1);
  }
  assert.equal(striker.shotsTaken,3);assert.equal(striker.shotType,'quick');assert.equal(keeper.saveStreak,3);assert.deepEqual(game.state.score,[0,0]);
});

test('a paused cutscene freezes the clock, movement, and scheduled move windups', () => {
  const game = match();
  let fired = 0;
  game.schedule(.5, () => fired++);
  game.cutscene(2, ['Pause'], '#fff', () => {});
  const x = game.state.players[0].x;
  const time = game.state.time;
  game.setInput(0, { keys: { d: true } });
  advance(game, 1);
  assert.equal(fired, 0);
  assert.equal(game.state.time, time);
  assert.equal(game.state.players[0].x, x);
  advance(game, 1.1);
  advance(game, .4);
  assert.equal(fired, 1);
});

test('numeric skills 1 and 2 activate their matching moves and enforce cooldown', () => {
  const game = match('manmarker');
  const player = game.state.players[0];
  game.setInput(0, { skill: 1 });
  game.update(.01);
  assert.ok(player.motion);
  assert.equal(player.cooldowns[0], 26);
  assert.equal(player.cooldowns[1], 0);
  player.motion = null;
  game.state.players[1].x = player.x + 100;
  game.state.players[1].y = player.y;
  game.setInput(0, { skill: 2 });
  game.update(.01);
  assert.ok(player.ability.markLeft > 4.9);
  assert.equal(player.cooldowns[1], 30);
  game.setInput(0, { skill: 2 });
  game.update(.01);
  assert.ok(player.cooldowns[1] < 30);
});

test('Playmaker observation changes actual movement speed, Supersonic passive is 50 percent', () => {
  for (const [character, skill, multiplier] of [['playmaker', 1, 1.3], ['supersonic', null, 1.5]]) {
    const game = match(character);
    if (skill) { game.setInput(0, { skill }); game.update(.01); }
    const player = game.state.players[0], x = player.x;
    game.setInput(0, { keys: { d: true } });
    advance(game, 1);
    near(player.x - x, 194 * multiplier);
  }
});

test('Supersonic fourth numeric skill activates on-ball awakening world-record speed', () => {
  const game = match('supersonic');
  const player = game.state.players[0];
  game.setOwner(player);
  player.awakeningCharge = 100;
  game.setInput(0, { awaken: true });
  game.update(.01);
  advance(game, 3);
  assert.equal(player.awakened, true);
  game.setInput(0, { skill: 4 });
  game.update(.01);
  assert.equal(game.state.phase, 'cutscene');
  advance(game, 2.5);
  assert.equal(player.worldRecordSpeed, true);
  const x = player.x;
  game.setInput(0, { keys: { d: true } });
  advance(game, .5);
  near(player.x - x, 194 * 3 * .8 * .5);
});

test('guest receives the replay when importing authoritative goal states', () => {
  const host = match();
  advance(host, 8);
  host.state.ball.lastTouch = 0;
  host.goal(0);
  const guest = new Game(null, { mode: 'guest', localTeam: 1 });
  guest.importState(host.exportState());
  assert.equal(guest.goalReplay.length,host.goalReplay.length);
  assert.deepEqual(guest.goalReplay[0].ball, host.goalReplay[0].ball);
  guest.importState(host.exportState());
  assert.equal(guest.goalReplay.length,host.goalReplay.length);
});

test('kickoff protection also blocks a previously activated Manmark from moving the locked opponent', () => {
  const game = match('manmarker');
  const player = game.state.players[0];
  Object.assign(game.state.players[1], { x: player.x + 100, y: player.y });
  game.setInput(0, { skill: 2 });
  game.update(.01);
  assert.ok(player.ability.markLeft > 0);
  game.resetKickoff(1);
  const x = player.x;
  advance(game, .1);
  near(player.x, x);
});


test('canvas fits portrait, landscape, ultrawide, and short screens without stretching or clipping the pitch',()=>{
  for(const [width,height] of [[390,844],[844,390],[2560,1080],[1366,568],[1200,700]]){
    const transforms=[],gradient={addColorStop(){}};
    const ctx=new Proxy({setTransform:(...args)=>transforms.push(args),measureText:t=>({width:t.length*12}),createRadialGradient:()=>gradient},{get:(obj,key)=>obj[key]||(()=>{})});
    const canvas={width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({left:83,top:47,width,height})};
    const game=new Game(canvas,{mode:'online'});game.render();
    const view=fitViewport(width,height),backingView=fitViewport(canvas.width,canvas.height),transform=transforms.at(-1);
    near(transform[0],transform[3]);near(transform[0],backingView.scale);
    near(view.width/view.height,1200/700);assert.ok(view.x>=0&&view.y>=0);
    assert.ok(view.x+view.width<=width+.001&&view.y+view.height<=height+.001);
    for(const point of [{x:0,y:0},{x:600,y:350},{x:1130,y:440},{x:1200,y:700}]){
      const mapped=game.pointerToPitch(83+view.x+point.x*view.scale,47+view.y+point.y*view.scale);
      near(mapped.x,point.x);near(mapped.y,point.y);
    }
    const before=game.pointerToPitch(-100,-100),after=game.pointerToPitch(width+300,height+300);
    assert.deepEqual(before,{x:0,y:0});assert.deepEqual(after,{x:1200,y:700});
  }
});

test('pointer input aims at the displayed pitch after letterboxing and resizing',()=>{
  const prior=globalThis.window;
  try{
    const events=new EventTarget();globalThis.window=events;
    let rect={left:40,top:30,width:1800,height:700};
    const canvas=new EventTarget();canvas.getContext=()=>null;canvas.getBoundingClientRect=()=>rect;
    const game=new Game(canvas,{mode:'online'});game.bind();
    for(const dimensions of [[1800,700],[390,620]]){
      [rect.width,rect.height]=dimensions;game.canvasMetrics(true);const view=fitViewport(rect.width,rect.height);
      const move=new Event('pointermove');Object.defineProperties(move,{clientX:{value:rect.left+view.x+900*view.scale},clientY:{value:rect.top+view.y+260*view.scale}});
      canvas.dispatchEvent(move);near(game.inputs[0].aim.x,900);near(game.inputs[0].aim.y,260);
    }
    game.stop();
  }finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

test('both players expose actual charge and brief shot power, including online state and replay frames',()=>{
  for(const team of [0,1]){
    const game=match(),p=game.state.players[team];game.setOwner(p);
    const x=p.x;game.setInput(team,{shootHeld:true,keys:{d:true}});game.update(.01);advance(game,.4);
    assert.ok(p.x>x,'players can move and charge together');
    near(game.shotMeter(p).power,10);assert.equal(game.shotMeter(p).label,'POWER');
    game.setInput(team,{shootHeld:false,shootRelease:true,keys:{}});game.update(.01);
    assert.equal(game.shotMeter(p).label,'SHOT');near(game.shotMeter(p).power,game.state.ball.power);
    const guest=new Game(null,{mode:'guest',localTeam:1-team});guest.importState(game.exportState());
    assert.deepEqual(guest.shotMeter(guest.state.players[team]),game.shotMeter(p));
    assert.equal(game.shotReplay[0].players[team].shotPower,p.shotPower);
    assert.equal(game.shotReplay[0].players[team].shotPowerLeft,.7);
    advance(game,.72);assert.equal(game.shotMeter(p),null);
  }
});

test('power bars render for either player and remain inside the pitch near every edge',()=>{
  const game=match(),backgrounds=[],labels=[];
  const c=new Proxy({roundRect:(x,y,w,h)=>backgrounds.push({x,y,w,h}),fillText:(text,x,y)=>labels.push({text,x,y})},{get:(o,k)=>o[k]||(()=>{})});
  for(const team of [0,1])for(const [x,y] of [[0,0],[1200,0],[0,700],[1200,700]]){
    const p={...game.state.players[team],x,y,charging:true,charge:35};game.drawShotPower(c,p);
  }
  assert.equal(backgrounds.length,8);assert.equal(labels.length,8);
  for(const b of backgrounds)assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=1200&&b.y+b.h<=700);
  assert.ok(labels.every(label=>label.text==='POWER 35'));
});

test('PowerShooter shows the promised power throughout its required one-second windup and release',()=>{
  const {game,bot,kicks}=botAttack('powershooter');game.update(.01);
  assert.equal(game.shotMeter(bot).label,'WINDUP');assert.equal(game.shotMeter(bot).power,45);
  advance(game,.5);near(game.shotMeter(bot).fill,.5);assert.equal(kicks.length,0);
  advance(game,.48);assert.equal(kicks.length,0);
  advance(game,.04);assert.equal(kicks.length,1);assert.ok(kicks[0].at>=1);
  assert.equal(game.shotMeter(bot).label,'SHOT');assert.equal(game.shotMeter(bot).power,45);
});


test('a paused ability windup keeps its power meter aligned with its scheduled shot',()=>{
  const game=match('powershooter'),p=game.state.players[0];game.setOwner(p);game.useSkill(1);game.update(.01);advance(game,.3);
  const before=game.shotMeter(p);game.cutscene(2,['Pause'],'#fff',()=>{});advance(game,1);
  assert.deepEqual(game.shotMeter(p),before);assert.equal(game.state.ball.owner,p.id);
  advance(game,1.01);advance(game,.65);assert.equal(game.state.ball.owner,p.id);
  advance(game,.1);assert.equal(game.state.ball.power,45);assert.equal(game.shotMeter(p).label,'SHOT');
});


test('phone-sized power meters keep readable physical text and stay within the displayed pitch',()=>{
  for(const [width,height] of [[375,475],[667,180],[1200,700]]){
    const bars=[],labels=[],fonts=[],ctx=new Proxy({roundRect:(x,y,w,h)=>bars.push({x,y,w,h}),fillText:(text,x,y)=>labels.push({text,x,y})},{get:(obj,key)=>obj[key]||(()=>{}),set:(obj,key,value)=>{obj[key]=value;if(key==='font')fonts.push(value);return true;}});
    const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width,height})},game=new Game(canvas,{mode:'online'}),view=fitViewport(width,height);
    for(const team of [0,1])for(const [x,y] of [[0,0],[1200,0],[0,700],[1200,700]])game.drawShotPower(ctx,{...game.state.players[team],x,y,charging:true,charge:35});
    assert.equal(bars.length,8);assert.equal(labels.length,8);
    for(const [index,bar] of bars.entries()){
      near(bar.w*view.scale,124);near(bar.h*view.scale,32);
      const fontSize=Number(fonts[index].match(/([0-9.]+)px/)[1]);near(fontSize*view.scale,10);
      assert.ok(bar.x>=0&&bar.y>=0&&bar.x+bar.w<=1200&&bar.y+bar.h<=700);
      assert.ok(labels[index].x>=bar.x&&labels[index].x<=bar.x+bar.w&&labels[index].y>=bar.y&&labels[index].y<=bar.y+bar.h);
    }
  }
});


function withRandom(random,callback){const previous=Math.random;try{Math.random=random;return callback();}finally{Math.random=previous;}}
function fRelease(game,team){game.setInput(team,{shootHeld:true});game.update(.01);game.setInput(team,{shootHeld:false,shootRelease:true});game.update(.01);}

test('every character receives exactly one random Ultra Shot on each third successful F release',()=>{
  for(const character of ['none','manmarker','powershooter','ninja','playmaker','streetdribbler','supersonic'])for(const team of [0,1]){
    const game=match(character),p=game.state.players[team];p.character=character;
    for(let shot=1;shot<=6;shot++){
      game.setOwner(p);withRandom(()=>shot===6?.75:.25,()=>fRelease(game,team));
      assert.equal(p.shotsTaken,shot,`${character}, team ${team}, F shot ${shot}`);
      assert.equal(game.state.players[1-team].shotsTaken,0);
      assert.equal(game.state.ball.shotType,shot===3?'curve':shot===6?'quick':'normal');
      assert.equal(p.shotType,game.state.ball.shotType);assert.equal(game.state.ball.finish.source,'f');
    }
  }
});

test('F shot cycles persist through possession changes and goals, while other kicks do not spend them',()=>{
  const game=match('powershooter'),[p,enemy]=game.state.players;
  game.setOwner(p);fRelease(game,0);assert.equal(p.shotsTaken,1);
  game.setOwner(enemy);assert.equal(game.kick(p,50,{fromF:true}),false);assert.equal(p.shotsTaken,1);
  game.setOwner(p);game.kick(p,40);assert.equal(p.shotsTaken,1,'ability kicks do not use F progress');
  game.setOwner(p);fRelease(game,0);assert.equal(p.shotsTaken,2);assert.equal(game.shotMeter({...p,charging:true,charge:5}).label,'ULTRA POWER');
  game.goal(0);advance(game,5.01);advance(game,game.state.replayDuration+.01);assert.equal(p.shotsTaken,2);
  game.state.kickoff=null;game.setOwner(p);withRandom(()=>.75,()=>fRelease(game,0));
  assert.equal(p.shotsTaken,3);assert.equal(game.shotMeter(p).label,'ULTRA QUICK');
  const fresh=match();assert.ok(fresh.state.players.every(player=>player.shotsTaken===0));
});

test('a maximum-charge automatic F release spends one cycle entry, preserved online and in replay frames',()=>{
  const game=match(),p=game.state.players[0];game.setOwner(p);Object.assign(p,{shotsTaken:2,charging:true,charge:100,maxHold:3.99});
  game.setInput(0,{shootHeld:true});withRandom(()=>.25,()=>game.update(.02));
  assert.equal(p.shotsTaken,3);assert.equal(p.shotType,'curve');assert.equal(game.state.ball.power,100);
  game.setInput(0,{shootHeld:false,shootRelease:true});game.update(.01);assert.equal(p.shotsTaken,3);
  const guest=new Game(null,{mode:'guest',localTeam:1});guest.importState(game.exportState());
  assert.equal(guest.state.players[0].shotsTaken,3);assert.equal(guest.state.ball.shotType,'curve');assert.deepEqual(guest.state.ball.finish,game.state.ball.finish);
  assert.equal(game.shotReplay[0].players[0].shotsTaken,3);assert.equal(game.shotReplay[0].players[0].shotType,'curve');assert.equal(game.shotReplay[0].ball.shotType,'curve');
});

test('shared shoot controls send one press and release through the guest input channel',()=>{
  const host=match(),p=host.state.players[1],sent=[];host.setOwner(p);
  const guest=new Game(null,{mode:'guest',localTeam:1,onInput:input=>{sent.push(input);host.setInput(1,input);}});guest.importState(host.exportState());
  assert.equal(guest.startShot(),true);assert.equal(guest.startShot(),false);host.update(.01);
  assert.equal(guest.releaseShot(),true);assert.equal(guest.releaseShot(),false);host.update(.01);
  assert.equal(sent.length,2);assert.equal(sent[0].shootHeld,true);assert.equal(sent[1].shootRelease,true);assert.equal(p.shotsTaken,1);
  guest.state.phase='ended';assert.equal(guest.startShot(),false);assert.equal(sent.length,2);
});

test('finishing chance falls smoothly with distance and remains low for long-range and own-goal attempts',()=>{
  for(const power of [5,40,100])for(const shotType of ['normal','curve','quick'])for(const finishBoost of [0,.18]){
    let previous=1;
    for(const distance of [0,300,500,700,1100,1300,1498,1500,1800,2200]){
      const chance=finishingChance({distance,power,shotType,finishBoost});assert.ok(chance>0&&chance<1);assert.ok(chance<=previous+.000001);previous=chance;
      if(distance>=1500)assert.ok(chance<=.045);
      assert.ok(finishingChance({distance,power,shotType,finishBoost,ownGoal:true})<=.015);
    }
    if(shotType!=='normal')assert.ok(finishingChance({distance:500,power,shotType,finishBoost})>finishingChance({distance:500,power,finishBoost}));
  }
});

test('finishing is sampled once per actual attempt, never rerolled during flight',()=>{
  const game=match(),p=game.state.players[0];Object.assign(p,{x:150,y:140,aim:{x:1130,y:140}});game.setOwner(p);
  let calls=0;withRandom(()=>{calls++;return .6;},()=>{game.kick(p,20,{fromF:true});const profile=game.state.ball.finish;advance(game,.5);assert.equal(game.state.ball.finish,profile);assert.equal(profile.roll,.6);});
  assert.equal(calls,1);assert.equal(p.shotsTaken,1);
});

function simulatedShot(type,originX,targetX,roll,team=0,extra={}){
  const events=[],game=match('none',{onEvent:event=>events.push(event)}),p=game.state.players[team];
  Object.assign(p,{x:originX,y:350,aim:{x:targetX,y:275},shotsTaken:type==='normal'?0:2});Object.assign(game.state.players[1-team],{x:600,y:580});game.setOwner(p);
  let draw=0;withRandom(()=>type==='normal'?roll:draw++===0?(type==='curve'?.25:.75):roll,()=>game.kick(p,40,{fromF:true,...extra}));
  const profile=game.state.ball.finish;for(let i=0;i<400&&game.state.phase==='play'&&typeof game.state.ball.owner!=='string';i++)game.update(.01);
  return {game,p,profile,events,scored:game.state.score.some(Boolean)};
}

test('seeded real shot flights make Ultra shots more effective nearby while far and own-goal shots stay rare',()=>{
  let seed=453121;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(const team of [0,1]){
    const rates={};for(const [name,x,target]of [['near',880,1130],['midfield',680,1130],['deep-midfield',600,1130],['far',150,1130],['own',250,70]])for(const type of ['normal','curve','quick']){
      let goals=0;for(let i=0;i<300;i++)goals+=Number(simulatedShot(type,team?1200-x:x,team?1200-target:target,random(),team).scored);
      rates[`${name}-${type}`]=goals/300;
    }
    for(const range of ['near','midfield','deep-midfield']){
      assert.ok(rates[`${range}-normal`]>.1&&rates[`${range}-normal`]<.8,JSON.stringify(rates));
      for(const type of ['curve','quick'])assert.ok(rates[`${range}-${type}`]>rates[`${range}-normal`]+.05&&rates[`${range}-${type}`]<.95,JSON.stringify(rates));
    }
    for(const type of ['normal','curve','quick']){assert.ok(rates[`far-${type}`]<=.05,JSON.stringify(rates));assert.ok(rates[`own-${type}`]<=.03,JSON.stringify(rates));}
  }
});

test('a losing finishing roll produces a visible keeper save, while a winning roll still needs a real on-target flight',()=>{
  const failed=simulatedShot('quick',880,1130,.999);assert.equal(failed.scored,false);assert.equal(failed.game.state.ball.owner,'k1');assert.ok(failed.events.some(event=>event.type==='save'));assert.ok(failed.game.effects.some(effect=>effect.type==='save'||effect.type==='dive'));
  const game=match(),p=game.state.players[0];Object.assign(p,{x:880,y:140,aim:{x:1130,y:140}});game.setOwner(p);withRandom(()=>0,()=>game.kick(p,40,{fromF:true}));advance(game,1);
  assert.deepEqual(game.state.score,[0,0],'a favorable finishing roll never makes an off-target attempt score');
});

test('old guaranteed ability shots remain saveable and cannot escape distance or own-goal limits',()=>{
  for(const [x,target]of [[880,1130],[150,1130],[250,70]]){
    const result=simulatedShot('normal',x,target,.999,0,{fromF:false,finishBoost:.18,air:true});
    assert.equal(result.scored,false);assert.equal(result.p.shotsTaken,0);assert.equal(result.game.state.ball.owner,target===70?'k0':'k1');
    if(x===150)assert.ok(result.profile.chances[1]<=.045);if(target===70)assert.ok(result.profile.chances[0]<=.015);
  }
});

test('keeper distributions and MANMARK reflections replace stale finishing metadata without spending F progress',()=>{
  const game=match('manmarker'),p=game.state.players[0],enemy=game.state.players[1];p.shotsTaken=2;
  game.keeperCatch(game.state.keepers[0]);const stale={roll:0,chances:[1,1]};Object.assign(game.state.ball,{finish:stale,savePower:100,knuckle:true});advance(game,2.02);
  assert.equal(game.state.ball.owner,null);assert.equal(game.state.ball.savePower,game.state.ball.power);assert.equal(game.state.ball.knuckle,false);assert.equal(game.state.ball.finish.source,'distribution');assert.notEqual(game.state.ball.finish,stale);assert.equal(p.shotsTaken,2);
  game.resetKickoff(0);game.state.kickoff=null;Object.assign(p,{x:350,y:170});Object.assign(enemy,{x:450,y:170});game.setInput(0,{skill:2});game.update(.01);
  Object.assign(game.state.ball,{owner:null,x:p.x+10,y:p.y,z:0,vx:300,vy:0,power:60,savePower:60,lastKickTeam:1,lastKickAgo:.1,pickupDelay:0,finish:stale,shotType:'quick'});
  game.update(.01);assert.equal(game.state.ball.finish.source,'reflection');assert.equal(game.state.ball.finish.team,0);assert.notEqual(game.state.ball.finish,stale);assert.equal(game.state.ball.shotType,'normal');assert.equal(game.state.ball.savePower,30);assert.equal(game.state.ball.power,30);assert.ok(game.state.ball.pickupDelay>0);assert.equal(p.shotsTaken,2);
});


test('a favorable finishing roll still lets a well-positioned keeper physically save central shots of every type',()=>{
  for(const team of [0,1])for(const type of ['normal','curve','quick']){
    const game=match(),p=game.state.players[team];Object.assign(p,{x:team?320:880,y:350,aim:{x:team?70:1130,y:350},shotsTaken:type==='normal'?0:2});game.setOwner(p);
    let draw=0;withRandom(()=>type==='normal'?0:draw++===0?(type==='curve'?.25:.75):0,()=>game.kick(p,40,{fromF:true}));
    advance(game,.8);assert.equal(game.state.ball.owner,team?'k0':'k1');assert.deepEqual(game.state.score,[0,0]);
  }
});

test('formerly guaranteed awakened shots aim at a real corner and can score or be saved without using the F cycle',()=>{
  for(const roll of [0,.999]){
    const game=match('supersonic'),p=game.state.players[0];Object.assign(p,{x:800,y:350,awakened:true,awakeningLeft:45,ability:{awakeningActive:true}});game.setOwner(p);
    game.setInput(0,{skill:1});game.update(.01);withRandom(()=>roll,()=>advance(game,3.01));
    assert.equal(game.state.ball.finish.source,'ability');assert.equal(p.shotsTaken,0);assert.equal(game.state.ball.finish.chances[1]>.8,true);
    for(let i=0;i<100&&game.state.phase==='play'&&typeof game.state.ball.owner!=='string';i++)game.update(.01);
    assert.equal(game.state.score[0],roll===0?1:0);if(roll>.9)assert.equal(game.state.ball.owner,'k1');
  }
});


test('a Quick Shot preserves maximum-charge airtime instead of arriving below normal keeper clearance',()=>{
  for(const team of [0,1])for(const type of ['normal','curve','quick']){
    const game=match(),p=game.state.players[team];Object.assign(p,{x:team?500:700,y:350,aim:{x:team?70:1130,y:350},shotsTaken:type==='normal'?0:2});Object.assign(game.state.players[1-team],{x:600,y:580});game.setOwner(p);
    let draw=0;withRandom(()=>type==='normal'?0:draw++===0?(type==='curve'?.25:.75):0,()=>game.kick(p,100,{fromF:true,air:true}));
    const profile=game.state.ball.finish;for(let i=0;i<100&&game.state.phase==='play';i++)game.update(.01);
    assert.equal(game.state.score[team],1,`${type} maximum-charge shot should retain its airborne route, team ${team}`);assert.ok(profile.chances[1-team]<1);
  }
});

test('the original pitch dimensions preserve the established running speed',()=>{
  const game=match();assert.equal(game.width,1200);assert.equal(game.height,700);
  const p=game.state.players[0],x=p.x;game.setInput(0,{keys:{d:true}});advance(game,1);near(p.x-x,194);
  game.resetKickoff(1);assert.equal(game.state.ball.x,600);assert.equal(game.state.ball.y,350);
  assert.deepEqual(game.state.keepers.map(k=>k.x),[98,1102]);
});

test('the replay retains only the last ten seconds and only the scorer can skip it',()=>{
  const game=match();advance(game,14);const time=game.state.time;game.state.ball.lastTouch=0;game.goal(0);
  assert.ok(game.goalReplay.length>=120&&game.goalReplay.length<=127);
  assert.ok(game.goalReplay[0].at>=game.state.elapsed-10);
  assert.ok(game.goalReplay.at(-1).at-game.goalReplay[0].at<=10);
  assert.equal(game.state.scorerTeam,0);assert.equal(game.skipReplay(1),false);
  assert.equal(game.state.phase,'celebrate');assert.equal(game.skipReplay(0),true);
  assert.equal(game.state.phase,'play');assert.equal(game.state.kickoff.team,1);near(game.state.time,time);
  assert.equal(game.skipReplay(0),false,'a repeated command cannot alter live play');
});

test('guest scorer skip is forwarded and the host validates its team during replay',()=>{
  const host=match();host.state.ball.lastTouch=1;host.goal(1);advance(host,5.01);assert.equal(host.state.phase,'replay');
  const sent=[],guest=new Game(null,{mode:'guest',localTeam:1,onInput:input=>{sent.push(input);host.setInput(1,input);}});guest.importState(host.exportState());
  assert.equal(guest.skipReplay(0),false);assert.equal(sent.length,0);
  assert.equal(guest.skipReplay(),true);assert.equal(sent.length,1);assert.equal(sent[0].skipReplay,true);
  assert.equal(host.state.phase,'play');assert.equal(host.state.kickoff.team,0);
  guest.importState(host.exportState());assert.equal(guest.skipReplay(),false);
});

test('an own goal credits the scoring team and gives that team the replay skip',()=>{
  const game=match();game.state.ball.lastTouch=0;game.goal(1);
  assert.equal(game.state.scorerTeam,1);assert.equal(game.state.scorer,1);
  assert.deepEqual(game.state.players.map(p=>p.stats.goals),[0,1]);
  assert.equal(game.skipReplay(0),false);assert.equal(game.skipReplay(1),true);
});

test('possession age survives repeated ownership calls and resets after losing the ball',()=>{
  const game=match(),[p,opponent]=game.state.players;game.setOwner(p);advance(game,10.1);
  assert.ok(p.possessionAge>=10);const receivedAt=p.receivedAt;game.setOwner(p);
  assert.equal(p.receivedAt,receivedAt);assert.ok(p.possessionAge>=10);
  game.setOwner(opponent);advance(game,.1);assert.equal(p.possessionAge,0);
  game.setOwner(p);assert.equal(p.possessionAge,0);assert.ok(p.receivedAt>10);
});

test('perfect passes cannot be picked up or caught while their source controls the delivery',()=>{
  const game=match(),p=game.state.players[0],keeper=game.state.keepers[1];
  Object.assign(p,{x:keeper.x,y:keeper.y});Object.assign(game.state.ball,{x:p.x,y:p.y,owner:null,z:0,vx:500,vy:0,perfectPass:{fromId:99,targetId:99,left:1}});
  const origin={x:game.state.ball.x,y:game.state.ball.y};advance(game,.1);
  assert.equal(game.state.ball.owner,null);assert.equal(game.state.ball.x,origin.x);assert.equal(game.state.ball.y,origin.y);
  assert.equal(game.setOwner(p),false);assert.ok(game.state.ball.perfectPass);game.state.ball.perfectPass.targetId=p.id;assert.equal(game.setOwner(p),true);assert.equal(game.state.ball.perfectPass,null);
});

test('scripted wall moves cannot score or be caught before their return completes',()=>{
  const game=match(),keeper=game.state.keepers[1];
  Object.assign(game.state.ball,{x:1129,y:350,owner:null,vx:500,vy:0,z:0,cannotScore:true,scriptedReturn:true,lastKickTeam:0});
  Object.assign(keeper,{x:1122,y:350});advance(game,.1);
  assert.deepEqual(game.state.score,[0,0]);assert.equal(game.state.phase,'play');assert.ok(game.state.ball.vx<0);assert.equal(game.state.ball.owner,null);
  game.setOwner(game.state.players[0]);assert.equal(game.state.ball.cannotScore,false);assert.equal(game.state.ball.scriptedReturn,false);
});

test('only explicitly scripted instant-goal specials bypass saves and keep their visible shot trace',()=>{
  for(const team of [0,1]){
    const game=match(),p=game.state.players[team];game.setOwner(p);
    const fCount=p.shotsTaken;assert.equal(game.guaranteedGoal(p,{power:100,color:'#56aaff',air:true}),true);
    assert.equal(game.state.phase,'play');assert.ok(game.state.ball.scriptedGoal);assert.equal(p.shotsTaken,fCount);
    advance(game,.3);assert.equal(game.state.phase,'play');assert.equal(game.state.ball.owner,null);assert.ok(game.state.ball.z>0);
    advance(game,.3);assert.equal(game.state.phase,'celebrate');assert.equal(game.state.score[team],1);
    assert.ok(game.goalReplay.length>=5);assert.equal(game.state.scorerTeam,team);
  }
});

test('both local teams initially aim toward their opponent goal before moving the pointer',()=>{
  for(const localTeam of [0,1]){
    const game=new Game(null,{mode:'online',localTeam});game.state.kickoff=null;
    const p=game.state.players[localTeam];game.setOwner(p);game.startShot();game.update(.01);game.releaseShot();game.update(.01);
    assert.equal(game.localInput.aim.x,localTeam?70:1130);
    assert.ok(localTeam?game.state.ball.vx<0:game.state.ball.vx>0);
  }
});

test('bots activate all character awakenings only when their possession requirement is satisfied',()=>{
  for(const [character,hasBall] of [['ninja',true],['ice',false],['falcon',false],['magician',true],['trapper',true],['playmaker',false]]){
    const {game,bot,human}=botAttack(character);game.setOwner(hasBall?bot:human);bot.awakeningCharge=100;
    game.state.lastAwakeningRecipient=bot.id;game.state.awakeningOwner=bot.id;game.update(.01);
    assert.equal(bot.awakened,true,character);assert.equal(game.state.phase,'cutscene');
  }
  for(const character of ['ninja','magician','trapper']){
    const {game,bot,human}=botAttack(character);game.setOwner(human);bot.awakeningCharge=100;
    game.update(.01);assert.equal(bot.awakened,false,character);
  }
});

test('Trapper first-touch speed and power apply immediately, double in awakening, and expire after 2.5 seconds',()=>{
  for(const awakened of [false,true]){
    const game=match('trapper'),p=game.state.players[0];Object.assign(p,{awakened,awakeningLeft:75,ability:{awakeningActive:awakened}});game.setOwner(p);
    assert.equal(p.receiptPowerBonus,awakened?40:20);p.charging=true;p.charge=5;
    assert.equal(game.shotMeter(p).power,awakened?45:25);
    assert.equal(game.captureFrame().players[0].receiptPowerBonus,awakened?40:20);
    game.setInput(0,{keys:{d:true}});const x=p.x;advance(game,.25);
    near(p.x-x,194*(awakened?3:2)*.8*.25);
    game.setInput(0,{keys:{}});advance(game,2.3);assert.equal(p.receiptPowerBonus,0);
    const before=p.x;game.setInput(0,{keys:{d:true}});advance(game,.1);near(p.x-before,194*.8*.1);
    game.kick(p,5);assert.equal(game.state.ball.power,5);
    game.setOwner(p);game.kick(p,5);assert.equal(game.state.ball.power,awakened?45:25);
  }
});

test('new Ninja follow-up uses its own cooldown and invincibility while the standalone dash stays vulnerable',()=>{
  const game=match('ninja'),p=game.state.players[0];game.setOwner(p);const origin=p.x;
  game.useSkill(2);game.update(.01);assert.equal(p.cooldowns[1],15);assert.equal(p.invincible,0);
  advance(game,.36);near(p.x-origin,game.width/5);assert.ok(p.ability.precisionFollowup>0);
  const after=p.x;assert.equal(game.useSkill(2),true);game.update(.01);
  assert.equal(p.cooldowns[1],20);assert.ok(p.invincible>.4);advance(game,.43);near(p.x-after,game.width/4);
});

test('new cinematic shot windups display their promised power before releasing once',()=>{
  for(const [character,slot,power,duration]of [['ninja',3,65,1.6],['falcon',1,80,2.4],['magician',3,90,3.5]]){
    const game=match(character),p=game.state.players[0];Object.assign(p,{awakened:true,awakeningLeft:60,ability:{awakeningActive:true}});game.setOwner(p);
    game.useSkill(slot);game.update(.01);assert.equal(game.state.phase,'cutscene',character);
    assert.equal(game.shotMeter(p).power,power);assert.equal(game.shotMeter(p).label,'WINDUP');
    advance(game,duration/2);near(game.shotMeter(p).fill,.5,.01);
    advance(game,duration/2+.01);assert.equal(game.state.ball.power,power);assert.equal(p.shotsTaken,0);
    assert.equal(game.shotMeter(p).label,'SHOT');
    if(character==='ninja')assert.equal(game.state.ball.knuckle,true);
  }
});

test('leaps keep a ground shadow, lift the sprite, serialize into replays, and end naturally',()=>{
  const game=match('falcon'),p=game.state.players[0],translations=[];
  p.leap=.7;assert.equal(game.captureFrame().players[0].leap,.7);
  const gradient={addColorStop(){}},ctx=new Proxy({translate:(...args)=>translations.push(args),createRadialGradient:()=>gradient},{get:(o,k)=>o[k]||(()=>{})});game.drawPlayer(ctx,p);
  assert.deepEqual(translations[0],[p.x,p.y]);assert.ok(translations.some(([x,y])=>x===0&&y===-40));
  advance(game,.71);assert.equal(p.leap,0);
});

test('cutscene choreography stays serializable and cosmetic while showing five distinct chip-and-feint stages',()=>{
  const game=match('trapper'),[p,opponent]=game.state.players;game.setOwner(opponent);
  const before=JSON.stringify({players:game.state.players,ball:game.state.ball});game.cutscene(6,['Thanks','FEINT!','FEINT!','VOLLEY!','Ultimate'],'#5eabff',null,{kind:'hexchamber',actorId:p.id,targetId:opponent.id,aim:{x:1130,y:350}});
  const positions=[];for(let stage=0;stage<5;stage++){
    const view=game.cutsceneView(.12+(stage+.5)/5*.88),actor=view.players.find(q=>q.id===p.id),rival=view.players.find(q=>q.id===opponent.id);
    assert.ok(view.ball.z>80);assert.equal(actor.pose,'volley');assert.ok(Number.isFinite(rival.x));positions.push(actor.x);
  }
  assert.ok(positions.every((x,i)=>i===0||x>positions[i-1]));assert.equal(JSON.stringify({players:game.state.players,ball:game.state.ball}),before);
  game.state.phaseTime=2;const hostView=game.cutsceneView(),guest=new Game(null,{mode:'guest',localTeam:1});guest.importState(game.exportState());const guestView=guest.cutsceneView();
  near(guestView.ball.x,hostView.ball.x);near(guestView.ball.z,hostView.ball.z);near(guestView.players[0].x,hostView.players[0].x);
  assert.equal(guest.state.cutscene.choreography.kind,'hexchamber');
});

test('bicycle and scorpion cinematics visibly lift and rotate the actor before the real kick',()=>{
  for(const kind of ['bicycle','scorpion']){
    const game=match('falcon'),p=game.state.players[0];game.setOwner(p);const original={x:p.x,y:p.y};
    game.cutscene(2.4,[kind],'#d3dde7',null,{kind,actorId:p.id,aim:{x:1130,y:350}});
    const view=game.cutsceneView(.5),actor=view.players[0];assert.equal(actor.pose,kind);assert.ok(actor.visualLift>70);assert.ok(Math.abs(actor.poseRotation)>1);assert.ok(view.ball.z>90);
    assert.deepEqual({x:p.x,y:p.y},original);assert.equal(game.state.ball.owner,p.id);
  }
});

test('give-and-go cinematics show the pass, run into the box, return, and header pause',()=>{
  const game=match('magician'),p=game.state.players[0],mate={...p,id:2,x:550,y:450,name:'TEAMMATE'};game.state.players.push(mate);game.setOwner(p);
  game.cutscene(3.2,['Pass','Run','Return','Header'],'#ff84cf',null,{kind:'give-and-go',actorId:p.id,mateId:mate.id});
  const first=game.cutsceneView(0),pass=game.cutsceneView(.3),run=game.cutsceneView(.6),header=game.cutsceneView(.94);
  near(first.ball.x,p.x);near(pass.ball.x,mate.x);assert.ok(run.players[0].x>p.x+450);
  near(header.ball.x,game.width*.87);assert.equal(header.players[0].pose,'header');assert.ok(header.players[0].visualLift>50);
  assert.equal(p.x,350);assert.equal(mate.x,550);assert.equal(game.state.ball.owner,p.id);
});

test('Hexchamber first rushes to trap the shot, then chips toward the correct goal for either team',()=>{
  for(const team of [0,1]){
    const game=match('trapper'),p=game.state.players[team],opponent=game.state.players[1-team];
    Object.assign(game.state.ball,{owner:null,x:600,y:350,z:40});let finalView;
    game.cutscene(6,['Trap','FEINT!','Ultimate'],'#5eabff',view=>{finalView=view;},{kind:'hexchamber',actorId:p.id,targetId:opponent.id});
    const rush=game.cutsceneView(.06),trap=game.cutsceneView(.12),last=game.cutsceneView(1);
    near(rush.ball.x,600);near(rush.ball.y,350);
    near(trap.players[team].x,600);near(trap.players[team].y,350);
    assert.ok(team?last.players[team].x<600:last.players[team].x>600);
    advance(game,6.01);assert.ok(finalView);near(finalView.players[team].x,last.players[team].x);
  }
});
