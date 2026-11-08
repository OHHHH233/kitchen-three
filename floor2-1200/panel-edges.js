import * as THREE from './public/vendor/three/build/three.module.js';

const explicitPanelEdges = new Set(['柜板_竖.009', '柜板_竖.011', '柜板_竖.014', '柜板_竖.015', '柜板_竖.016', '防潮地砖踢脚线']);
const sanitizedPanelEdges = new Set([...explicitPanelEdges].map(name => THREE.PropertyBinding.sanitizeNodeName(name)));

export function togglePanelEdges(root, visible) {
  root.traverse(object => {
    if (object.userData.panelEdgeLine) object.visible = visible;
  });
}

export function addPanelEdges(root, visible = true) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse(object => { if (object.isMesh) meshes.push(object); });
  for (const object of meshes) {
    if (object.userData.panelEdgeProcessed) continue;
    // GLTFLoader preserves the Blender name here, while object.name loses periods.
    let sourceName = object.userData.name || object.name;
    let explicit = false;
    for (let node = object; node; node = node.parent) {
      const name = node.userData.name || node.name;
      if (explicitPanelEdges.has(name) || sanitizedPanelEdges.has(name)) {
        explicit = true;
        sourceName = name;
        break;
      }
    }
    if (!explicit && !/(?:横|竖)/.test(sourceName)) continue;
    object.geometry.computeBoundingBox();
    const size = object.geometry.boundingBox.getSize(new THREE.Vector3());
    const matrix = object.matrixWorld.elements;
    const worldSize = [0, 1, 2].map(axis => {
      const scale = Math.hypot(matrix[axis * 4], matrix[axis * 4 + 1], matrix[axis * 4 + 2]);
      return size.getComponent(axis) * scale;
    });
    if (!explicit && Math.abs(Math.min(...worldSize) - .018) > .001) continue;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry, 12),
      new THREE.LineBasicMaterial({ color: 0x43484d, transparent: true, opacity: .82, depthWrite: false }));
    edges.userData.panelEdgeLine = true;
    edges.userData.panelEdgeSource = sourceName;
    edges.renderOrder = 2;
    edges.visible = visible;
    object.add(edges);
    object.userData.panelEdgeProcessed = true;
  }
}
