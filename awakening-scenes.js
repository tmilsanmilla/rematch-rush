// Presentation only: deterministic views never change possession or match RNG.
const TAU=Math.PI*2,clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),lerp=(a,b,t)=>a+(b-a)*clamp(t);
const themes={manmarker:['#ffe45e','radar'],ice:['#8ceaff','frost'],powershooter:['#ff923d','lightning'],ninja:['#75ff98','shadow'],playmaker:['#5eabff','binary'],falcon:['#d3dde7','wings'],streetdribbler:['#c17aff','street'],magician:['#ff84cf','magic'],trapper:['#5eabff','geometry'],serpent:['#75ff98','serpent'],butterflydancer:['#ffe45e','butterfly'],supersonic:['#ff4165','speed'],emperor:['#65a5ff','royal'],malicia:['#ffe45e','halo'],raven:['#ad85ff','crow']};
function seedOf(s){let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
export function awakeningScene(p,{title='Awakening',slot=-1,kind='',intro=false}={}){
 const id=`${p.character}:${p.dlsi?.awakening?'dlsi':'base'}:${slot}:${title}`,seed=seedOf(id),[color,theme]=themes[p.character]||['#ffe45e','street'];
 const word=(title+' '+kind).toLowerCase();
 const pose=intro?'rise':/bicycle|fallr|sword/.test(word)?'bicycle':/joker shot|instant pay-off|rabona/.test(word)?'rabona':/trivela|curve|curva|magnus/.test(word)?'curve':/knuckle/.test(word)?'knuckle':/roulette|roleta|nutmeg|ginga/.test(word)?'roulette':/scorpion/.test(word)?'scorpion':/header|head-away/.test(word)?'header':/heel/.test(word)?'backheel':/volley|direct/.test(word)?'volley':/pass|assist|chemical/.test(word)?'pass':/dribbl|ginga|dance|swerve|finta|fadeaway/.test(word)?'feint':/trap|kill|takedown|catch|intercept/.test(word)?'trap':/mark|patrol|clear|goalkeep/.test(word)?'block':/slow|speed|velocity|dash|burst|panther/.test(word)?'sprint':/disappear|blindspot|wildcard/.test(word)?'shadow':'strike';
 const beats=intro?['AWAKEN','FOCUS','UNLEASH']:pose==='roulette'?['INVITE','SPIN','BREAK FREE']:pose==='curve'?['WIND UP','BEND','TOP CORNER']:pose==='knuckle'?['PLANT','STRIKE','NO ROTATION']:pose==='rabona'?['CROSS','DISGUISE','RELEASE']:pose==='feint'?['BAIT','BREAK','ESCAPE']:pose==='block'?['READ','LOCK','INTERCEPT']:pose==='pass'?['VISION','CONNECT','DELIVER']:pose==='sprint'?['IGNITE','ACCELERATE','BREAK THROUGH']:pose==='trap'?['READ','CONTROL','TURN']:['FOCUS','CREATE','FINISH'];
 return Object.freeze({id,title:String(title).slice(0,90),character:p.character,color,theme,pose,seed,beats,intro});
}
export function applyAwakeningView(view,spec,t,origins){
 const fx=spec.presentation;if(!fx)return view;
 const actor=view.players.find(p=>p.id===spec.actorId),start=origins.players.find(p=>p.id===spec.actorId);if(!actor||!start)return view;
 // Existing set pieces retain their exact endpoint/ball choreography. These
 // endpoints are also used by some real move callbacks.
 if(spec.kind!=='awakening-pose')return view;
 const dir=actor.team?-1:1,charge=clamp(t/.65),finish=clamp((t-.65)/.35),jump=Math.sin(t*Math.PI),phase=(fx.seed%7)/7;
 actor.x=start.x;actor.y=start.y;actor.pose=fx.pose;actor.poseRotation=0;actor.visualLift=0;
 actor.angle=Math.atan2((spec.aim?.y??350)-start.y,(spec.aim?.x??(actor.team?70:1130))-start.x);
 if(fx.pose==='bicycle'){actor.poseRotation=Math.sin(charge*Math.PI)*Math.PI;actor.visualLift=jump*110;}
 else if(fx.pose==='scorpion'){actor.poseRotation=-jump*.8;actor.visualLift=jump*80;}
 else if(fx.pose==='header'){actor.visualLift=jump*95;actor.x+=dir*25*jump;actor.poseRotation=-jump*.25;}
 else if(fx.pose==='volley'){actor.visualLift=jump*45;actor.poseRotation=jump*.35;}
 else if(fx.pose==='roulette'){actor.x+=dir*70*charge;actor.y+=Math.sin(t*TAU)*28;actor.poseRotation=charge*TAU;actor.step+=t*12;}
 else if(fx.pose==='curve'){actor.x-=dir*30*jump;actor.y+=dir*35*jump;actor.poseRotation=-dir*.8*jump+dir*.5*finish;}
 else if(fx.pose==='knuckle'){actor.x-=dir*14*jump;actor.poseRotation=-.28*jump+finish*.5;actor.visualLift=jump*12;}
 else if(fx.pose==='rabona'){actor.x+=dir*16*jump;actor.poseRotation=.55*jump;actor.visualLift=jump*25;}
 else if(fx.pose==='feint'){actor.x+=dir*60*charge;actor.y+=Math.sin(t*TAU*(1+fx.seed%3))*30;actor.poseRotation=Math.sin(t*TAU)*.4;}
 else if(fx.pose==='sprint'){actor.x+=dir*125*charge;actor.y+=Math.sin(t*Math.PI)*((fx.seed%2?1:-1)*40);actor.step+=t*35;}
 else if(fx.pose==='shadow'){actor.x+=dir*80*(t>.5?1:0);actor.y+=Math.sin(t*TAU)*25;actor.stealth=t>.3&&t<.6?.8:0;}
 else if(fx.pose==='rise'){actor.visualLift=jump*20;actor.poseRotation=Math.sin(t*TAU)*.08;}
 else if(fx.pose==='strike'){actor.poseRotation=-charge*(.2+(fx.seed&255)/510)+finish*.55;actor.x-=dir*(8+((fx.seed>>>8)&255)/12)*jump;actor.y+=(((fx.seed>>>16)&255)/255-.5)*24*jump;}
 actor.x=clamp(actor.x,84,1116);actor.y=clamp(actor.y,79,621);
 if(origins.ball.owner===actor.id){
  const b=view.ball;b.x=actor.x+dir*(22+finish*115);b.y=actor.y+Math.sin((t+phase)*TAU)*8*(1-finish);b.z=['header','bicycle','scorpion','volley'].includes(fx.pose)?15+jump*115:Math.max(0,Math.sin(t*TAU))*12;b.color=fx.color;
  if(fx.pose==='roulette'&&finish<.25){b.x=actor.x+Math.cos(charge*TAU)*26;b.y=actor.y+Math.sin(charge*TAU)*26;b.z=0;}
  if(fx.pose==='curve'){b.y+=dir*Math.sin(finish*Math.PI)*90;b.z+=Math.sin(finish*Math.PI)*40;}
  if(fx.pose==='knuckle'){b.y+=Math.sin(finish*TAU*4)*12*finish;b.z+=finish*18;}
  if(fx.pose==='rabona'){b.y+=25*jump;b.z+=25*finish;}
 }
 return view;
}
export function drawFootballPose(c,p,swing=0){
 const line=(points,color='#192d3c',width=7)=>{c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();};
 const pose=p.pose,boot=(x,y)=>{c.fillStyle='#192d3c';c.fillRect(x-4,y-3,9,7);};
 if(pose==='roulette'){line([[-5,-7],[-18,3],[-11,20]],'#fff6e4',6);line([[-3,8],[11,-1],[20,-19]],'#fff6e4',6);boot(-11,20);boot(20,-19);line([[5,-11],[18,-16],[22,-6]],'#bd8665',5);}
 else if(pose==='rabona'){line([[-4,-7],[5,12],[27,21]],'#fff6e4',7);line([[-3,7],[13,-1],[15,-17]],'#fff6e4',6);boot(27,21);boot(15,-17);}
 else if(pose==='curve'){line([[-5,-7],[-14,-17],[-21,-9]],'#fff6e4',6);line([[-2,7],[14,18],[34,-2]],'#fff6e4',7);boot(34,-2);line([[7,-10],[18,-20]],'#bd8665',5);}
 else if(pose==='knuckle'){line([[-5,-8],[-18,-9]],'#fff6e4',7);line([[-1,8],[20,6],[35,6]],'#fff6e4',7);boot(35,6);line([[6,12],[17,29]],'#bd8665',5);}
 else if(pose==='bicycle'){line([[-3,-5],[-18,-17],[-29,-10]],'#fff6e4',6);line([[-3,6],[13,19],[27,7]],'#fff6e4',6);boot(-29,-10);boot(27,7);}
 else if(pose==='scorpion'){line([[-3,-6],[-22,-8],[-29,5]],'#fff6e4',6);line([[-3,6],[-18,21],[-33,12]],'#fff6e4',6);boot(-29,5);boot(-33,12);}
 else if(pose==='header'){line([[-5,-8],[-18,-13]],'#fff6e4',6);line([[-5,8],[-17,15]],'#fff6e4',6);line([[6,-12],[15,-24]],'#bd8665',5);line([[6,12],[15,24]],'#bd8665',5);}
 else if(pose==='backheel'){line([[-5,-6],[-14,-6],[-26,2]],'#fff6e4',6);line([[-5,7],[-13,13]],'#fff6e4',6);boot(-26,2);}
 else if(pose==='volley'||pose==='strike'||pose==='clear'){line([[-5,-7],[-13,-13]],'#fff6e4',6);line([[-2,6],[12,8],[29,pose==='volley'?-7:12]],'#fff6e4',7);boot(29,pose==='volley'?-7:12);}
 else if(pose==='trap'){line([[-5,-7],[-15,-13]],'#fff6e4',6);line([[-3,7],[12,11],[19,4]],'#fff6e4',6);boot(19,4);}
 else if(pose==='pass'){line([[-6,-7],[-14,-10]],'#fff6e4',6);line([[-2,7],[12,18],[25,18]],'#fff6e4',6);boot(25,18);}
 else if(pose==='feint'){line([[-5,-6],[-15,9],[-5,19]],'#fff6e4',6);line([[-5,6],[12,-7],[20,-15]],'#fff6e4',6);boot(20,-15);}
 else if(pose==='block'||pose==='rise'){line([[-6,-7],[-14,-16]],'#fff6e4',6);line([[-6,7],[-14,16]],'#fff6e4',6);line([[6,-10],[13,-27]],'#bd8665',5);line([[6,10],[13,27]],'#bd8665',5);}
 else{c.fillStyle='#192d3c';c.fillRect(-8,-9+swing,10,7);c.fillRect(-8,3-swing,10,7);c.fillStyle='#fff6e4';c.fillRect(-5,-10+swing,6,3);c.fillRect(-5,7-swing,6,3);}
}
export function drawAwakeningScene(g,c,fx,t,{actor=null,live=false}={}){
 if(!fx)return;const wave=Math.sin(clamp(t)*Math.PI),x=actor?.x??600,y=actor?.y??300;
 c.save();c.strokeStyle=fx.color;c.fillStyle=fx.color;c.globalAlpha=live?.5:.7;c.lineWidth=live?2:3;
 if(!live){c.fillStyle='#08101a';c.globalAlpha=.2;c.fillRect(0,70,1200,470);c.globalAlpha=.65;c.fillStyle=fx.color;}
 const n=live?7:12,r=(live?35:65)+wave*(live?15:65),turn=t*TAU*((fx.seed%3)+1),offset=(fx.seed%360)*Math.PI/180;
 for(let i=0;i<n;i++){
  const a=i/n*TAU+offset,cx=x+Math.cos(a+turn*.15)*r,cy=y+Math.sin(a+turn*.15)*r*.65;
  c.beginPath();
  if(['crow','wings','butterfly'].includes(fx.theme)){c.moveTo(cx-10,cy+8);c.quadraticCurveTo(cx+3,cy-22,cx+18,cy-6);c.lineTo(cx,cy+5);}
  else if(fx.theme==='binary'){c.font='bold 13px monospace';c.fillText(i%2?'0101':'1010',cx,cy);continue;}
  else if(fx.theme==='frost'){c.moveTo(cx-6,cy);c.lineTo(cx+6,cy);c.moveTo(cx,cy-7);c.lineTo(cx,cy+7);c.moveTo(cx-5,cy-5);c.lineTo(cx+5,cy+5);}
  else if(['lightning','speed'].includes(fx.theme)){c.moveTo(cx,cy+16);c.lineTo(cx+7,cy);c.lineTo(cx-5,cy-2);c.lineTo(cx+3,cy-19);}
  else if(fx.theme==='royal'){c.moveTo(cx-10,cy+6);c.lineTo(cx-12,cy-10);c.lineTo(cx-3,cy-3);c.lineTo(cx,cy-16);c.lineTo(cx+5,cy-3);c.lineTo(cx+12,cy-10);c.lineTo(cx+10,cy+6);c.closePath();}
  else if(fx.theme==='geometry'){c.moveTo(cx-9,cy+8);c.lineTo(cx,cy-10);c.lineTo(cx+9,cy+8);c.closePath();}
  else if(fx.theme==='serpent'){c.moveTo(cx-15,cy+8);c.bezierCurveTo(cx-5,cy-22,cx+9,cy+22,cx+16,cy-8);}
  else if(fx.theme==='radar'){c.arc(x,y,r*(i+1)/n,turn,turn+Math.PI*.7);}
  else if(fx.theme==='shadow'){c.moveTo(cx-14,cy+14);c.lineTo(cx+14,cy-14);c.moveTo(cx-8,cy-10);c.lineTo(cx+8,cy+10);}
  else if(fx.theme==='halo'){c.ellipse(cx,cy,13,4,a,0,TAU);}
  else{c.moveTo(cx-7,cy-7);c.lineTo(cx+7,cy+7);c.moveTo(cx+7,cy-7);c.lineTo(cx-7,cy+7);c.arc(cx+18,cy,5,0,TAU);}
  c.stroke();
 }
 if(!live){
  // A staged ground trace and release burst make the follow-through visible
  // without allocating particles or touching simulation/RNG.
  c.save();c.translate(x,y);c.rotate(offset+t*.3);c.globalAlpha=.35*wave;c.lineWidth=3;
  for(let i=0;i<3;i++){c.beginPath();c.ellipse(0,0,45+i*28+wave*45,18+i*12,0,t*TAU,t*TAU+Math.PI*1.5);c.stroke();}
  if(t>.6){c.globalAlpha=(1-t)*.8;for(let i=0;i<8;i++){const a=i*TAU/8;c.beginPath();c.moveTo(Math.cos(a)*35,Math.sin(a)*22);c.lineTo(Math.cos(a)*(60+120*(t-.6)),Math.sin(a)*(40+75*(t-.6)));c.stroke();}}c.restore();
  c.globalAlpha=.8;c.textAlign='center';c.font='italic 900 34px Arial';c.fillStyle=fx.color;c.fillText(fx.title.toUpperCase(),600,120);
  c.font='bold 12px monospace';for(let i=0;i<3;i++){c.globalAlpha=t>=i/3?1:.25;c.fillText(fx.beats[i],460+i*140,490);c.fillRect(407+i*140,501,clamp(t*3-i)*106,3);}
 }c.restore();
}
