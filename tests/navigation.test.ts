import { expect, it } from 'vitest';
import {advanceNavigation,navigationTarget,MAX_NAVIGATION_RATE,MAX_NAVIGATION_ACCELERATION} from '../src/player/navigation';

it('bounds huge burst speed/acceleration while settling and reversing along the same scalar path',()=>{
 let current=0,velocity=0,target=navigationTarget(0,0,35),maxRate=0,maxAcceleration=0;
 expect(target).toBe(.6);
 for(let i=0;i<300;i++) { const next=advanceNavigation(current,target,velocity,1/60); maxRate=Math.max(maxRate,Math.abs(next.velocity)); maxAcceleration=Math.max(maxAcceleration,Math.abs(next.velocity-velocity)*60); current=next.current;velocity=next.velocity; }
 expect(current).toBe(.6); expect(velocity).toBe(0);
 expect(maxRate).toBeLessThanOrEqual(MAX_NAVIGATION_RATE);expect(maxAcceleration).toBeLessThanOrEqual(MAX_NAVIGATION_ACCELERATION+1e-8);
 target=navigationTarget(current,target,-35);
 for(let i=0;i<300;i++) ({current,velocity}=advanceNavigation(current,target,velocity,1/60));
 expect(current).toBe(0);expect(velocity).toBe(0);
});
it('reverse intention cancels forward backlog rather than adding to it',()=>{
 expect(navigationTarget(10,10.6,-.1)).toBe(9.9);
});
