import {readTargetConfig} from './pixel-target.mjs';
import {createGameStore} from './game-store.mjs';
import {createGameService} from './game-service.mjs';
import {createGameHandler} from './game-handler.mjs';
export function createGameRuntime(env=process.env,{makeStore=createGameStore}={}){let store,service;return {handle:createGameHandler({getService(){if(env.REMATCH_GAME_STORAGE_APPROVED!=='true')return null;if(!service){store=makeStore(readTargetConfig(env),{history:env.REMATCH_GAME_SCHEMA_HISTORY});service=createGameService(store);}return service;}}),close:async()=>store?.close()};}
let runtime;export async function serveGameRequest(request){runtime??=createGameRuntime();return runtime.handle(request);}
