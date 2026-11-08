import {createHash} from 'node:crypto';
import {SESSION_COOKIE,SITE_ORIGIN} from './pixel-handler.mjs';
const actions=new Set(['status','leaderboard','equip','variant','spin','start','finish','appeal','admin','appeals','dismiss']);
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
export function createGameHandler({getService}){return async request=>{
 const u=new URL(request.url),action=u.pathname.split('/').at(-1);if(!actions.has(action))return reply({error:'Unknown game operation.'},404);
 const read=['status','leaderboard'].includes(action);if(request.method!==(read?'GET':'POST'))return reply({error:'Method not allowed.'},405);
 if(!read&&(request.headers.get('Origin')!==SITE_ORIGIN||request.headers.get('Content-Type')?.split(';')[0]!=='application/json'))return reply({error:'Invalid request origin or type.'},403);
 let input={};if(!read){try{const text=await request.text();if(Buffer.byteLength(text)>4000000)return reply({error:'Request too large.'},413);input=JSON.parse(text);if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch{return reply({error:'Invalid request body.'},400);}}
 const cookies=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${SESSION_COOKIE}=`)),token=cookies.length===1?cookies[0].slice(SESSION_COOKIE.length+1):null;
 try{const service=getService();if(!service)return reply({available:false,error:'Account game storage is not configured.'},503);if(action==='leaderboard')return reply({league:await service.leaderboard()});if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return action==='status'?reply({available:true,authenticated:false}):reply({error:'Sign in to your Rematch account.'},401);const result=await service.run(createHash('sha256').update(token).digest('hex'),action,input);return reply({available:true,...result});}
 catch(e){const status=Number.isInteger(e.status)?e.status:503;return reply({error:status<500?e.message:'Account game storage is temporarily unavailable.',...(e.uncertain?{uncertain:true}:{})},status);}
};}
