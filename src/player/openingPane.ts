import {CanvasTexture, Mesh, MeshBasicMaterial, SRGBColorSpace, type Object3D} from 'three';

/** Replace only the admitted pane's atlas cell, retaining its authored mesh/morph/alpha. */
export function createOpeningPane(scene:Object3D, name:string){
 const pane=scene.getObjectByName(name);
 if(!(pane instanceof Mesh)||!(pane.material instanceof MeshBasicMaterial))throw Error('Unsupported opening pane');
 const uv=pane.geometry.getAttribute('uv');
 let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
 for(let i=0;i<uv.count;i++){minU=Math.min(minU,uv.getX(i));maxU=Math.max(maxU,uv.getX(i));minV=Math.min(minV,uv.getY(i));maxV=Math.max(maxV,uv.getY(i));}
 if(!(maxU>minU&&maxV>minV))throw Error('Invalid opening pane UV bounds');
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1152;
 const context=canvas.getContext('2d');if(!context)throw Error('Command canvas unavailable');
 const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.flipY=false;
 texture.repeat.set(1/(maxU-minU),1/(maxV-minV));texture.offset.set(-minU/(maxU-minU),-minV/(maxV-minV));
 const original=pane.material,material=original.clone();material.map=texture;
 let attached=false,last='';
 return {show(command:string){
  if(!attached){pane.material=material;attached=true;}
  if(last===command)return;last=command;
  context.fillStyle='#f7f7f6';context.fillRect(0,0,2048,1152);
  context.fillStyle='#b52027';context.beginPath();context.moveTo(998,482);context.lineTo(1050,482);context.lineTo(1024,527);context.closePath();context.fill();
  context.fillStyle='#262626';context.font='600 48px Arial';context.textAlign='center';context.textBaseline='middle';context.fillText(command,1024,588);
  context.fillStyle='#b52027';context.fillRect(780,635,488,4);texture.needsUpdate=true;
 },dispose(){pane.material=original;material.dispose();texture.dispose();}};
}
