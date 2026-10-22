import {mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/vendor',{recursive:true});
for(const file of ['index.html','style.css','app.js','game.js','characters.js','online.js','vendor/peerjs.min.js']) await copyFile(file,`dist/${file}`);
console.log('Rematch Rush built.');
