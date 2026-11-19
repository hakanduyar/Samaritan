import type { SceneManifest } from '../contract/manifest';
import admission from './holdAdmission.json';
import rests from './holdRestAdmission.json';

export interface Hold { holdStart: number; holdEnd: number }
/** Manual coordinate only: never use it as clip/source time. */
/** Free-travel speed-up on the navigation axis; holds keep their length and focus logic. */
export const TRAVEL_SPEEDUP = 1.5;
const RAMP_SECONDS = 1.5, STEP_SECONDS = .5;
const smooth = (t: number) => t * t * (3 - 2 * t);
/**
 * `travelSpeedup` > 1 shortens only the free-travel stretches (never holds) of the
 * navigation axis, easing from 1x at each hold edge so the pace never steps.
 * Stays piecewise-linear and exactly invertible; endpoints are unchanged.
 */
export function createHoldMap(duration: number, holds: readonly Hold[], travelSpeedup = 1) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid hold-map duration');
  const segments: Array<{a:number;b:number;x:number;y:number}> = [];
  let a=0, x=0, nominal=0;
  const add=(b:number,length:number,unscaled=length)=>{ if(b>a){ segments.push({a,b,x,y:x+length}); a=b; x+=length; nominal+=unscaled; } };
  const travel=(b:number)=>{
    const from=a, span=b-a;
    if(!(span>0)) return;
    if(!(travelSpeedup>1)) return add(b,span);
    const n=Math.ceil(span/STEP_SECONDS);
    for(let i=0;i<n;i++){
      const lo=from+span*i/n, hi=i===n-1?b:from+span*(i+1)/n, mid=(lo+hi)/2;
      const k=1+(travelSpeedup-1)*smooth(Math.min(1,Math.min(mid-from,b-mid)/RAMP_SECONDS));
      add(hi,(hi-lo)/k,hi-lo);
    }
  };
  for(const hold of holds){
    const {holdStart:start,holdEnd:end}=hold;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<a||end<=start||end>duration) throw new Error('Hold intervals must be ordered, disjoint and within the clip');
    travel(start);
    add(end,Math.min(.2,end-start));
  }
  travel(duration);
  const convert=(value:number,inverse:boolean)=>{
    const maximum=inverse?x:duration;
    const t=Math.max(0,Math.min(maximum,value));
    const s=segments.find(s=>t<=(inverse?s.y:s.b)) ?? segments[segments.length-1];
    if (!s) throw new Error('Empty hold map');
    const lo=inverse?s.x:s.a, hi=inverse?s.y:s.b;
    const outLo=inverse?s.a:s.x, outHi=inverse?s.b:s.y;
    return outLo+(t-lo)/(hi-lo)*(outHi-outLo);
  };
  return {focusHolds: [] as readonly Hold[],duration:x,/** Length at 1x travel: wheel/drag distance scales by this, so travel speed rises. */nominalDuration:nominal,toNavigation:(t:number)=>convert(t,false),toClip:(t:number)=>convert(t,true)};
}
/** Frozen producer admission. New exports stay identity until separately reviewed. */
export function navigationMap(manifest:SceneManifest,reference:boolean){
  const signature={world:manifest.world,sceneUrl:manifest.sceneUrl,clipName:manifest.clipName,durationSeconds:manifest.durationSeconds,anchors:manifest.anchors};
  const admitted=!reference && manifest.schemaVersion===2 && JSON.stringify(signature)===JSON.stringify(admission);
  return {...createHoldMap(manifest.durationSeconds,admitted ? [rests.opening, ...(manifest.anchors ?? []), rests.end] : [],admitted ? TRAVEL_SPEEDUP : 1),focusHolds: admitted ? manifest.anchors ?? [] : []};
}

/** Discard pre-focus backlog; later events may deliberately continue. */
export function focusEntry(previous:number,next:number,holds:readonly Hold[]):number|null {
 if(next>previous){for(const h of holds)if(previous<h.holdStart && next>=h.holdStart)return h.holdStart;}
 if(next<previous){for(let i=holds.length-1;i>=0;i--){const h=holds[i]!;if(previous>h.holdEnd && next<=h.holdEnd)return h.holdEnd;}}
 return null;
}
export function withinFocus(time:number,holds:readonly Hold[]){return holds.some(h=>time>=h.holdStart&&time<=h.holdEnd);}
