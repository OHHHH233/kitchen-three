import * as THREE from './public/vendor/three/build/three.module.js';
import {surfaceDepth} from './render-depth.js';

export function cabinetMaterial(original,rank,count){
  const material=original.clone();
  // Unassigned source panels use a neutral satin finish; authored material
  // slots keep their colors, UV maps, normal maps and metal/roughness values.
  if(!original.name){material.color.setHex(0xeeeae2);material.metalness=0;material.roughness=.65;}
  Object.assign(material,surfaceDepth('hard',rank,count));
  material.side=THREE.DoubleSide;material.forceSinglePass=true;
  return material;
}

export function studioEnvironment(renderer){
  const studio=new THREE.Scene();
  const room=new THREE.Mesh(new THREE.BoxGeometry(12,10,12),new THREE.MeshBasicMaterial({color:0x858b94,side:THREE.BackSide}));studio.add(room);
  for(const [position,rotation,width,height] of [[[-4,0,0],[0,Math.PI/2,0],4,7],[[4,0,-1],[0,-Math.PI/2,0],3,6],[[0,4,0],[Math.PI/2,0,0],6,4]]){
    const light=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({color:0xffffff}));
    light.position.set(...position);light.rotation.set(...rotation);studio.add(light);
  }
  const generator=new THREE.PMREMGenerator(renderer),target=generator.fromScene(studio,.04,.1,50);generator.dispose();
  studio.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
  return target.texture;
}
