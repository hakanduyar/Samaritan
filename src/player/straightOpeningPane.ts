import {CanvasTexture, Color, Matrix4, Mesh, MeshBasicMaterial, SRGBColorSpace, type BufferAttribute,type InterleavedBufferAttribute,type Object3D, type PerspectiveCamera} from 'three';

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
 let attached=false,last:string|null=null;
 const blink={value:1},frameEdge={value:1};
 // Animate small scalar uniforms instead of uploading the 9 MB command canvas.
 material.onBeforeCompile=shader=>{
  shader.uniforms.commandBlink=blink;shader.uniforms.commandEdge=frameEdge;
  shader.uniforms.commandRed={value:new Color('#d92035')};
  shader.uniforms.commandBorder={value:new Color('rgb(90,98,102)')};
  shader.uniforms.commandWhite={value:new Color('rgb(247,247,246)')};
  shader.uniforms.commandDim={value:new Color('rgb(237,237,236)')};
  shader.fragmentShader='uniform float commandBlink; uniform float commandEdge; uniform vec3 commandRed; uniform vec3 commandBorder; uniform vec3 commandWhite; uniform vec3 commandDim;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 commandPixel=vMapUv*vec2(2048.0,1152.0);
   float commandRadius=36.0+24.0*commandEdge;
   float triangleY=commandPixel.y-602.0;
   float triangleHalf=triangleY/1.733;
   float triangleDistance=min(min(triangleY,commandRadius*1.733-triangleY),triangleHalf-abs(commandPixel.x-1024.0));
   float triangleCoverage=smoothstep(-fwidth(triangleDistance),fwidth(triangleDistance),triangleDistance)*commandBlink;
   float commandPaper=smoothstep(.75,.9,min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b)));
   diffuseColor.rgb=mix(diffuseColor.rgb,mix(commandWhite,commandDim,commandEdge),commandPaper);
   float borderDistance=min(min(commandPixel.x,2048.0-commandPixel.x),min(commandPixel.y,1152.0-commandPixel.y));
   float borderCoverage=1.0-smoothstep(9.0,11.0,borderDistance);
   diffuseColor.rgb=mix(diffuseColor.rgb,commandBorder,borderCoverage*commandEdge*.65);
   diffuseColor.rgb=mix(diffuseColor.rgb,commandRed,triangleCoverage);
  `);
 };
 material.customProgramCacheKey=()=> 'straight-command-uniforms-v1';
 // Coverage probe: morphed pane vertices -> NDC; all four viewport corners must lie inside projected triangles.
 const geometry=pane.geometry,position=geometry.getAttribute('position'),morphs=geometry.morphAttributes.position??[],relative=geometry.morphTargetsRelative;
 const count=position.count,index=geometry.index,triangles=index?index.count:count;
 const base=new Float32Array(count*3),scratch=new Float32Array(count*3),ndc=new Float32Array(count*2),view=new Matrix4(),clip=new Matrix4();
 for(let i=0;i<count;i++){base[i*3]=position.getX(i);base[i*3+1]=position.getY(i);base[i*3+2]=position.getZ(i);}
 const deltas=morphs.map((m:BufferAttribute|InterleavedBufferAttribute)=>{const d=new Float32Array(count*3);for(let i=0;i<count;i++){d[i*3]=m.getX(i);d[i*3+1]=m.getY(i);d[i*3+2]=m.getZ(i);}return d;});
 const corners=[-1,-1,1,-1,1,1,-1,1];
 const vertex=(k:number)=>index?index.getX(k):k;
 /** Cheap per-frame test using current morph influences, pane world matrix and camera world/projection matrices. */
 const covers=(camera:PerspectiveCamera)=>{
  if(count>4096||triangles<3)return false;
  const influences=pane.morphTargetInfluences??[];
  scratch.set(base);
  for(let t=0;t<deltas.length;t++){const w=influences[t]??0;if(!w)continue;const d=deltas[t]!;for(let i=0;i<d.length;i++)scratch[i]!+=(relative?d[i]!:d[i]!-base[i]!)*w;}
  view.copy(camera.matrixWorld).invert();clip.multiplyMatrices(camera.projectionMatrix,view).multiply(pane.matrixWorld);
  const e=clip.elements;
  for(let i=0;i<count;i++){
   const x=scratch[i*3]!,y=scratch[i*3+1]!,z=scratch[i*3+2]!;
   const w=e[3]!*x+e[7]!*y+e[11]!*z+e[15]!;
   if(!(w>1e-4))return false;
   ndc[i*2]=(e[0]!*x+e[4]!*y+e[8]!*z+e[12]!)/w;ndc[i*2+1]=(e[1]!*x+e[5]!*y+e[9]!*z+e[13]!)/w;
  }
  for(let c=0;c<8;c+=2){
   const px=corners[c]!,py=corners[c+1]!;let inside=false;
   for(let k=0;k<triangles&&!inside;k+=3){
    const a=vertex(k)*2,b=vertex(k+1)*2,d=vertex(k+2)*2;
    const ax=ndc[a]!-px,ay=ndc[a+1]!-py,bx=ndc[b]!-px,by=ndc[b+1]!-py,cx=ndc[d]!-px,cy=ndc[d+1]!-py;
    const s1=ax*by-ay*bx,s2=bx*cy-by*cx,s3=cx*ay-cy*ax;
    inside=(s1>=0&&s2>=0&&s3>=0)||(s1<=0&&s2<=0&&s3<=0);
   }
   if(!inside)return false;
  }
  return true;
 };
 return {covers,show(command:string,visualTime=0,cover=1){
  if(!attached){pane.material=material;attached=true;}
  const visible=Math.floor(Math.max(0,visualTime)/.5)%2===0;
  const edge=Math.round((1-cover)*24)/24;
  blink.value=visible?1:0;frameEdge.value=edge;
  const key=command;
  if(last===key)return;last=key;
  context.fillStyle='rgb(247,247,246)';context.fillRect(0,0,2048,1152);

  // Authored presentation: shared centre axis for word, underline and marker.
  context.fillStyle='#262626';context.font='600 56px monospace';context.textAlign='left';context.textBaseline='middle';
  const spacing=4,width=context.measureText(command).width+Math.max(0,command.length-1)*spacing;
  let x=1024-width/2;
  for(const glyph of command){context.fillText(glyph,x,560);x+=context.measureText(glyph).width+spacing;}
  const left=1024-width/2;
  context.fillRect(left,593,width,3);
  texture.needsUpdate=true;
 },dispose(){pane.material=original;material.dispose();texture.dispose();}};
}
