import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeGameplayAuth } from './ops/compose-gameplay-auth.mjs';
const names=['index.html','style.css','app.js','build.mjs','package.json','vercel.json'];
const receiver=Object.fromEntries(names.map(p=>[p,readFileSync(new URL('./test/fixtures/legacy-pixel-receiver/'+p,import.meta.url),'utf8')]));
const input=()=>({
  'index.html':'<header>new tabs</header><main>BOT 1v1 new cards</main><link href="./style.css?v=15"><script src="./app.js?v=21"></script></body>',
  'style.css':'.new-game-ui{opacity:.4}', 'app.js':'/* new gameplay entry with unchanged guest storage */',
  'build.mjs':"for(const file of ['index.html','style.css','app.js','game.js','characters.js','online.js','bot-brain.js','vendor/peerjs.min.js']){}",
  'package.json':JSON.stringify({name:'rematch-rush',type:'module',engines:{node:'24.x'},scripts:{test:'node --test *.test.mjs',build:'node build.mjs',newGameCheck:'preserve-me'}}),
  'vercel.json':JSON.stringify({outputDirectory:'dist',buildCommand:'npm test && npm run build',framework:null}),
});
test('auth composition preserves new game entry, mode cards, CSS, scripts and bot asset',()=>{
  const gameplay=input(),before=structuredClone(gameplay),r=composeGameplayAuth({gameplay,receiver});
  assert.deepEqual(gameplay,before);assert.equal(r.preservedGameEntry,gameplay['app.js']);assert.equal(r.patch['app.js'],undefined);
  assert.ok(r.patch['index.html'].includes('BOT 1v1 new cards'));assert.ok(r.patch['index.html'].includes('./app.js?v=21'));
  assert.ok(r.patch['index.html'].includes('./style.css?v=16'));assert.ok(r.patch['index.html'].includes('pixel-account-create-confirm'));
  assert.ok(r.patch['style.css'].startsWith(gameplay['style.css']));assert.ok(r.publicAssets.includes('bot-brain.js'));
  assert.ok(r.patch['build.mjs'].includes('"bot-brain.js"'));assert.ok(r.patch['build.mjs'].includes('"pixel-account.js"'));
  assert.equal(JSON.parse(r.patch['package.json']).scripts.newGameCheck,'preserve-me');assert.equal(r.activationAuthorized,false);
  assert.deepEqual(JSON.parse(r.patch['vercel.json']).functions,JSON.parse(receiver['vercel.json']).functions);
});
for(const [label,change] of [
  ['duplicate UI',g=>g['index.html']+='id="pixel-account"'],
  ['changed header',g=>g['index.html']=g['index.html'].replace('</header>','')],
  ['missing bot asset',g=>g['build.mjs']=g['build.mjs'].replace("'bot-brain.js',",'')],
  ['conflicting dependency',g=>{const p=JSON.parse(g['package.json']);p.dependencies={jose:'wrong'};g['package.json']=JSON.stringify(p);}],
  ['unknown new dependency',g=>{const p=JSON.parse(g['package.json']);p.dependencies={'new-game-dependency':'1.0.0'};g['package.json']=JSON.stringify(p);}],
  ['unknown routing',g=>{const c=JSON.parse(g['vercel.json']);c.rewrites=[];g['vercel.json']=JSON.stringify(c);}],
])test('auth composition refuses '+label+' rather than overwriting newer source',()=>{const gameplay=input();change(gameplay);assert.throws(()=>composeGameplayAuth({gameplay,receiver}));});

test('legacy Pixel composition refuses a site that has selected Rematch-native accounts',()=>{const gameplay=input();gameplay['index.html']+='<section id="rematch-account"></section>';assert.throws(()=>composeGameplayAuth({gameplay,receiver}),/native accounts/);});
