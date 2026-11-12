import {mkdir,copyFile,rm} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_ASSETS = Object.freeze(["index.html","style.css","app.js","game.js","characters.js","online.js","bot-brain.js","vendor/peerjs.min.js","pixel-account.js","match-rules.js","penalties.js","progression.js","dlsi.js","game-account.js","match-audit.js","flow.js","flow-characters.js","awakening-scenes.js"]);
const project = dirname(fileURLToPath(import.meta.url));

export async function buildStaticSite({ sourceDirectory = project, outputDirectory = join(project, 'dist') } = {}) {
  if (resolve(sourceDirectory) === resolve(outputDirectory)) throw new Error('Static output must have its own directory.');
  await rm(outputDirectory,{recursive:true,force:true});
  await mkdir(join(outputDirectory,'vendor'),{recursive:true});
  for (const file of PUBLIC_ASSETS) await copyFile(join(sourceDirectory,file),join(outputDirectory,file));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildStaticSite();
  console.log('Rematch Rush built.');
}
