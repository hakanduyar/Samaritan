import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {Vector3,Mesh} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createSceneRig} from '../src/player/sceneRig';
import route from './fixtures/forwardRoute.json';

it('actual forward-world GLB preserves all six stationary holds, exact returns and rest endpoints',async()=>{
 vi.stubGlobal('self',globalThis);vi.stubGlobal('createImageBitmap',async()=>({width:1,height:1,close(){}}));
 try{
 const bytes=readFileSync('public/assets/samaritan/scene.glb');const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const manifest=JSON.parse(readFileSync('public/assets/samaritan/manifest.json','utf8'));const rig=createSceneRig(gltf.scene,gltf.animations,manifest);
 const pose=()=>{gltf.scene.updateMatrixWorld(true);return rig.camera.getWorldPosition(new Vector3()).toArray()};
 for(const screen of route.screens){
  const node=gltf.scene.getObjectByName(screen.id)!,anchor=gltf.scene.getObjectByName(screen.anchor)!;
  rig.seek(screen.times.holdStart+.001);const camera=pose(),matrix=node.matrixWorld.toArray();const weights:number[][]=[];node.traverse(o=>{if(o instanceof Mesh&&o.morphTargetInfluences)weights.push([...o.morphTargetInfluences])});
  for(let t=screen.times.holdStart+.01;t<screen.times.holdEnd-.001;t+=.05){rig.seek(t);pose().forEach((v,i)=>expect(v).toBeCloseTo(camera[i]!,5));node.matrixWorld.toArray().forEach((v,i)=>expect(v).toBeCloseTo(matrix[i]!,5));let i=0;node.traverse(o=>{if(o instanceof Mesh&&o.morphTargetInfluences){o.morphTargetInfluences.forEach((v,k)=>expect(v).toBeCloseTo(weights[i]![k]!,5));i++}})}
  for(const t of [screen.times.approachStart,screen.times.returned]){rig.seek(t);pose();expect(node.getWorldPosition(new Vector3()).distanceTo(anchor.getWorldPosition(new Vector3()))).toBeLessThan(1e-5)}
 }
 for(const t of [0,.5,route.openingRest[1]!]){rig.seek(t);expect(pose()).toEqual([0,0,0])}
 for(const t of [route.endRest[0]!+.001,route.duration]){rig.seek(t);const p=pose();expect(p[0]).toBe(0);expect(p[1]).toBe(0);expect(p[2]).toBeCloseTo(-route.endZ,5)}
 rig.dispose();
 }finally{vi.unstubAllGlobals()}
});
