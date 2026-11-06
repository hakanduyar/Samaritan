import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {validateManifest} from '../src/contract/manifest';
it('bundled scene matches its authored contract',()=>{
 const m=JSON.parse(readFileSync('public/assets/samaritan/manifest.json','utf8'));
 expect(validateManifest(m,'samaritan').ok).toBe(true);
 const bytes=readFileSync('public/assets/samaritan/scene.glb');
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 expect(gltf.animations.map((a:{name:string})=>a.name)).toEqual([m.clipName]);
 const names=gltf.nodes.map((n:{name:string})=>n.name);
 for(const a of m.anchors){expect(names).toContain(a.screen);expect(names).toContain(a.anchorNode);}
 expect(names).toContain(m.cameraName);expect(m.timeBasis).toBe('authored');
});
