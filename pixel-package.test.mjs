import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PUBLIC_ASSETS, buildStaticSite } from './build.mjs';

const root = dirname(fileURLToPath(import.meta.url));
async function filesUnder(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await filesUnder(join(directory, entry.name), `${name}/`));
    else { assert.equal(entry.isFile(), true, `Only ordinary files belong in a release: ${name}`); result.push(name); }
  }
  return result.sort();
}

test('static build contains all current gameplay and account assets, byte-identical to source', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'rematch-static-package-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const outputDirectory = join(scratch, 'dist');
  await buildStaticSite({ outputDirectory });
  assert.deepEqual(await filesUnder(outputDirectory), [...PUBLIC_ASSETS].sort());
  const expected = ['index.html','style.css','app.js','game.js','characters.js','online.js','pixel-account.js','vendor/peerjs.min.js','match-rules.js','penalties.js','progression.js','dlsi.js','game-account.js','match-audit.js','flow.js','flow-characters.js','awakening-scenes.js','native-account.js','vendor/neon-auth.min.js'];
  if ((await readFile(join(root, 'game.js'), 'utf8')).includes('bot-brain.js')) expected.push('bot-brain.js');
  assert.deepEqual([...PUBLIC_ASSETS].sort(), expected.sort());
  for (const file of PUBLIC_ASSETS) assert.deepEqual(await readFile(join(outputDirectory, file)), await readFile(join(root, file)));
  assert.equal(PUBLIC_ASSETS.some(file => /(?:^|\/)(?:server|api|test|docs|node_modules|\.env)(?:\/|$)|\.(?:sql|test\.mjs)$/.test(file)), false);
  await assert.rejects(buildStaticSite({ sourceDirectory: root, outputDirectory: root }), /own directory/);
});

test('Vercel Node24 configuration separates static output and auth function server sources', async () => {
  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '24.x');
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.buildCommand, 'npm test && npm run build');
  assert.deepEqual(config.functions['api/auth/**/*.js'], { includeFiles: 'server/**', excludeFiles: '{*.test.mjs,test/**,docs/**}' });
  assert.equal(config.rewrites, undefined, 'No catch-all rewrite may swallow the API functions.');
});

test('all seven fixed auth routes export only their Web request method and reference the same server bridge', async () => {
  const expected = new Map([
    ['auth/pixel-pulse/session.js', ['GET', '/api/auth/pixel-pulse/session']],
    ['auth/pixel-pulse/start.js', ['POST', '/api/auth/pixel-pulse/start']],
    ['auth/pixel-pulse/create.js', ['POST', '/api/auth/pixel-pulse/create']],
    ['auth/pixel-pulse/discover.js', ['POST', '/api/auth/pixel-pulse/discover']],
    ['auth/pixel-pulse/sign-out.js', ['POST', '/api/auth/pixel-pulse/sign-out']],
    ['auth/pixel-pulse/cancel.js', ['POST', '/api/auth/pixel-pulse/cancel']],
    ['auth/callback/pixel-pulse.js', ['GET', '/api/auth/callback/pixel-pulse']],
  ]);
  assert.deepEqual((await filesUnder(join(root, 'api'))).filter(f=>f.startsWith('auth/')), [...expected.keys()].sort());
  for (const [file, [method, route]] of expected) {
    const full = join(root, 'api', file), source = await readFile(full, 'utf8');
    assert.match(source, /import \{ servePixelRequest \} from '\.\.\/\.\.\/\.\.\/server\/pixel-runtime\.mjs'/);
    assert.equal(source.includes(`servePixelRequest(request, '${route}')`), true);
    const exports = await import(pathToFileURL(full));
    assert.deepEqual(Object.keys(exports), [method]);
    assert.equal(typeof exports[method], 'function');
  }
});

test('server entry graph resolves every relative import without pulling fixtures or browser gameplay into functions', async () => {
  const queue = [join(root, 'server/pixel-runtime.mjs')], seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.equal(file.startsWith(join(root, 'server') + '/'), true);
    const source = await readFile(file, 'utf8');
    // JSDoc import types are erased at runtime; their .d.ts resolution belongs
    // to the separate TypeScript check, not the executable dependency graph.
    const executableSource = source.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(executableSource, /from\s*['"][^'"]*(?:test\/|\.test\.|fixtures\/|app\.js|game\.js|characters\.js|online\.js)/);
    for (const match of executableSource.matchAll(/(?:from\s*|import\s*\()(['"])(\.{1,2}\/[^'"]+)\1/g)) {
      const dependency = resolve(dirname(file), match[2]);
      assert.equal((await stat(dependency)).isFile(), true);
      queue.push(dependency);
    }
  }
  for (const expected of ['pixel-runtime.mjs', 'pixel-handler.mjs', 'pixel-store.mjs', 'pixel-target.mjs', 'pixel-oidc.mjs']) {
    assert.equal(seen.has(join(root, 'server', expected)), true, `Missing server dependency ${expected}`);
  }
  assert.equal([...seen].some(file => relative(root, file).includes('fixture')), false);
});
