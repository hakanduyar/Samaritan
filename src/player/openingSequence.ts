import {createOpeningVignette,openingVignetteOpacity} from './openingVignette';
import {createOpeningPane} from './openingPane';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createSceneRig} from './sceneRig';
import {disposeObjectTree} from './dispose';
import {createOpeningClock,validateOpening} from './openingClock';
import {assetPath} from '../contract/assetPath';
import {revisionedAsset} from '../contract/assetRevision';

export function openingAssetBase(origin:string){
 return new URL(assetPath('/assets/samaritan/opening/'),origin);
}

export async function loadOpeningSequence(origin:string,signal:AbortSignal){
 const base=openingAssetBase(origin);
 const revision=process.env.NEXT_PUBLIC_OPENING_REVISION??'';
 const response=await fetch(revisionedAsset(new URL('opening-metadata.json',base).href,revision),{signal,cache:'no-store'});
 if(!response.ok)throw Error('Opening metadata HTTP '+response.status);
 const meta=validateOpening(await response.json());
 const gltf=await new GLTFLoader().loadAsync(revisionedAsset(new URL('samaritan-opening.glb',base).href,revision));
 if(signal.aborted){disposeObjectTree(gltf.scene);throw Error('Opening cancelled');}
 let cleanupRig:(()=>void)|undefined;
 let cleanupPane:(()=>void)|undefined;
 try {
  const rig=createSceneRig(gltf.scene,gltf.animations,{cameraName:meta.openingCameraName,clipName:meta.openingClipName,durationSeconds:meta.durationSeconds,focalScreenName:meta.paneNode});
  cleanupRig=()=>rig.dispose();
  const clock=createOpeningClock(meta);
  const pane=createOpeningPane(gltf.scene,meta.paneNode);
  cleanupPane=()=>pane.dispose();
  const vignette=createOpeningVignette(gltf.scene);
  return {scene:gltf.scene,rig,clock,prepare(){const state=clock.snapshot();vignette.apply(openingVignetteOpacity(state.phase,state.clipTime,meta));if(state.phase==='commands'||state.phase==='return'||(state.phase==='world'&&state.clipTime>=meta.phases.approach.start))pane.show(state.command||(state.phase==='return'?'SAMARITAN':'WHAT'));},dispose(){vignette.dispose();pane.dispose();rig.dispose();disposeObjectTree(gltf.scene);}};
 }catch(error){cleanupPane?.();cleanupRig?.();disposeObjectTree(gltf.scene);throw error;}
}
