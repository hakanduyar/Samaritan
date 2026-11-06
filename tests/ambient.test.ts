import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {Mesh} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createAmbientRails} from '../src/player/ambient';
import {createSceneRig} from '../src/player/sceneRig';

afterEach(()=>vi.unstubAllGlobals());
it('actual GLB parser selects only bounded static cell primitives, preserving anchors/rails/geometry through seeks',async()=>{
 // Texture pixels are irrelevant to transform safety; this is not a rendered
 // image test. Use the real binary/parser with a stub image decoder only.
 vi.stubGlobal('self',globalThis);
 vi.stubGlobal('createImageBitmap',async()=>({width:1,height:1,close(){}}));
 const bytes=readFileSync('public/assets/samaritan/scene.glb');
 const array=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const gltf=await new GLTFLoader().parseAsync(array,'');
 const manifest=JSON.parse(readFileSync('public/assets/samaritan/manifest.json','utf8'));
 const names=manifest.anchors.flatMap((a:{screen:string;anchorNode:string})=>[a.screen,a.anchorNode]);
 const ambient=createAmbientRails(gltf.scene,gltf.animations,names);
 expect(ambient.selection).toHaveLength(8);
 const positions=new Map<string,number[]>();let count=0;
 gltf.scene.traverse(n=>{positions.set(n.uuid,n.position.toArray());count++;});
 const rig=createSceneRig(gltf.scene,gltf.animations,manifest);
 for(const view of manifest.referenceFrames){
   rig.seek(view.timeSeconds);
   const protectedBefore=names.map((name:string)=>gltf.scene.getObjectByName(name)!.matrixWorld.toArray());
   ambient.advance(.25);ambient.apply();
   expect(names.map((name:string)=>gltf.scene.getObjectByName(name)!.matrixWorld.toArray())).toEqual(protectedBefore);
 }
 const changed:string[]=[];
 gltf.scene.traverse(n=>{if(JSON.stringify(n.position.toArray())!==JSON.stringify(positions.get(n.uuid)) && n instanceof Mesh && n.material && !Array.isArray(n.material) && n.material.name.includes('mat_field_cell')) changed.push(n.material.name);});
 expect(changed.length).toBeGreaterThan(0);
 for(let frame=0;frame<1200;frame++){ambient.advance(1/60);ambient.apply();}
 for(const {name,low,high} of ambient.selection){
   gltf.scene.getObjectByName(name)!.traverse(n=>{
     if(!(n instanceof Mesh)||Array.isArray(n.material))return;
     const original=positions.get(n.uuid)!;
     if(n.material.name.includes('_cell_')){expect(n.position.y-original[1]!).toBeGreaterThanOrEqual(low);expect(n.position.y-original[1]!).toBeLessThanOrEqual(high);}
     if(n.material.name.includes('_line_'))expect(n.position.toArray()).toEqual(original);
   });
 }
 ambient.reset();
 for(const {name} of ambient.selection) gltf.scene.getObjectByName(name)!.traverse(n=>expect(n.position.toArray()).toEqual(positions.get(n.uuid)));
 let afterCount=0;gltf.scene.traverse(()=>afterCount++);expect(afterCount).toBe(count);
 rig.dispose();
});
