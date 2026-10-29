import * as THREE from './public/vendor/three/build/three.module.js';

// Different coplanar objects must not compete for the same depth-buffer value.
// Bias changes rasterization only; geometry, measurement points and picking stay exact.
export function surfaceDepth(kind, rank=0, count=1) {
  return {depthTest:true,depthWrite:true,polygonOffset:true,
    polygonOffsetFactor:kind==='tile'?0:1,
    polygonOffsetUnits:kind==='tile'?-16:32+(count-rank)*8};
}

export function outlineMaterial(color, kind='hard') {
  const material=new THREE.LineBasicMaterial({color,transparent:false,opacity:1,depthTest:true,depthWrite:false});
  if(kind==='tile'){
    // POLYGON_OFFSET_FILL does not apply to GL_LINES. Give tile seams a small
    // clip-space bias, while retaining depth testing against actual occluders.
    material.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\ngl_Position.z -= 0.000004 * gl_Position.w;');
    };
    material.customProgramCacheKey=()=> 'tile-seams-depth-v1';
  }
  return material;
}

export function fitDepthRange(camera,bounds) {
  const forward=camera.getWorldDirection(new THREE.Vector3());
  let min=Infinity,max=-Infinity;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
    const depth=new THREE.Vector3(x,y,z).sub(camera.position).dot(forward);min=Math.min(min,depth);max=Math.max(max,depth);
  }
  const near=Math.max(.02,min-.15);
  const far=Math.max(near+1,max+.5);
  if(Math.abs(camera.near-near)>1e-5||Math.abs(camera.far-far)>1e-5){
    camera.near=near;camera.far=far;camera.updateProjectionMatrix();
  }
  return {near,far};
}
