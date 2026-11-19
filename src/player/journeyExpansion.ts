import { PropertyBinding, Vector3, type AnimationClip, type Object3D, type VectorKeyframeTrack } from 'three';
import type { SceneManifest } from '../contract/manifest';

/** Camera travel from the route start to the first hold, in world units. */
const FIRST_SPAN = 6.75;
/** Every later hold-to-hold span relative to the authored one (twice the earlier 1.25 pass). */
const SPAN_SCALE = 2.5;
/** Depth behind each anchor that keeps its authored layout, so the hold framing is unchanged. */
const REAR_HOLD = 1.5;
const EPS = 1e-4;

interface Knot { x:number; y:number }

interface RouteOffset {x:number;y:number}
const STOP_OFFSETS:RouteOffset[]=[
 {x:0,y:0},{x:3,y:1.2},{x:3,y:1.2},
 {x:4.5,y:1.2},{x:-1,y:0},{x:-1,y:1.8},
];
type LegKind='forward'|'xy'|'yx'|'forward-x'|'forward-y';
const LEG_KINDS:LegKind[]=['forward','xy','forward','forward-x','xy','forward-y'];

/** Ordered dolly sublegs, not an excursion returning to the same centreline. */
export function journeyLeg(progress:number,from:RouteOffset,to:RouteOffset,kind:LegKind='forward') {
 const ease=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*t*(t*(t*6-15)+10);};
 const p=Math.max(0,Math.min(1,progress));
 if(kind==='forward')return {...to,forward:p};
 const sidewaysOnly=kind==='xy'||kind==='yx';
 const first=ease(p/.5),second=ease((p-.5)/.5);
 const afterForward=ease((p-.58)/.42);
 return {
  x:from.x+(to.x-from.x)*(sidewaysOnly?(kind==='yx'?second:first):afterForward),
  y:from.y+(to.y-from.y)*(sidewaysOnly?(kind==='yx'?first:second):afterForward),
  // Sideways-only routes really keep their depth; other routes finish sideways.
  forward:sidewaysOnly?0:Math.min(1,p/.58),
 };
}

/** Monotone piecewise-linear map; outside the knots it continues as a rigid shift. */
function remap(knots:readonly Knot[], x:number) {
 const first=knots[0]!, last=knots[knots.length-1]!;
 if(x<=first.x)return x+first.y-first.x;
 for(let i=1;i<knots.length;i++){const a=knots[i-1]!,b=knots[i]!;if(x<=b.x)return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);}
 return x+last.y-last.x;
}

/**
 * Lengthen the corridor while retaining each pane's camera-relative focus pose.
 *
 * The camera's authored depth is remapped, not its timing: travel between
 * holds is stretched, motion inside a hold keeps its authored size, and easing
 * keeps its shape. The static world is remapped with the same shift at every
 * stop, held constant from the camera stop to just behind the pane, so what
 * the camera frames during a hold is the authored composition. Shutter rigs
 * follow the camera exactly. Nothing is created, shown or hidden.
 */
