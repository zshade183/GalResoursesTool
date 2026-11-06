import { spawn } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]);
await assert.rejects(access(join(root,'.env')));
assert.deepEqual(await readdir(join(root,'data')),[]);
const child=spawn(join(root,'runtime/node.exe'),[join(root,'app/apps/api/dist/server.js')],{cwd:root,windowsHide:true,env:{...process.env,API_PORT:'0',API_HOST:'127.0.0.1',NODE_ENV:'production',DATABASE_PATH:resolve('data/portable-verification.sqlite'),IMAGE_API_KEY:'',SEEDREAM_API_KEY:'',RUNWAYML_API_SECRET:'',ELEVENLABS_API_KEY:'',OLLAMA_MODEL:'',FREESOUND_API_KEY:''},stdio:['ignore','pipe','pipe']});
try {
 const address=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timeout')),15000);child.on('error',reject);child.stdout.on('data',data=>{const match=String(data).match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});child.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited ${code}`));});});
 async function json(path,body){const r=await fetch(address+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});assert.ok(r.ok,`${path}: ${r.status}`);return r.json();}
 assert.equal((await json('/health')).status,'ok');
 const project=await json('/v1/projects',{name:'Portable smoke test'});
 const scene=await json(`/v1/projects/${project.id}/characters`,{name:'Room',description:'Layout',kind:'scene'});assert.equal(scene.kind,'scene');
 for(const path of ['characters','image-jobs','videos','audio-jobs','conversations','studio/assets','studio/usage','studio/records/styles'])assert.ok(Array.isArray((await json(`/v1/projects/${project.id}/${path}`)).items));
 const html=await(await fetch(address)).text();assert.ok(html.includes('assets/index-'));
 const template=await readFile(join(root,'.env.example'),'utf8');assert.ok(template.includes('RUNWAYML_API_SECRET='));
 assert.deepEqual(await readdir(join(root,'data')),[]);
 console.log('Portable smoke passed: bundled runtime, migrations, 8 module endpoints, static page, no personal .env or data.');
} finally {child.kill();}
