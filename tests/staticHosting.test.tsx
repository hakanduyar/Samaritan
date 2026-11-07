import {afterEach,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {assetPath} from '../src/contract/assetPath';
import {manifestPathFor,resolveSceneUrl} from '../src/contract/manifest';
import {queryFromSearch} from '../src/player/SceneFromLocation';
import {parsePlayerParams} from '../src/player/time';
import Index from '../app/page';
import Page from '../app/samaritan/page';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams('mode=reference&t=1.5&t=99&qa=1'),redirect:vi.fn()}));
afterEach(()=>vi.unstubAllEnvs());
it('resolves root and repository subpath assets without changing relative scene URLs',()=>{
 expect(assetPath('/assets/samaritan/manifest.json','')).toBe('/assets/samaritan/manifest.json');
 vi.stubEnv('NEXT_PUBLIC_BASE_PATH','/Samaritan');
 const manifest=new URL(manifestPathFor('samaritan'),'https://example.test/Samaritan/samaritan/?t=1');
 expect(manifest.pathname).toBe('/Samaritan/assets/samaritan/manifest.json');
 expect(resolveSceneUrl(manifest.href,'./scene.glb')).toBe('https://example.test/Samaritan/assets/samaritan/scene.glb');
 expect(()=>assetPath('/assets/x','//outside.test')).toThrow();
});
it('preserves duplicate-query first-value semantics on static root and scene routes',async()=>{
 const query=queryFromSearch(new URLSearchParams('mode=reference&t=1.5&t=99&qa=1'));
 expect(parsePlayerParams(query)).toMatchObject({mode:'reference',requestedTime:1.5,qa:true});
 vi.stubEnv('STATIC_EXPORT','1');
 for(const element of [Index(),await Page({searchParams:Promise.resolve({})})]){
  const html=renderToStaticMarkup(element);expect(html).toContain('data-mode="reference"');expect(html).toContain('data-world="samaritan"');
 }
});
