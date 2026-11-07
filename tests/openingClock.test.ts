import {openingVignetteOpacity} from '../src/player/openingVignette';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createOpeningClock,validateOpening} from '../src/player/openingClock';
const meta=validateOpening(JSON.parse(readFileSync('public/assets/samaritan/opening/opening-metadata.json','utf8')));
it('speeds forward travel only while preserving connection, command dwell and return timing',()=>{
 const straight=validateOpening(JSON.parse(readFileSync('public/assets/samaritan/opening-straight/opening-metadata.json','utf8')),true);
 const clock=createOpeningClock(straight,1.12);
 expect(clock.advance(.9,false).phase).toBe('connection');
 clock.advance(.1,false);
 expect(clock.advance(5,false).phase).toBe('world');expect(clock.snapshot().clipTime).toBeCloseTo(5.6);
 clock.advance((straight.phases.approach.end-5.6)/1.12+.001,false);
 expect(clock.snapshot().phase).toBe('commands');
 expect(clock.advance(2.9,false).phase).toBe('commands');
 expect(clock.advance(.11,false).phase).toBe('return');
 expect(clock.advance(.2,false).clipTime).toBeCloseTo(straight.phases.return.start+.2);
 expect(()=>createOpeningClock(straight,0)).toThrow();
});
it('holds commands for visible time and does not skip the stage on a long frame',()=>{
 const clock=createOpeningClock(meta);
 expect(clock.advance(20,false).phase).toBe('world');
 expect(clock.advance(20,false).phase).toBe('commands');
 expect(clock.advance(2.8,false).phase).toBe('commands');
 expect(clock.advance(.21,false).phase).toBe('return');
 expect(clock.advance(20,false)).toMatchObject({phase:'complete',clipTime:meta.durationSeconds});
 expect(clock.advance(20,false).phase).toBe('complete');
});
it('reduced motion removes travel/return without restarting command dwell',()=>{
 const clock=createOpeningClock(meta);
 expect(clock.advance(.5,true).phase).toBe('connection');
 expect(clock.advance(.5,true).phase).toBe('commands');
 expect(clock.advance(3.1,true).phase).toBe('complete');
});
it('rejects noncontiguous phases and unknown identities',()=>{
 expect(()=>validateOpening({...meta,openingClipName:'wrong'})).toThrow();
 expect(()=>validateOpening({...meta,phases:{...meta.phases,return:{start:8,end:meta.durationSeconds}}})).toThrow();
});

it('vignette is continuous at approach/command/return boundaries',()=>{
 expect(openingVignetteOpacity('world',meta.phases.approach.start,meta)).toBe(1);
 expect(openingVignetteOpacity('world',meta.phases.approach.end,meta)).toBe(0);
 expect(openingVignetteOpacity('commands',meta.phases.paneHold.start,meta)).toBe(0);
 expect(openingVignetteOpacity('return',meta.phases.return.start,meta)).toBe(0);
 expect(openingVignetteOpacity('return',meta.phases.return.end,meta)).toBe(1);
 const before=openingVignetteOpacity('world',meta.phases.approach.end-.001,meta);
 const after=openingVignetteOpacity('return',meta.phases.return.start+.001,meta);
 expect(before).toBeLessThan(.000001);expect(after).toBeLessThan(.000001);
});
