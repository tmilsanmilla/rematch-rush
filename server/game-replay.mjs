import {Game} from '../game.js';
import {cleanMatchInput,ENGINE_VERSION} from '../match-audit.js';
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
export function replayMatch(plan,audit,{wallSeconds,outcome}={}){
 if(plan.engine!==ENGINE_VERSION)invalid('This match uses a different game engine version.');
 if(!audit||audit.engine!==ENGINE_VERSION||audit.version!==1||audit.overflow||audit.seed!==plan.seed||!Array.isArray(audit.steps)||!Array.isArray(audit.events)||audit.steps.length>60000||audit.events.length>30000)invalid('A complete match record is required.');
 const total=audit.steps.reduce((n,dt)=>{if(!Number.isFinite(dt)||dt<=0||dt>1/30+1e-9)invalid('Invalid simulation step.');return n+dt;},0);if(total>1800||total>wallSeconds+2)invalid('The match record exceeds this run’s elapsed time.');
 const game=new Game(null,{mode:'online',gameFormat:plan.format,settings:plan.settings,players:plan.players,localPlayerId:plan.localPlayerId,seed:plan.seed});game.replayingAudit=true;
 // Replay timing needs only sample timestamps; cinematic choreography and all
 // football simulation still execute the actual engine, without rendering.
 game.recordHistory=function(){if(this.sample>=.1){this.sample%=.1;this.history.push({at:this.replayClock});while(this.history.length>252||this.history.length>1&&this.history[0].at<this.replayClock-25)this.history.shift();}};
 let cursor=0,previous=-1;for(const row of audit.events){if(!Array.isArray(row)||row.length!==3||!Number.isInteger(row[0])||row[0]<previous||row[0]>audit.steps.length||!Number.isInteger(row[1])||!plan.players.some(p=>p.id===row[1]&&!p.isBot))invalid('Invalid recorded actor or ordering.');previous=row[0];cleanMatchInput(row[2]);}
 for(let step=0;step<=audit.steps.length;step++){
  while(cursor<audit.events.length&&audit.events[cursor][0]===step){const [,id,input]=audit.events[cursor++];game.setInput(id,cleanMatchInput(input));}
  if(step<audit.steps.length){if(game.state.phase==='ended')invalid('The record continues after full time.');game.update(audit.steps[step]);}
 }
 if(outcome==='finished'&&game.state.phase!=='ended')invalid('The match has not reached full time.');
 const p=game.state.players.find(p=>p.id===plan.localPlayerId);if(!p||p.isBot)invalid('Missing human match actor.');
 return {score:game.state.score,stats:p.stats,team:p.team,winnerTeam:game.state.winnerTeam,phase:game.state.phase,total};
}
