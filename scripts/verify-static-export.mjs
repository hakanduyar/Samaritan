import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve('out'),base=process.env.NEXT_PUBLIC_BASE_PATH??'';
if(base&&!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(base))throw Error('Invalid base path');
const pkg=JSON.parse(await readFile('package.json','utf8'));
const world=pkg.name==='samaritan'?'samaritan':'machine';
const manifestBytes=await readFile('public/assets/'+world+'/manifest.json');
const bundledManifest=JSON.parse(manifestBytes.toString());
const sceneRevision=createHash('sha256').update(manifestBytes).update(await readFile(resolve('public/assets/'+world,bundledManifest.sceneUrl))).digest('hex');
let clientSource='';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname);
  if(base&&pathname!==base&&!pathname.startsWith(base+'/')){res.writeHead(404);res.end();return;}
  let file=resolve(root,'.'+(pathname.slice(base.length)||'/'));
  if(file!==root&&!file.startsWith(root+sep))throw Error('Outside export');
  if((await stat(file)).isDirectory())file=resolve(file,'index.html');
  const bytes=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(Number(process.env.PORT??0),'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const get=async(path)=>{const r=await fetch(origin+path);if(!r.ok)throw Error('HTTP '+r.status+' '+path);return r;};
try{
 const hasOpening=await stat(resolve(root,'opening-candidate/index.html')).then(()=>true,()=>false);
 const hasStraight=await stat(resolve(root,'opening-straight/index.html')).then(()=>true,()=>false);
 for(const path of [base+'/',base+'/'+world+'/?mode=reference&t=1.5&qa=1',...(hasOpening?[base+'/opening-candidate/']:[]),...(hasStraight?[base+'/opening-straight/']:[])]){
  const html=await(await get(path)).text();
  const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&'));
  if(!scripts.length)throw Error('No client scripts');
  for(const asset of scripts){if(!asset.startsWith(base+'/_next/'))throw Error('Unprefixed script '+asset);clientSource+=await(await get(asset)).text();}
 }
 const manifestPath=base+'/assets/'+world+'/manifest.json';
 if(!clientSource.includes(sceneRevision))throw Error('Client does not contain deployed scene revision');
 const manifest=await(await get(manifestPath+'?revision='+sceneRevision)).json();
 const glbUrl=new URL(manifest.sceneUrl,origin+manifestPath);
 if(!glbUrl.pathname.startsWith(base+'/assets/'+world+'/'))throw Error('Scene escaped asset prefix');
 glbUrl.searchParams.set('revision',sceneRevision);
 const served=Buffer.from(await(await get(glbUrl.pathname+glbUrl.search)).arrayBuffer());
 const bundled=await readFile(resolve('public/assets/'+world,manifest.sceneUrl));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 if(hash(served)!==hash(bundled))throw Error('Served GLB differs from bundled asset');
 if(hasOpening){
  const prefix='/assets/samaritan/opening/';
  const openingRevision=createHash('sha256').update(await readFile('public'+prefix+'opening-metadata.json')).update(await readFile('public'+prefix+'samaritan-opening.glb')).digest('hex');
  if(!clientSource.includes(openingRevision))throw Error('Client does not contain deployed opening revision');
  for(const name of ['opening-metadata.json','samaritan-opening.glb']){
   const actual=Buffer.from(await(await get(base+prefix+name+'?revision='+openingRevision)).arrayBuffer());
   if(hash(actual)!==hash(await readFile(resolve('public'+prefix+name))))throw Error('Opening asset mismatch '+name);
  }
  if(base&&(await fetch(origin+prefix+'opening-metadata.json')).status!==404)throw Error('Unexpected root opening fallback');
 }
 if(base&&(await fetch(origin+'/assets/'+world+'/manifest.json')).status!==404)throw Error('Unexpected root asset fallback');
 if(hasStraight){
  const prefix='/assets/samaritan/opening-straight/';
  const revision=createHash('sha256').update(await readFile('public'+prefix+'opening-metadata.json')).update(await readFile('public'+prefix+'samaritan-opening.glb')).digest('hex');
  if(!clientSource.includes(revision))throw Error('Client lacks straight opening revision');
  for(const name of ['opening-metadata.json','samaritan-opening.glb']){
   const actual=Buffer.from(await(await get(base+prefix+name+'?revision='+revision)).arrayBuffer());
   if(hash(actual)!==hash(await readFile('public'+prefix+name)))throw Error('Straight opening asset mismatch');
  }
  if(base&&(await fetch(origin+prefix+'opening-metadata.json')).status!==404)throw Error('Unexpected root straight opening fallback');
 }
 console.log(JSON.stringify({result:'PASS',world,base,sceneSha256:hash(served),url:origin+base+'/'}));
 if(!process.argv.includes('--serve'))server.close();
}catch(error){server.close();throw error;}
