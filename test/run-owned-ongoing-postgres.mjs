// Root-authorized EMPTY LOCAL validation only. This never contacts a cloud DB.
import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {ONGOING_SOURCE_FILES} from './native-ongoing-plan.mjs';
if(process.argv[2]!=='--run-owned-ongoing-local'){console.log('Preparation only. Actual execution requires the separately authorized --run-owned-ongoing-local and an evidence output path.');process.exit(0);}
const output=path.resolve(process.argv[3]||'');assert.ok(output.includes('/outputs/pixel-current-20261106/')&&output.endsWith('.json')&&!fs.existsSync(output),'Exact new owned evidence path required');
const bin='/opt/homebrew/opt/postgresql@17/bin',owned=fs.mkdtempSync('/private/tmp/rematch-enrollment-pg-');fs.chmodSync(owned,0o700);const data=path.join(owned,'data'),socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:0o700});
const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:owned,NODE_ENV:'test'};
const root=path.resolve(new URL('../',import.meta.url).pathname);
const files=ONGOING_SOURCE_FILES;
const context={root,owned,data,socket,port:55472,user:'owned_rematch_test',expiresAt:Date.now()+180000,pins:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]))};
const proof={scope:'NEW_PRIVATE_SOCKET_ONLY_EMPTY_LOCAL_FICTIONAL_SQL;NO_REMOTE_PROVIDER_ACCOUNT_MAIL',startedAt:new Date().toISOString(),owned,started:false,cleanup:{}};
try{
 proof.version=cp.execFileSync(path.join(bin,'postgres'),['--version'],{env,encoding:'utf8'}).trim();assert.match(proof.version,/PostgreSQL\) 17\./);
 cp.execFileSync(path.join(bin,'initdb'),['-D',data,'-A','trust','-U',context.user,'--no-locale','--encoding=UTF8'],{env,stdio:'pipe',timeout:20000});
 fs.appendFileSync(path.join(data,'postgresql.conf'),`\nlisten_addresses=''\nunix_socket_directories='${socket}'\nunix_socket_permissions=0700\nport=55472\nshared_buffers='32MB'\nmax_connections=12\nfsync=off\ntimezone='UTC'\n`);
 cp.execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(owned,'postgres.log'),'-w','-t','10','start'],{env,stdio:'pipe',timeout:15000});proof.started=true;
 const contextFile=path.join(owned,'context.json');fs.writeFileSync(contextFile,JSON.stringify(context),{mode:0o600});
 const run=cp.spawnSync(process.execPath,[path.join(root,'test/native-ongoing-socket.mjs'),contextFile],{env,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});proof.tests={exitCode:run.status,stdout:run.stdout,stderr:run.stderr};if(run.error)throw run.error;proof.status=run.status===0?'PASS':'FAIL';
}catch(error){proof.status='STOPPED';proof.error=String(error.message).slice(0,1800);if(error.stderr)proof.errorStderr=String(error.stderr).slice(0,1800);}
finally{
 if(proof.started){try{cp.execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','-t','10','stop'],{env,stdio:'pipe',timeout:15000});proof.cleanup.ownedServerStopped=true;}catch(error){proof.cleanup.error=String(error.message).slice(0,500);}}
 if(!proof.started&&!fs.existsSync(path.join(data,'postmaster.pid'))||proof.cleanup.ownedServerStopped){fs.rmSync(owned,{recursive:true});proof.cleanup.exactOwnedDirectoryRemoved=true;}
 proof.finishedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(proof,null,2));
}
if(proof.status!=='PASS')process.exitCode=1;
