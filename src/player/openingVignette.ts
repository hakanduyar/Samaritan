import {Mesh, type Material, type Object3D} from 'three';
import type {OpeningContract, OpeningPhase} from './openingClock';

const smooth=(value:number)=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};
export function openingVignetteOpacity(phase:OpeningPhase,time:number,meta:OpeningContract){
 if(phase==='commands')return 0;
 if(phase==='world')return 1-smooth((time-meta.phases.approach.start)/(meta.phases.approach.end-meta.phases.approach.start));
 if(phase==='return')return smooth((time-meta.phases.return.start)/(meta.phases.return.end-meta.phases.return.start));
 return 1;
}

/** Presentation-only fade: imported geometry/animation and interactive vignette stay unchanged. */
export function createOpeningVignette(scene:Object3D){
 const node=scene.getObjectByName('fx_vignette');
 if(!(node instanceof Mesh)||Array.isArray(node.material))throw Error('Unsupported opening vignette');
 const original:Material=node.material,material=original.clone();node.material=material;
 return {apply(amount:number){material.opacity=original.opacity*amount;},dispose(){node.material=original;material.dispose();}};
}
