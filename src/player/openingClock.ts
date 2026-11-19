export type OpeningPhase='loading'|'connection'|'world'|'commands'|'return'|'complete';
export interface OpeningContract {durationSeconds:number;paneNode:string;openingClipName:string;openingCameraName:string;commandOpaqueMask?:{start:number;end:number};phases:{approach:{start:number;end:number};paneHold:{start:number;end:number};return:{start:number;end:number;hidden?:boolean}};handoff:{interactiveTimeSeconds:number}}
export function validateOpening(value:unknown,straight=false):OpeningContract {
 const m=value as OpeningContract;
 if(!m||m.openingClipName!=='samaritan_opening'||m.openingCameraName!=='route_camera_lens'||m.paneNode!==(straight?'focal_screen':'screen_01')||m.handoff?.interactiveTimeSeconds!==0)throw Error('Unadmitted opening identity');
 const end=m.phases?.approach?.end,start=m.phases?.paneHold?.start,holdEnd=m.phases?.paneHold?.end,returnStart=m.phases?.return?.start,duration=m.durationSeconds;
 if(![m.phases?.approach?.start,end,start,holdEnd,returnStart,duration,m.phases?.return?.end].every(Number.isFinite)||end!==start||holdEnd!==returnStart||!(m.phases.approach.start>=0&&start>m.phases.approach.start&&holdEnd>start&&duration>holdEnd)||m.phases.return.end!==duration)throw Error('Invalid opening phase contract');
 if(straight&&(!m.commandOpaqueMask||m.phases.return.hidden!==true||!Number.isFinite(m.commandOpaqueMask.start)||m.commandOpaqueMask.start<start||m.commandOpaqueMask.start>returnStart||m.commandOpaqueMask.end!==duration))throw Error('Opening requires an opaque masked handoff');
 return m;
}
/** One foreground clock; discarded phase overshoot guarantees commands get a presented dwell. */
export function openingTravelTime(seconds:number,duration:number,end:number,initialRate:number) {
 const time=Math.max(0,Math.min(duration,seconds));
 return initialRate*time+(end-initialRate*duration)*(time/duration)**3;
}
/** Additional physical distance, joining the authored approach with zero residual velocity. */
export function openingDistanceOffset(clipTime:number,approachStart:number) {
 // Raw progress is warped by p^1.2 (zero slope at 0, finite at 1) so the extra forward speed peaks later
 // and keeps building alongside the accelerating clock; smoothstep still joins at zero position and velocity.
 const progress=Math.max(0,Math.min(1,clipTime/approachStart))**1.2;
 return 48*(1-progress*progress*(3-2*progress));
}
export function createOpeningClock(meta:OpeningContract,travelRate=1,initialLoading=0,travelSeconds?:number){
 if(!Number.isFinite(travelRate)||travelRate<=0)throw Error('Invalid opening travel rate');
 if(travelSeconds!==undefined&&(!Number.isFinite(travelSeconds)||travelSeconds<=0||travelRate*travelSeconds>meta.phases.approach.end))throw Error('Invalid accelerating opening duration');
 let phase:OpeningPhase=initialLoading>0?'loading':'connection',elapsed=0,visualTime=0,holdClip:number|null=null,worldElapsed=0;
 // Command entry starts the blink on; subsequent half-seconds fully switch it off/on.
 const snapshot=()=>({phase,visualTime,blinkTime:phase==='commands'?elapsed:phase==='return'?3+elapsed:visualTime,clipTime:phase==='connection'||phase==='loading'?0:phase==='world'?elapsed:phase==='commands'?holdClip??meta.phases.paneHold.start:phase==='return'?meta.phases.return.start+elapsed:meta.durationSeconds,command:phase==='commands'?['WHAT','ARE','YOUR','COMMANDS','SAMARITAN'][Math.min(4,Math.floor(elapsed/.6))]!:''});
 return {snapshot,/** Early pose-preserving command start (world phase only); visualTime stays continuous. */startCommands(clipTime:number){
  if(phase!=='world'||!Number.isFinite(clipTime))return false;
  holdClip=Math.min(Math.max(clipTime,meta.phases.approach.start),meta.phases.paneHold.start);phase='commands';elapsed=0;return true;
 },advance(seconds:number,reduced:boolean){
  const delta=Number.isFinite(seconds)?Math.max(0,seconds):0;
  if(phase==='complete')return snapshot();
  visualTime+=delta;
  if(phase==='loading'){elapsed+=delta;if(elapsed>=initialLoading){phase='connection';elapsed=0;}return snapshot();}
  if(phase==='connection'){elapsed+=delta;if(elapsed>=1){phase=reduced?'commands':'world';elapsed=0;}return snapshot();}
  if(reduced&&phase==='world'){phase='commands';elapsed=0;return snapshot();}
  if(reduced&&phase==='return'){phase='complete';elapsed=0;return snapshot();}
  if(phase==='world'&&travelSeconds!==undefined){
   worldElapsed+=delta;elapsed=openingTravelTime(worldElapsed,travelSeconds,meta.phases.approach.end,travelRate);
  }else elapsed+=delta*(phase==='world'?travelRate:1);
  if(phase==='world'&&elapsed>=meta.phases.approach.end){phase='commands';elapsed=0;}
  else if(phase==='commands'&&elapsed>=3){phase=reduced?'complete':'return';elapsed=0;}
  else if(phase==='return'&&elapsed>=meta.durationSeconds-meta.phases.return.start){phase='complete';elapsed=0;}
  return snapshot();
 }};
}
