import * as THREE from 'three';
import {LineSegments2} from './public/vendor/three/examples/jsm/lines/LineSegments2.js';
import {LineSegmentsGeometry} from './public/vendor/three/examples/jsm/lines/LineSegmentsGeometry.js';
import {LineMaterial} from './public/vendor/three/examples/jsm/lines/LineMaterial.js';

// Screen-space widths remain conspicuous at room scale and while zooming.
export function createSocketOutline(edges){
  const geometry=new LineSegmentsGeometry().setPositions(edges.getAttribute('position').array);
  const group=new THREE.Group();group.name='socket-highlight-outline';group.userData.socketHighlight=true;
  for(const [index,[width,color,opacity]] of [[12,0x008cff,.22],[6,0x0055ff,1],[2.5,0x00eaff,1]].entries()){
    const material=new LineMaterial({linewidth:width,color,opacity,transparent:true,depthTest:true,depthWrite:false,toneMapped:false,worldUnits:false});
    material.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <logdepthbuf_vertex>','gl_Position.z -= 0.000004 * gl_Position.w;\n#include <logdepthbuf_vertex>');};
    material.customProgramCacheKey=()=> 'socket-bold-outline-v1';
    const line=new LineSegments2(geometry,material);line.renderOrder=411+index;
    line.raycast=()=>{};
    line.onBeforeRender=renderer=>renderer.getSize(material.resolution);
    group.add(line);
  }
  return group;
}
