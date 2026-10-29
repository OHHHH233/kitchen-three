import * as THREE from './public/vendor/three/build/three.module.js';

export function createDoorRig(node,model,{position=new THREE.Vector3(),travel=new THREE.Vector3(),angle=0}){
  model.updateWorldMatrix(true,true);
  const pivot=new THREE.Group();pivot.name='preview-door-pivot';pivot.position.copy(position);model.add(pivot);
  pivot.updateWorldMatrix(true,false);pivot.attach(node);
  return {pivot,closedPosition:pivot.position.clone(),travel:travel.clone(),angle};
}

export function poseDoors(rigs,progress){
  const t=Math.max(0,Math.min(1,progress));
  for(const rig of rigs){
    rig.pivot.position.copy(rig.closedPosition).addScaledVector(rig.travel,t);
    rig.pivot.rotation.y=rig.angle*t;
    rig.pivot.updateMatrixWorld(true);
  }
}
