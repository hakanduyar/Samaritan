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
 expect(clock.advance(1,false).phase).toBe('world');expect(clock.snapshot().clipTime).toBeCloseTo(1.12);
 const before=clock.snapshot().visualTime;
 clock.advance((straight.phases.approach.end-1.12)/1.12+.001,false);
 expect(clock.snapshot().phase).toBe('commands');
 expect(clock.snapshot().visualTime).toBeGreaterThan(before); // Overall visual time stays monotonic.
 expect(clock.advance(2.9,false).phase).toBe('commands');
 expect(clock.advance(.11,false).phase).toBe('return');
 expect(clock.advance(.2,false).clipTime).toBeCloseTo(straight.phases.return.start+.2);
 expect(()=>createOpeningClock(straight,0)).toThrow();
});
it('adds a short loading phase and accelerates the straight flight within nine seconds',()=>{
 const straight=validateOpening(JSON.parse(readFileSync('public/assets/samaritan/opening-straight/opening-metadata.json','utf8')),true);
 const clock=createOpeningClock(straight,1.12,1.5,9);
 expect(clock.advance(1.49,false).phase).toBe('loading');
 expect(clock.advance(.02,false).phase).toBe('connection');
 expect(clock.advance(1,false).phase).toBe('world');
 const first=clock.advance(1,false).clipTime;
 clock.advance(6,false);const later=clock.snapshot().clipTime;
 const lateStep=clock.advance(1,false).clipTime-later;
 expect(lateStep).toBeGreaterThan(first);
 expect(clock.advance(1,false).phase).toBe('commands');
 expect(clock.snapshot().blinkTime).toBe(0);
});
it('starts commands at the covering pane pose and keeps the blink clock running through return',()=>{
 const straight=validateOpening(JSON.parse(readFileSync('public/assets/samaritan/opening-straight/opening-metadata.json','utf8')),true);
 const clock=createOpeningClock(straight,1.12,0,9);
 clock.advance(1,false);clock.advance(7,false);
 const pose=straight.phases.approach.start;
 expect(clock.startCommands(pose)).toBe(true);
 expect(clock.snapshot()).toMatchObject({phase:'commands',clipTime:pose,command:'WHAT',blinkTime:0});
 expect(clock.startCommands(pose)).toBe(false);
 clock.advance(3,false);
 expect(clock.snapshot()).toMatchObject({phase:'return',blinkTime:3});
 expect(clock.advance(.25,false).blinkTime).toBe(3.25);
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