export function expandJourney(scene:Object3D, clips:AnimationClip[], manifest:SceneManifest) {
 const clip=clips.find(c=>c.name===manifest.clipName);
 const camera=clip?.tracks.find(t=>t.name==='route_camera.position') as VectorKeyframeTrack|undefined;
 if(!clip||!camera||manifest.anchors?.length!==LEG_KINDS.length)throw new Error('Journey expansion requires the admitted six-stop camera route');
 const old=Array.from(camera.values), times=camera.times;
 const sampleZ=(values:ArrayLike<number>,t:number)=>{
  let low=0,high=times.length-1;
  while(low+1<high){const middle=(low+high)>>>1;if(times[middle]!<t)low=middle;else high=middle;}
  const i=Math.min(low,times.length-2);
  const f=Math.max(0,Math.min(1,(t-times[i]!)/(times[i+1]!-times[i]!||1)));
  return values[i*3+2]!+(values[(i+1)*3+2]!-values[i*3+2]!)*f;
 };
 scene.updateMatrixWorld(true);
 const holds=[...manifest.anchors].sort((a,b)=>a.holdStart-b.holdStart);
 const start=old[2]!;
 const forward=Math.sign(sampleZ(old,holds[holds.length-1]!.holdStart)-start);
 if(forward===0)throw new Error('Journey expansion requires a forward camera route');
 // Distance along the authored route, and back to a depth coordinate.
 const along=(z:number)=>forward*(z-start), depth=(s:number)=>start+forward*s;

 // Camera: authored distance → new distance. Each hold contributes its start
 // and, when the camera drifts during the hold, its end at unit slope.
 const route:Knot[]=[{x:0,y:0}];
 const stops:{at:number;shift:number;anchorAt:number}[]=[];
 let spanFromX=0, spanFromY=0;
 holds.forEach((hold,index)=>{
  const at=along(sampleZ(old,hold.holdStart)), last=route[route.length-1]!;
  if(at>last.x+EPS){
   const span=index===0?FIRST_SPAN:SPAN_SCALE*(at-spanFromX);
   // Never shorter than authored, and never behind the previous hold's end.
   const y=Math.max(spanFromY+span,last.y+at-last.x);
   route.push({x:at,y});
   spanFromX=at;spanFromY=y;
  }
  const end=along(sampleZ(old,hold.holdEnd)), tail=route[route.length-1]!;
  if(end>tail.x+EPS)route.push({x:end,y:tail.y+end-tail.x});
  const anchor=scene.getObjectByName(hold.anchorNode);
  if(!anchor)throw new Error('Journey expansion requires every admitted anchor');
  const anchorAt=along(anchor.getWorldPosition(new Vector3()).z);
  stops.push({at,shift:remap(route,at)-at,anchorAt});
 });
 // Compress only the explicitly sideways-only trips. Each stop's world and
 // camera receive the same accumulated depth shift, preserving its lens pose.
 let accumulatedDepthShift=0;
 const depthShifts=holds.map((hold,index)=>{
  if(LEG_KINDS[index]==='xy'||LEG_KINDS[index]==='yx'){
   const previousTime=index===0?0:holds[index-1]!.holdEnd;
   accumulatedDepthShift+=depth(remap(route,along(sampleZ(old,previousTime))))
    -depth(remap(route,along(sampleZ(old,hold.holdStart))));
  }
  return accumulatedDepthShift;
 });

 // World: the same shift as the camera at each stop, constant from the camera
 // stop to REAR_HOLD behind the pane; the stretch happens between stops.
 const field:Knot[]=[{x:0,y:0}];
 stops.forEach((stop,index)=>{
  const next=stops[index+1], last=field[field.length-1]!;
  let to=stop.anchorAt+REAR_HOLD;
  if(next)to=Math.min(to,Math.max(stop.anchorAt,(stop.anchorAt+Math.min(next.at,next.anchorAt))/2));
  const from=Math.max(Math.min(stop.at,stop.anchorAt),last.x+1e-3);
  field.push({x:from,y:Math.max(from+stop.shift,last.y)});
  if(to>from+EPS)field.push({x:to,y:to+stop.shift});
 });

 // Position tracks that own a moved node would undo the move; shift them too.
 const tracked=new Set<string>();
 for(const track of clip.tracks){
  const parsed=PropertyBinding.parseTrackName(track.name);
  if(parsed.propertyName==='position'&&parsed.nodeName)tracked.add(parsed.nodeName);
 }
 const moved=new Map<string,Vector3>();
 const groups:Object3D[]=[];
 scene.traverse(n=>{if(/^field_depth_b/.test(n.name)||n.name==='landmarks'||n.name==='journey_continuation')groups.push(n);});
 const world=new Vector3();
 for(const group of groups)for(const node of group.children){
  node.getWorldPosition(world);
  const distance=along(world.z);
  const owner=holds.findIndex(hold=>!!node.getObjectByName(hold.anchorNode));
  const nearest=owner>=0?owner:stops.reduce((best,stop,index)=>Math.abs(stop.anchorAt-distance)<Math.abs(stops[best]!.anchorAt-distance)?index:best,0);
  const offset=STOP_OFFSETS[Math.min(nearest,STOP_OFFSETS.length-1)]!;
  world.x+=offset.x;world.y+=offset.y;
  world.z=depth(remap(field,distance))+depthShifts[nearest]!;
  group.worldToLocal(world);
  if(tracked.has(node.name))moved.set(node.name,world.clone().sub(node.position));
  node.position.copy(world);
 }

 const offsetAt=(time:number)=>{
  for(let index=0;index<holds.length;index++){
   const from=index===0?0:holds[index-1]!.holdEnd,to=holds[index]!.holdStart;
   const target=STOP_OFFSETS[Math.min(index,STOP_OFFSETS.length-1)]!;
   if(time>=from&&time<to){
    const previous=index===0?{x:0,y:0}:STOP_OFFSETS[Math.min(index-1,STOP_OFFSETS.length-1)]!;
    const leg=journeyLeg((time-from)/(to-from),previous,target,LEG_KINDS[index]??'forward');
    return {...leg,authoredTime:from+(to-from)*leg.forward,zShift:index===0?0:depthShifts[index-1]!};
   }
   if(time<=holds[index]!.holdEnd)return {...target,authoredTime:time,zShift:depthShifts[index]!};
  }
  return {...STOP_OFFSETS[Math.min(holds.length-1,STOP_OFFSETS.length-1)]!,authoredTime:time,zShift:depthShifts[depthShifts.length-1]!};
 };
 for(let i=0;i<times.length;i++){
  const offset=offsetAt(times[i]!);
  camera.values[i*3]=old[i*3]!+offset.x;
  camera.values[i*3+1]=old[i*3+1]!+offset.y;
  camera.values[i*3+2]=depth(remap(route,along(sampleZ(old,offset.authoredTime))))+offset.zShift;
 }
 for(const track of clip.tracks){
  if(track===camera||track.values.length!==track.times.length*3)continue;
  if(/^optic_shutter_rig_.*\.position$/.test(track.name)){
   // Camera-relative: move each key by exactly what the camera moved at that time.
   for(let i=0;i<track.times.length;i++){
    const offset=offsetAt(track.times[i]!);
    track.values[i*3]=track.values[i*3]!+offset.x;
    track.values[i*3+1]=track.values[i*3+1]!+offset.y;
    track.values[i*3+2]=track.values[i*3+2]!+sampleZ(camera.values,track.times[i]!)-sampleZ(old,track.times[i]!);
   }
   continue;
  }
  const parsed=PropertyBinding.parseTrackName(track.name);
  const delta=parsed.propertyName==='position'?moved.get(parsed.nodeName):undefined;
  if(!delta)continue;
  for(let i=0;i<track.times.length;i++){track.values[i*3]=track.values[i*3]!+delta.x;track.values[i*3+1]=track.values[i*3+1]!+delta.y;track.values[i*3+2]=track.values[i*3+2]!+delta.z;}
 }
 scene.updateMatrixWorld(true);
}
