export type OpeningPhase='connection'|'world'|'commands'|'return'|'complete';
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
export function createOpeningClock(meta:OpeningContract,travelRate=1){
 if(!Number.isFinite(travelRate)||travelRate<=0)throw Error('Invalid opening travel rate');
 let phase:OpeningPhase='connection',elapsed=0,visualTime=0;
 const snapshot=()=>({phase,visualTime,clipTime:phase==='connection'?0:phase==='world'?elapsed:phase==='commands'?meta.phases.paneHold.start:phase==='return'?meta.phases.return.start+elapsed:meta.durationSeconds,command:phase==='commands'?['WHAT','ARE','YOUR','COMMANDS','SAMARITAN'][Math.min(4,Math.floor(elapsed/.6))]!:''});
 return {snapshot,advance(seconds:number,reduced:boolean){
  const delta=Number.isFinite(seconds)?Math.max(0,seconds):0;
  if(phase==='complete')return snapshot();
  visualTime+=delta;
  if(phase==='connection'){elapsed+=delta;if(elapsed>=1){phase=reduced?'commands':'world';elapsed=0;}return snapshot();}
  if(reduced&&phase==='world'){phase='commands';elapsed=0;return snapshot();}
  if(reduced&&phase==='return'){phase='complete';elapsed=0;return snapshot();}
  elapsed+=delta*(phase==='world'?travelRate:1);
  if(phase==='world'&&elapsed>=meta.phases.approach.end){phase='commands';elapsed=0;}
  else if(phase==='commands'&&elapsed>=3){phase=reduced?'complete':'return';elapsed=0;}
  else if(phase==='return'&&elapsed>=meta.durationSeconds-meta.phases.return.start){phase='complete';elapsed=0;}
  return snapshot();
 }};
}
