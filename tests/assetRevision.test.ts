import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import config from '../next.config';
import {revisionedAsset} from '../src/contract/assetRevision';
import {manifestPathFor,resolveSceneUrl} from '../src/contract/manifest';

afterEach(()=>vi.unstubAllEnvs());
it('opening metadata and binary have their own content revision',()=>{
 const root='public/assets/samaritan/opening/';
 const digest=createHash('sha256').update(readFileSync(root+'opening-metadata.json')).update(readFileSync(root+'samaritan-opening.glb')).digest('hex');
 expect(config.env?.NEXT_PUBLIC_OPENING_REVISION).toBe(digest);
 expect(digest).not.toBe(config.env?.NEXT_PUBLIC_SCENE_REVISION);
 expect(revisionedAsset('https://example.test/Samaritan/assets/samaritan/opening/samaritan-opening.glb',digest)).toContain('?revision='+digest);
});
it('build revision is computed from the deployed manifest and exact scene bytes',()=>{
 const manifest=readFileSync('public/assets/samaritan/manifest.json');
 const data=JSON.parse(manifest.toString());
 const scene=readFileSync('public/assets/samaritan/'+data.sceneUrl);
 const digest=createHash('sha256').update(manifest).update(scene).digest('hex');
 expect(config.env?.NEXT_PUBLIC_SCENE_REVISION).toBe(digest);
 expect(createHash('sha256').update(manifest).update(scene).update('changed').digest('hex')).not.toBe(digest);
});
it('different deployments have different manifest and GLB cache keys at the same subpath',()=>{
 vi.stubEnv('NEXT_PUBLIC_BASE_PATH','/Demo');
 const urls:string[]=[];
 for(const revision of ['a'.repeat(64),'b'.repeat(64)]){
  vi.stubEnv('NEXT_PUBLIC_SCENE_REVISION',revision);
  const manifest=new URL(manifestPathFor('samaritan'),'https://example.test').href;
  expect(new URL(manifest).searchParams.get('revision')).toBe(revision);
  const scene=resolveSceneUrl(manifest,'./scene.glb?quality=full#view');
  const parsed=new URL(scene);
  expect(parsed.pathname).toBe('/Demo/assets/samaritan/scene.glb');
  expect(parsed.searchParams.get('quality')).toBe('full');
  expect(parsed.searchParams.get('revision')).toBe(revision);
  expect(parsed.hash).toBe('#view');
  urls.push(scene);
 }
 expect(urls[0]).not.toBe(urls[1]);
 expect(()=>revisionedAsset('/scene.glb','local/path')).toThrow('Invalid asset revision');
});
