import {expect,it} from 'vitest';
import {parseRecordedTracking,activeOcclusionMasks} from '../src/player/recordedTracking';
import terminal from '../public/assets/recorded-feeds/terminal-walk/tracking.json';
import courtyard from '../public/assets/recorded-feeds/s06/tracking.json';
import crossing from '../public/assets/recorded-feeds/s04/tracking.json';
it('interpolates moving masks at the video clock while preserving static masks and scope',()=>{
 const moving=parseRecordedTracking(crossing), mask=moving.occluders![0]!;
 if(!mask.keyframes)throw new Error('Expected moving foreground');
 const sample=activeOcclusionMasks(moving,8.85)[0]!;
 expect(sample.trackIds).toEqual(['subject-01']);
 for(let i=0;i<sample.polygon.length;i++)for(let axis=0;axis<2;axis++)expect(sample.polygon[i]![axis]).toBeCloseTo((mask.keyframes[0]!.polygon[i]![axis]!+mask.keyframes[1]!.polygon[i]![axis]!)/2,9);
 expect(activeOcclusionMasks(moving,8.69)).toEqual([]);expect(activeOcclusionMasks(moving,9.31)).toEqual([]);
 for(const [raw,time] of [[terminal,4.5],[courtyard,18]] as const){const parsed=parseRecordedTracking(raw);expect(activeOcclusionMasks(parsed,time)[0]).toBe(parsed.occluders![0]);}
});
it('rejects mismatched vertex counts, repeated times and ambiguous static/moving masks',()=>{
 for(const change of ['vertices','time','both']){
  const raw=structuredClone(crossing);const mask=raw.occluders[0]!;
  if(change==='vertices')mask.keyframes[1]!.polygon.pop();
  if(change==='time')mask.keyframes[1]!.t=mask.keyframes[0]!.t;
  if(change==='both')Object.assign(mask,{polygon:mask.keyframes[0]!.polygon});
  expect(()=>parseRecordedTracking(raw)).toThrow('Invalid recorded occluder');
 }
});