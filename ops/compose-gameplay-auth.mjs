/** Pure source composition for the existing receiver; no filesystem, target,
 * environment, provider or deployment transport. The caller freezes both inputs.
 * In particular, old auth archive gameplay must never replace newer game files. */
const need = (condition, message) => { if (!condition) throw new Error(message); };
const once = (source, needle) => source.split(needle).length === 2;
export function composeGameplayAuth({ gameplay, receiver }) {
  for (const name of ['index.html', 'style.css', 'app.js', 'build.mjs', 'package.json', 'vercel.json']) {
    need(typeof gameplay?.[name] === 'string', `Missing gameplay source: ${name}`);
    need(typeof receiver?.[name] === 'string', `Missing receiver source: ${name}`);
  }
  const html = gameplay['index.html'];
  need(!html.includes('id="pixel-account"') && !html.includes('pixel-account.js'), 'Receiver UI already present; reconcile instead of duplicating it');
  need(once(html, '</header>') && once(html, '</body>'), 'Gameplay insertion points changed');
  const panel = receiver['index.html'].match(/    <section class="pixel-account"[\s\S]*?<\/section>/)?.[0];
  const script = receiver['index.html'].match(/  <script type="module" src="\.\/pixel-account\.js\?v=\d+"><\/script>/)?.[0];
  const cssMark = '/* Pixel account controls stay separate from the device-local player profile. */';
  need(panel && script && once(receiver['style.css'], cssMark), 'Receiver UI source changed');
  const assetMatch = gameplay['build.mjs'].match(/for\(const file of (\[(?:'[^']+'(?:,)?)+\])\)/);
  need(assetMatch, 'Gameplay build asset list changed; review before composing');
  const assets = JSON.parse(assetMatch[1].replaceAll("'", '"'));
  need(assets.length === new Set(assets).size && assets.every(p => /^[a-zA-Z0-9_./-]+$/.test(p) && !p.includes('..') && !p.startsWith('/')), 'Invalid gameplay asset list');
  need(assets.includes('bot-brain.js') && assets.includes('game.js') && !assets.includes('pixel-account.js'), 'Expected current gameplay assets absent/already composed');
  const build = receiver['build.mjs'];
  need(/export const PUBLIC_ASSETS = Object\.freeze\(\[[^\n]+\]\);/.test(build), 'Receiver build contract changed');
  const packageGame = JSON.parse(gameplay['package.json']), packageAuth = JSON.parse(receiver['package.json']);
  need(packageGame.name === packageAuth.name && packageGame.engines?.node === packageAuth.engines?.node && packageGame.type === packageAuth.type, 'Package identities differ');
  for (const [name, version] of Object.entries(packageGame.dependencies || {})) need(packageAuth.dependencies?.[name] === version, 'Dependency conflict; reconcile the lockfile explicitly');
  const configGame = JSON.parse(gameplay['vercel.json']), configAuth = JSON.parse(receiver['vercel.json']);
  need(!configGame.functions && !configGame.rewrites && configGame.outputDirectory === 'dist' && configGame.buildCommand === configAuth.buildCommand, 'Hosting configuration changed; review explicitly');
  const styleVersion = html.match(/\.\/style\.css\?v=(\d+)/);
  need(styleVersion && once(html, styleVersion[0]), 'Missing unique stylesheet cache version');
  const nextHtml = html.replace('</header>', `</header>\n${panel}`).replace('</body>', `${script}\n</body>`)
    .replace(styleVersion[0], `./style.css?v=${Number(styleVersion[1]) + 1}`);
  const packageNext = { ...packageGame, scripts: { ...packageGame.scripts, 'test:pixel': packageAuth.scripts['test:pixel'] }, dependencies: { ...packageGame.dependencies, ...packageAuth.dependencies } };
  const patch = {
    'index.html': nextHtml,
    'style.css': gameplay['style.css'] + '\n' + receiver['style.css'].slice(receiver['style.css'].indexOf(cssMark)),
    // The game entry and all gameplay/vendor bytes are deliberately untouched.
    'build.mjs': build.replace(/export const PUBLIC_ASSETS = Object\.freeze\(\[[^\n]+\]\);/, `export const PUBLIC_ASSETS = Object.freeze(${JSON.stringify([...assets, 'pixel-account.js'])});`),
    'package.json': JSON.stringify(packageNext, null, 2) + '\n',
    'vercel.json': JSON.stringify({ ...configGame, functions: configAuth.functions }, null, 2) + '\n',
  };
  return Object.freeze({ patch: Object.freeze(patch), preservedGameEntry: gameplay['app.js'], publicAssets: Object.freeze([...assets, 'pixel-account.js']), activationAuthorized: false });
}
