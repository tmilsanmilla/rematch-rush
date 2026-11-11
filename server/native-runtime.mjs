import {readNativeConfig,createNativeVerifier,createNativeHandler} from './native-account.mjs';
import {readTargetConfig} from './pixel-target.mjs';
import {createNativeStore} from './native-store.mjs';
export function createNativeRuntime(env=process.env,{makeStore=createNativeStore,makeVerifier=createNativeVerifier}={}){let deps;return createNativeHandler({getDependencies(){const config=readNativeConfig(env);if(!config)return null;return deps||=( {config,verify:makeVerifier(config),store:makeStore(readTargetConfig(env),{history:config.history})});}});}
let handler;export function serveNativeRequest(request){handler??=createNativeRuntime();const u=new URL(request.url);return handler(new Request('https://rematch-rush.vercel.app'+u.pathname,request));}
