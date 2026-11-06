import {expect,it} from 'vitest';
import {createHoldMap,navigationMap,focusEntry,withinFocus} from '../src/player/holdMapping';
import {advanceNavigation,navigationTarget} from '../src/player/navigation';
import {validateManifest} from '../src/contract/manifest';
import admission from '../src/player/holdAdmission.json';

it('compresses only long holds, is continuous and reversible at every boundary',()=>{
 const map=createHoldMap(20,[{holdStart:2,holdEnd:5},{holdStart:8,holdEnd:8.1}]);
 expect(map.duration).toBeCloseTo(17.2);
 expect(map.toNavigation(5)-map.toNavigation(2)).toBeCloseTo(.2);
 expect(map.toNavigation(8.1)-map.toNavigation(8)).toBeCloseTo(.1);
 let previous=-1;
 for(let t=0;t<=20;t+=.01){const n=map.toNavigation(t);expect(n).toBeGreaterThan(previous);expect(map.toClip(n)).toBeCloseTo(t,9);previous=n;}
 for(const t of [0,2,5,8,8.1,20])expect(map.toClip(map.toNavigation(t))).toBeCloseTo(t,10);
});
it('rejects malformed, reversed and overlapping declarations',()=>{
 for(const holds of [[{holdStart:3,holdEnd:2}],[{holdStart:2,holdEnd:5},{holdStart:4,holdEnd:6}],[{holdStart:-1,holdEnd:2}],[{holdStart:0,holdEnd:21}]])expect(()=>createHoldMap(20,holds)).toThrow();
});
it('gates mapping to the exact admitted contract and preserves reference time',()=>{
 const result=validateManifest({...admission,schemaVersion:2,timeBasis:'authored',framingAspectRatio:16/9,cameraName:'route_camera',focalScreenName:'focal_screen',referenceFrames:[]},admission.world as 'machine'|'samaritan');
 if(!result.ok)throw new Error(result.errors.join());
 const m=result.manifest, map=navigationMap(m,false);
 expect(map.duration).toBeLessThan(m.durationSeconds);
 expect(navigationMap(m,true).duration).toBe(m.durationSeconds);
 expect(navigationMap({...m,sceneUrl:'unreviewed.glb'},false).duration).toBe(m.durationSeconds);
 expect(navigationMap({...m,anchors:m.anchors!.map((h,i)=>i? h:{...h,holdEnd:h.holdEnd+.01})},false).duration).toBe(m.durationSeconds);
 expect(.2/map.duration*24000).toBeLessThan(80);
});
it('crosses a hold forward and backward with residual velocity without changing path coordinates',()=>{
 const map=createHoldMap(20,[{holdStart:2,holdEnd:5}]);
 let current=map.toNavigation(1.9),velocity=.8,target=navigationTarget(current,current,.6);
 for(let i=0;i<300;i++)({current,velocity}=advanceNavigation(current,target,velocity,1/60));
 expect(map.toClip(current)).toBeGreaterThan(5);
 target=navigationTarget(current,current,-.6);
 for(let i=0;i<300;i++)({current,velocity}=advanceNavigation(current,target,velocity,1/60));
 expect(map.toClip(current)).toBeCloseTo(1.9);
 // A canonical playback stop in the middle of a hold must not become nav seconds.
 current=map.toNavigation(3.5);target=navigationTarget(current,current,.1);
 expect(map.toClip(current)).toBeCloseTo(3.5);
 expect(map.toClip(target)).toBeCloseTo(5);
});

it('captures only first focus entry in either direction, never rests or fresh travel inside',()=>{
 const holds=[{holdStart:2,holdEnd:5}];
 expect(focusEntry(1.9,2.1,holds)).toBe(2);
 expect(focusEntry(5.1,4.9,holds)).toBe(5);
 expect(focusEntry(2,2.1,holds)).toBeNull();
 expect(focusEntry(3,6,holds)).toBeNull();
 expect(focusEntry(0,.9,holds)).toBeNull();
 expect(withinFocus(3,holds)).toBe(true);
});
