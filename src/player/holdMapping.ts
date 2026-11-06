import type { SceneManifest } from '../contract/manifest';
import admission from './holdAdmission.json';

export interface Hold { holdStart: number; holdEnd: number }
/** Manual coordinate only: never use it as clip/source time. */
export function createHoldMap(duration: number, holds: readonly Hold[]) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid hold-map duration');
  const segments: Array<{a:number;b:number;x:number;y:number}> = [];
  let a=0, x=0;
  const add=(b:number,length:number)=>{ if(b>a){ segments.push({a,b,x,y:x+length}); a=b; x+=length; } };
  for(const hold of holds){
    const {holdStart:start,holdEnd:end}=hold;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<a||end<=start||end>duration) throw new Error('Hold intervals must be ordered, disjoint and within the clip');
    add(start,start-a);
    add(end,Math.min(.2,end-start));
  }
  add(duration,duration-a);
  const convert=(value:number,inverse:boolean)=>{
    const maximum=inverse?x:duration;
    const t=Math.max(0,Math.min(maximum,value));
    const s=segments.find(s=>t<=(inverse?s.y:s.b)) ?? segments[segments.length-1];
    if (!s) throw new Error('Empty hold map');
    const lo=inverse?s.x:s.a, hi=inverse?s.y:s.b;
    const outLo=inverse?s.a:s.x, outHi=inverse?s.b:s.y;
    return outLo+(t-lo)/(hi-lo)*(outHi-outLo);
  };
  return {duration:x,toNavigation:(t:number)=>convert(t,false),toClip:(t:number)=>convert(t,true)};
}
/** Frozen producer admission. New exports stay identity until separately reviewed. */
export function navigationMap(manifest:SceneManifest,reference:boolean){
  const signature={world:manifest.world,sceneUrl:manifest.sceneUrl,clipName:manifest.clipName,durationSeconds:manifest.durationSeconds,anchors:manifest.anchors};
  const admitted=!reference && manifest.schemaVersion===2 && JSON.stringify(signature)===JSON.stringify(admission);
  return createHoldMap(manifest.durationSeconds,admitted ? manifest.anchors ?? [] : []);
}
