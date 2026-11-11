import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),output=new URL('vendor/neon-auth.min.js',root);
await build({stdin:{contents:"export {createAuthClient} from '@neon/auth';",resolveDir:root.pathname,sourcefile:'rematch-native-sdk-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',outfile:output.pathname});
await writeFile(new URL('vendor/neon-auth.manifest.json',root),JSON.stringify({package:'@neon/auth',version:'0.8.2',entry:'createAuthClient',sha256:createHash('sha256').update(await readFile(output)).digest('hex')},null,2)+'\n');
