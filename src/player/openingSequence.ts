import {createOpeningVignette,openingVignetteOpacity} from './openingVignette';
import {createOpeningPane} from './openingPane';
import {createStraightOpeningPane} from './straightOpeningPane';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {Group,LoadingManager,type Object3D} from 'three';
import {createManualFieldWindow} from './manualFieldWindow';
import {makeSamaritanPanesOpaque} from './samaritanOpacity';
import {createSceneRig} from './sceneRig';
import {disposeObjectTree} from './dispose';
import {createOpeningClock,openingDistanceOffset,validateOpening} from './openingClock';
import {assetPath} from '../contract/assetPath';
import {revisionedAsset} from '../contract/assetRevision';

export function openingAssetBase(origin:string,straight=false){
 return new URL(assetPath(straight?'/assets/samaritan/opening-straight/':'/assets/samaritan/opening/'),origin);
}

export async function loadOpeningSequence(origin:string,signal:AbortSignal,straight=false,onProgress=()=>{}){
 const base=openingAssetBase(origin,straight);
 const revision=(straight?process.env.NEXT_PUBLIC_STRAIGHT_OPENING_REVISION:process.env.NEXT_PUBLIC_OPENING_REVISION)??'';
 const response=await fetch(revisionedAsset(new URL('opening-metadata.json',base).href,revision),{signal,cache:'no-store'});
 if(!response.ok)throw Error('Opening metadata HTTP '+response.status);
 const meta=validateOpening(await response.json(),straight);
 if(signal.aborted)throw Error('Opening cancelled');
 onProgress();
 const manager=new LoadingManager();
 const cancel=()=>manager.abort();
 signal.addEventListener('abort',cancel,{once:true});
 let bytes=0;
 const gltf=await new GLTFLoader(manager).loadAsync(revisionedAsset(new URL('samaritan-opening.glb',base).href,revision),(event)=>{
  if(Number.isFinite(event.loaded)&&event.loaded>bytes){bytes=event.loaded;onProgress();}
 }).finally(()=>signal.removeEventListener('abort',cancel));
 if(signal.aborted){disposeObjectTree(gltf.scene);throw Error('Opening cancelled');}
 let cleanupRig:(()=>void)|undefined;
 let cleanupPane:(()=>void)|undefined;
 let cleanupField:(()=>void)|undefined;
 let cleanupOpacity:(()=>void)|undefined;
 try {
  const rig=createSceneRig(gltf.scene,gltf.animations,{cameraName:meta.openingCameraName,clipName:meta.openingClipName,durationSeconds:meta.durationSeconds,focalScreenName:meta.paneNode});
  let travelRig:Group|null=null;
  let restoreTravel=()=>{};
  const cameraRig=rig.camera.parent;
  if(straight&&cameraRig?.parent){
   const parent=cameraRig.parent;
   travelRig=new Group();travelRig.name="opening_extended_travel";
   parent.add(travelRig);travelRig.add(cameraRig);
   restoreTravel=()=>{parent.add(cameraRig);travelRig!.removeFromParent();};
  }
  cleanupRig=()=>{restoreTravel();rig.dispose();};
  if(straight){
   const restoreOpacity=makeSamaritanPanesOpaque(gltf.scene);
   // The command quartet is three photo quads plus the focal command pane.
   // Its separate four-vertex spine is decoration, not a surrounding field rail.
   const quartetSpine=gltf.scene.getObjectByName('lm_D_center_stack')?.children
    .find(node=>node.name==='mesh_lm_D_center_stack');
   const quartetSpineVisible=quartetSpine?.visible;
   if(quartetSpine)quartetSpine.visible=false;
   // Eight translucent shutter copies share their source strips' depth at rest.
   // Once opaque, their tiny animated offsets cause competing depth surfaces.
   // Keep the original strips, which the field collector already protects.
   const shutterCopies:Array<[Object3D,boolean]>=[];
   gltf.scene.traverse((node)=>{
    if(/^optic_shutter_rig_s\d+$/.test(node.name)){
     shutterCopies.push([node,node.visible]);node.visible=false;
    }
   });
   cleanupOpacity=()=>{for(const [node,visible] of shutterCopies)node.visible=visible;if(quartetSpine)quartetSpine.visible=quartetSpineVisible!;restoreOpacity();};
  }
  rig.seek(0); gltf.scene.updateMatrixWorld(true);
  const focusNames = [meta.paneNode];
  const protectedNames = [meta.paneNode];
  gltf.scene.traverse((node) => {
   if (node.name.startsWith("anchor_")) protectedNames.push(node.name);
   if (/^screen_\d+$/.test(node.name)) {
    focusNames.push(node.name);
    protectedNames.push(node.name);
   }
  });
  const field = straight ? createManualFieldWindow(gltf.scene, {
   camera: rig.camera,
   clips: gltf.animations,
   protectedNames,
   focusNames,
  }) : null;
  cleanupField=()=>field?.dispose();
  const clock=createOpeningClock(meta,straight?1.12:1,straight?1.5:0,straight?9:undefined);
  const pane=straight?createStraightOpeningPane(gltf.scene,meta.paneNode):createOpeningPane(gltf.scene,meta.paneNode);
  cleanupPane=()=>pane.dispose();
  const vignette=createOpeningVignette(gltf.scene);
  // Cached once: top-level siblings off the pane/camera ancestor chains; hidden only while the pane fully covers the view.
 let hideList:Object3D[]|null=null;const hiddenNow:Object3D[]=[];
 const hideWorld=()=>{
  if(!hideList){const leaves=[gltf.scene.getObjectByName(meta.paneNode),rig.camera].filter((o):o is Object3D=>!!o),keep=new Set<Object3D>();
   for(const leaf of leaves)for(let o:Object3D|null=leaf;o;o=o.parent)keep.add(o);
   hideList=[];for(const k of keep){if(leaves.includes(k))continue;for(const c of k.children)if(!keep.has(c))hideList.push(c);}}
  if(hiddenNow.length)return;
  for(const o of hideList)if(o.visible){o.visible=false;hiddenNow.push(o);}
 };
 const showWorld=()=>{for(const o of hiddenNow)o.visible=true;hiddenNow.length=0;};
 return {scene:gltf.scene,rig,clock,maskedReturn:straight,restoreWorld:showWorld,prepare(){let state=clock.snapshot();if(travelRig&&state.phase!=='return'){travelRig.position.z=openingDistanceOffset(state.clipTime,meta.phases.approach.start);travelRig.updateMatrixWorld(true);}field?.update();vignette.apply(straight?0:openingVignetteOpacity(state.phase,state.clipTime,meta));if(straight){if(state.phase==='world'&&state.clipTime>=meta.phases.approach.start&&(pane as ReturnType<typeof createStraightOpeningPane>).covers(rig.camera)&&clock.startCommands(state.clipTime))state=clock.snapshot();const held=state.phase==='commands'||state.phase==='return';(pane as ReturnType<typeof createStraightOpeningPane>).show(state.phase==='commands'?state.command:state.phase==='return'?'SAMARITAN':'',state.blinkTime,held?1:Math.max(0,Math.min(1,(state.clipTime-10.5)/1.5)));if((state.phase==='commands'||state.phase==='return')&&(pane as ReturnType<typeof createStraightOpeningPane>).covers(rig.camera))hideWorld();else showWorld();}else if(state.phase==='commands'||state.phase==='return'||(state.phase==='world'&&state.clipTime>=meta.phases.approach.start))pane.show(state.command||(state.phase==='return'?'SAMARITAN':'WHAT'));},dispose(){showWorld();pane.dispose();field?.dispose();vignette.dispose();cleanupOpacity?.();cleanupRig?.();disposeObjectTree(gltf.scene);}};
 }catch(error){cleanupPane?.();cleanupField?.();cleanupOpacity?.();cleanupRig?.();disposeObjectTree(gltf.scene);throw error;}
}
