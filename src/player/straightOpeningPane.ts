import {CanvasTexture, Mesh, MeshBasicMaterial, SRGBColorSpace, type Object3D} from 'three';

/** Replace only the admitted pane's atlas cell, retaining its authored mesh/morph/alpha. */
export function createStraightOpeningPane(scene:Object3D, name:string){
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
  // Observed command frame: dark tracked text/underline, upward red triangle
  // below the line near its left end. Font family remains an approximation.
  context.fillStyle='#262626';context.font='500 48px monospace';context.textAlign='left';context.textBaseline='middle';
  const spacing=4,width=context.measureText(command).width+Math.max(0,command.length-1)*spacing;
  let x=1024-width/2;
  for(const glyph of command){context.fillText(glyph,x,560);x+=context.measureText(glyph).width+spacing;}
  const left=1024-width/2;
  context.fillRect(left,593,width,3);
  const triangleX=left+Math.min(45,width*.2);
  context.fillStyle='#d92035';context.beginPath();context.moveTo(triangleX,609);context.lineTo(triangleX-24,649);context.lineTo(triangleX+24,649);context.closePath();context.fill();texture.needsUpdate=true;
 },dispose(){pane.material=original;material.dispose();texture.dispose();}};
}
