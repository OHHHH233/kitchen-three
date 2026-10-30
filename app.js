import * as THREE from 'three';
import { addPanelEdges, togglePanelEdges } from './panel-edges.js?v=1.02';
import { bindTapToZoom, tapFocusFrame } from './tap-zoom.js?v=1.02';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { blenderToThree, validateDimensions, centeredOffset, cameraFrame, dimensionArrowHeads, inlineDimensionLayout, dimensionArrowTriangles, inlineDimensionTextScale, fixedDimensionGeometry, dedupeTopViewDimensions, topViewLabelAnchor } from './scene-math.js?v=1.02';
import { cabinetElevations, cabinetRegionsForBounds, cabinetDimensionRegion, cabinetWallRegionForMaterial } from './cabinet-regions.js?v=1.02';

const steps = [
  { id: 'kitchen', name: '厨房整体', sub: '空间与墙面', file: 'kitchen-overall.glb' },
  { id: 'cabinetBody', name: '橱柜', sub: '横板、竖板与踢脚线', file: 'cabinet-body.glb' },
  { id: 'countertop', name: '台面', sub: '工作面与高度', file: 'countertops.glb' },
  { id: 'wallCabinet', name: '吊柜', sub: '上部储物', file: 'wall-cabinets.glb' },
];
const state = { activeStep: 'kitchen', view: '3d', elevation: 'window', overall: false,
  annotations: true, section: true, edgeLines: true, selected: null, dimensions: [] };
const $ = selector => document.querySelector(selector);
const sceneEl = $('#scene-canvas'), loadingEl = $('#loading-state');
const errorEl = $('#model-error'), overlay = $('#annotation-layer');
const loader = new GLTFLoader(), modelCache = new Map();
THREE.Cache.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f5f7);
const perspective = new THREE.PerspectiveCamera(42, 1, .01, 200);
const orthographic = new THREE.OrthographicCamera(-4, 4, 4, -4, .01, 200);
const topViewDirection = new THREE.Vector3(0, 1, 0);
const topViewUp = new THREE.Vector3(0, 0, 1);
let camera = perspective, renderer, controls;
let tapFocusAnimation = null;
const mobileViewport = window.matchMedia('(max-width: 850px)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let referenceBox, referenceModelSource, modelBounds, fullModelBounds, offset = new THREE.Vector3();
let sceneFloor, sceneGrid;
let requestVersion = 0, labels = [], labelLayoutDirty = true;
const modelRoot = new THREE.Group(), annotationRoot = new THREE.Group();
scene.add(modelRoot, annotationRoot);
const sectionMaterials = new Set();

function formatMillimeters(meters) { return `${Math.round(meters * 1000)} mm`; }

const dimensionColor = '#30353a';

function visibleDimensions() {
  const visible = state.dimensions.filter(item => {
    if (item.category !== (state.overall ? 'kitchen' : state.activeStep)) return false;
    if (state.activeStep === 'cabinetBody' && isCabinetElevation() && item.id === '踢脚线尺.002') return false;
    return !isCabinetElevation() || cabinetDimensionRegion(item) === state.elevation;
  });
  return isTopView() ? dedupeTopViewDimensions(visible) : visible;
}

function isCabinetElevation() {
  return isCabinetSection() && state.view === 'elevation';
}

function isCabinetSection() { return ['cabinetBody', 'wallCabinet'].includes(state.activeStep); }

function isTopView() { return state.view === 'top'; }

function elevationLabel() {
  return isCabinetElevation() ? cabinetElevations[state.elevation].label : '正面';
}

function clearAnnotations() {
  const geometries = new Set(), materials = new Set();
  annotationRoot.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) materials.add(child.material);
  });
  annotationRoot.clear();
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  overlay.replaceChildren();
  labels = [];
}

function showError(error) {
  console.error(error);
  loadingEl.hidden = true;
  errorEl.hidden = false;
  $('#model-error-detail').textContent = error.message || String(error);
  sceneEl.setAttribute('aria-busy', 'false');
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  sceneEl.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .09;
  controls.maxPolarAngle = Math.PI / 2 - .025;
  controls.minDistance = .6;
  controls.maxDistance = 35;
  controls.minZoom = .4;
  controls.maxZoom = 8;
  controls.addEventListener('change', () => { labelLayoutDirty = true; });
  setupTapZoom();
  updateViewerHint();
  scene.add(new THREE.HemisphereLight(0xf8fbfa, 0x899791, 2.2));
  const key = new THREE.DirectionalLight(0xfff2df, 3.1);
  key.position.set(-4, 8, -5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, far: 25 });
  key.shadow.normalBias = .025;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe9e6, 1.4);
  fill.position.set(5, 4, 3);
  scene.add(fill);
  sceneFloor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0xe8e8ed, roughness: .92 }));
  sceneFloor.rotation.x = -Math.PI / 2;
  sceneFloor.position.y = -.035;
  sceneFloor.receiveShadow = true;
  scene.add(sceneFloor);
  sceneGrid = new THREE.GridHelper(24, 48, 0xd4d4da, 0xe1e1e5);
  sceneGrid.position.y = -.025;
  sceneGrid.material.transparent = true;
  sceneGrid.material.opacity = .22;
  scene.add(sceneGrid);
  new ResizeObserver(resize).observe(sceneEl);
  resize();
  renderer.setAnimationLoop(() => {
    updateTapFocus();
    controls.update();
    renderer.render(scene, camera);
    if (labelLayoutDirty) layoutLabels();
  });
}

function updateViewerHint() {
  $('.viewer-hint').textContent = mobileViewport.matches
    ? (state.view === '3d' ? '轻点区域放大 · 单指旋转 · 双指缩放 / 平移' : '轻点区域放大 · 双指缩放 / 平移')
    : (state.view === '3d' ? '拖拽旋转 · 滚轮缩放 · 右键平移'
      : state.view === 'top' ? '滚轮缩放 · 右键平移 · 平面尺寸'
        : '滚轮缩放 · 右键平移 · 切换立面方向');
}

function setupTapZoom() {
  const raycaster = new THREE.Raycaster();
  bindTapToZoom(renderer.domElement, event => {
    if (!modelBounds || !loadingEl.hidden || !errorEl.hidden) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2);
    camera.updateMatrixWorld();
    modelRoot.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(modelRoot, true).find(entry => {
      if (!entry.object.isMesh) return false;
      for (let node = entry.object; node; node = node.parent) if (!node.visible) return false;
      const material = Array.isArray(entry.object.material)
        ? entry.object.material[entry.face.materialIndex] : entry.object.material;
      const cameraPoint = entry.point.clone().applyMatrix4(camera.matrixWorldInverse);
      return material.visible && (!material.transparent || material.opacity > 0) &&
        -cameraPoint.z >= camera.near && -cameraPoint.z <= camera.far &&
        !(material.clippingPlanes || []).some(plane => plane.distanceToPoint(entry.point) < 0);
    });
    if (!hit) return;
    // Finish residual damping before taking the animation's initial camera pose.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    const end = tapFocusFrame(camera, controls.target, hit.point,
      { minDistance: controls.minDistance, maxZoom: controls.maxZoom });
    tapFocusAnimation = { started: performance.now(), duration: reducedMotion.matches ? 0 : 280,
      position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom, end };
    sceneEl.dataset.tapZoomCount = String(Number(sceneEl.dataset.tapZoomCount || 0) + 1);
  }, {
    isEnabled: event => event.pointerType === 'touch' || event.pointerType === 'pen' || mobileViewport.matches,
    onStart: () => { tapFocusAnimation = null; },
  });
  renderer.domElement.addEventListener('wheel', () => { tapFocusAnimation = null; }, { passive: true });
  mobileViewport.addEventListener('change', updateViewerHint);
}

function updateTapFocus() {
  if (!tapFocusAnimation) return;
  const focus = tapFocusAnimation;
  const progress = focus.duration ? Math.min(1, (performance.now() - focus.started) / focus.duration) : 1;
  const eased = 1 - Math.pow(1 - progress, 3);
  camera.position.lerpVectors(focus.position, focus.end.position, eased);
  controls.target.lerpVectors(focus.target, focus.end.target, eased);
  camera.zoom = THREE.MathUtils.lerp(focus.zoom, focus.end.zoom, eased);
  camera.updateProjectionMatrix();
  labelLayoutDirty = true;
  if (progress === 1) tapFocusAnimation = null;
}

function resize() {
  if (!renderer) return;
  const { width, height } = sceneEl.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  perspective.aspect = width / height;
  perspective.updateProjectionMatrix();
  if (modelBounds) frameView();
  if (isCabinetElevation() && elevationPreviewSource) updateElevationPreview(elevationPreviewSource);
  labelLayoutDirty = true;
}

async function loadModel(step) {
  if (!modelCache.has(step.id)) {
    const cacheVersion = window.__MODEL_CACHE_VERSION__ ? `?v=${encodeURIComponent(window.__MODEL_CACHE_VERSION__)}` : '';
    const pending = loader.loadAsync(`./public/assets/${step.file}${cacheVersion}`).then(gltf => {
      gltf.scene.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = child.receiveShadow = true;
        let wall = false;
        for (let node = child; node; node = node.parent) {
          if (node.name.startsWith('厨房墙面')) { wall = true; break; }
        }
        const materials = (Array.isArray(child.material) ? child.material : [child.material]).map(material => {
          // Wall clipping must not affect materials shared with cabinets.
          const result = wall ? material.clone() : material;
          result.roughness = Math.max(result.roughness ?? .65, .42);
          if (wall) sectionMaterials.add(result);
          return result;
        });
        child.material = Array.isArray(child.material) ? materials : materials[0];
      });
      addPanelEdges(gltf.scene, state.edgeLines);
      return gltf.scene;
    }).catch(error => { modelCache.delete(step.id); throw error; });
    modelCache.set(step.id, pending);
  }
  return (await modelCache.get(step.id)).clone(true);
}

function updateSection() {
  if (!referenceBox) return;
  const box = referenceBox.clone().translate(offset);
  const fromLeft = state.view === 'elevation' && state.elevation === 'rice';
  const planes = [
    new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y - .07),
    fromLeft ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x - .18)
      : new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x - .18),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z - .18),
  ];
  sectionMaterials.forEach(material => {
    material.clippingPlanes = state.section ? planes : [];
    material.clipShadows = true;
    material.needsUpdate = true;
  });
  $('#section-toggle').setAttribute('aria-pressed', String(state.section));
  $('#section-toggle').disabled = state.activeStep !== 'kitchen';
}

function sourceObjectName(object) {
  let fallback = '';
  for (let node = object; node; node = node.parent) {
    const name = node.userData.name || node.name;
    if (!fallback && name) fallback = name;
    if (/(?:踢脚线|地面)/.test(name)) return name;
  }
  return fallback;
}

function isObjectUnderNamedNode(object, expectedName) {
  for (let node = object; node; node = node.parent) {
    if (node.name === expectedName || node.userData.name === expectedName) return true;
  }
  return false;
}

function prepareCabinetElevations(model, sectionId) {
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse(object => { if (object.isMesh) meshes.push(object); });
  for (const mesh of meshes) {
    const bounds = new THREE.Box3().setFromObject(mesh);
    const name = sourceObjectName(mesh);
    mesh.userData.cabinetRegions = cabinetRegionsForBounds(bounds, name);
    mesh.userData.cabinetSurfaceWasVisible = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .map(material => material.visible);
    mesh.userData.cabinetMaterialState = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .map(material => ({ color: material.color?.getHex() ?? 0xffffff, transparent: material.transparent,
        opacity: material.opacity, depthWrite: material.depthWrite }));
    const size = bounds.getSize(new THREE.Vector3());
    const elevationFillPanel = sectionId === 'cabinetBody' &&
      ['柜板_竖.003', '柜板_竖.005', '柜板_竖.008'].some(objectName => isObjectUnderNamedNode(mesh, objectName));
    const elevationKickboardFill = name.includes('踢脚线');
    const boardName = /(?:_横|_竖|横板|竖板)/.test(name);
    const is18Millimeter = Math.abs(Math.min(size.x, size.y, size.z) - .018) <= .001;
    mesh.userData.cabinetElevationFillPanel = elevationFillPanel;
    mesh.userData.cabinetElevationKickboardFill = elevationKickboardFill;
    mesh.userData.cutawayPanel = elevationKickboardFill || (boardName && is18Millimeter) || elevationFillPanel;
    if (!mesh.userData.cabinetRegions.length) continue;
    // Invisible faces populate depth first so rear and internal edges cannot cross the facade.
    const occluder = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
    }));
    occluder.userData.cabinetElevationOccluder = true;
    occluder.renderOrder = 1;
    occluder.visible = false;
    mesh.add(occluder);
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 12),
      new THREE.LineBasicMaterial({ color: 0x121212, transparent: true, opacity: .96, depthTest: true, depthWrite: false }));
    line.userData.cabinetElevationLine = true;
    line.renderOrder = 6;
    line.visible = false;
    mesh.add(line);
    if (elevationFillPanel || elevationKickboardFill) {
      const kickboard = elevationKickboardFill;
      const fill = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
        color: kickboard ? 0x51565b : 0xc9e4f7,
        transparent: true,
        opacity: kickboard ? .9 : .32,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        side: THREE.DoubleSide,
      }));
      fill.userData.cabinetElevationFill = true;
      fill.userData.cabinetElevationFillKind = kickboard ? 'kickboard' : 'panel';
      fill.renderOrder = 4;
      fill.visible = false;
      mesh.add(fill);
    }
  }
}

function addElevationWalls(model, referenceModel) {
  referenceModel.updateMatrixWorld(true);
  let wallCount = 0;
  referenceModel.traverse(source => {
    if (!source.isMesh) return;
    if (!isObjectUnderNamedNode(source, '厨房墙面、柱')) return;
    const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material];
    const region = cabinetWallRegionForMaterial(sourceMaterials[0]?.name);
    if (!region) return;

    const wall = source.clone(false);
    wall.matrixAutoUpdate = false;
    wall.matrix.copy(source.matrixWorld);
    wall.userData.elevationWall = true;
    wall.userData.elevationWallMaterialRegions = [region];
    wall.userData.elevationWallBoundsByRegion = {};
    wall.renderOrder = 0;
    wall.material = [new THREE.MeshBasicMaterial({
      name: sourceMaterials[0].name,
      color: 0xe1e4e7,
      transparent: true,
      opacity: .18,
      depthWrite: false,
      side: THREE.DoubleSide,
      visible: false,
    })];

    const geometry = source.geometry;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const addBounds = targetRegion => {
      const current = wall.userData.elevationWallBoundsByRegion[targetRegion];
      wall.userData.elevationWallBoundsByRegion[targetRegion] = current ? current.union(bounds) : bounds.clone();
    };
    if (region === 'all') Object.keys(cabinetElevations).forEach(addBounds);
    else addBounds(region);

    const edges = new THREE.EdgesGeometry(geometry, 12);
    const edgeLine = new THREE.LineSegments(edges, new THREE.LineDashedMaterial({
      color: 0xb4bbc1, dashSize: .045, gapSize: .03,
      transparent: true, opacity: .92, depthTest: true, depthWrite: false,
    }));
    edgeLine.computeLineDistances();
    edgeLine.userData.elevationWallEdgeRegion = region;
    edgeLine.renderOrder = 1;
    edgeLine.visible = false;
    wall.add(edgeLine);
    model.add(wall);
    wallCount++;
  });
  sceneEl.dataset.elevationWallMeshes = String(wallCount);
}

function regionModelBounds() {
  if (!isCabinetElevation()) return fullModelBounds?.clone() || null;
  modelRoot.updateMatrixWorld(true);
  const result = new THREE.Box3();
  modelRoot.traverse(object => {
    if (!object.isMesh) return;
    const wallBounds = object.userData.elevationWallBoundsByRegion?.[state.elevation];
    if (wallBounds) result.union(wallBounds.clone().applyMatrix4(object.matrixWorld));
    else if (object.userData.cabinetRegions?.includes(state.elevation)) {
      object.geometry.computeBoundingBox();
      result.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return result.isEmpty() ? fullModelBounds?.clone() || null : result;
}

let elevationPreviewRenderer, elevationPreviewScene, elevationPreviewCamera, elevationPreviewModel, elevationPreviewSource;

function frameTopView(camera, bounds, aspect, padding = 1.25) {
  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const halfView = Math.max(size.z / 2, size.x / Math.max(aspect, .1) / 2, .3) * padding;
  camera.left = -halfView * aspect;
  camera.right = halfView * aspect;
  camera.top = halfView;
  camera.bottom = -halfView;
  camera.near = .01;
  camera.far = 100;
  camera.up.copy(topViewUp);
  camera.position.copy(target).addScaledVector(topViewDirection, Math.max(size.y, 1) + 2);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function updateElevationPreview(model) {
  elevationPreviewSource = model;
  const host = $('#elevation-preview');
  if (!host || !renderer) return;
  if (!elevationPreviewRenderer) {
    elevationPreviewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    elevationPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    elevationPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    elevationPreviewRenderer.setClearColor(0x000000, 0);
    host.prepend(elevationPreviewRenderer.domElement);
    elevationPreviewScene = new THREE.Scene();
  }
  if (elevationPreviewModel) {
    elevationPreviewScene.remove(elevationPreviewModel);
    elevationPreviewModel.traverse(object => {
      object.userData.previewMaterials?.forEach(material => material.dispose());
      if (object.userData.previewEdgeMaterial) object.userData.previewEdgeMaterial.dispose();
      if (object.userData.previewEdgeGeometry) object.userData.previewEdgeGeometry.dispose();
    });
  }
  const root = model.clone(true);
  root.position.copy(offset);
  root.traverse(object => {
    if (object.userData.cabinetElevationFill) {
      object.visible = false;
      return;
    }
    if (!object.isMesh) {
      if (object.userData.elevationWallEdgeRegion) {
        object.visible = object.userData.elevationWallEdgeRegion === 'all' ||
          object.userData.elevationWallEdgeRegion === state.elevation;
      }
      return;
    }
    if (!object.userData.cabinetRegions?.length) {
      object.visible = false;
      return;
    }
    if (object.userData.cabinetElevationOccluder) {
      object.visible = false;
      return;
    }
    object.castShadow = object.receiveShadow = false;
    const wallRegions = object.userData.elevationWallMaterialRegions;
    const selected = wallRegions
      ? wallRegions.some(region => region === 'all' || region === state.elevation)
      : object.userData.cabinetRegions?.includes(state.elevation);
    const sources = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sources.map((_, index) => {
      const region = wallRegions?.[index];
      const active = !wallRegions || region === 'all' || region === state.elevation;
      const material = new THREE.MeshBasicMaterial({
        color: wallRegions ? 0xe1e4e7 : active && selected ? 0x9bc1e8 : 0xdfe3e6,
        side: THREE.DoubleSide,
        transparent: Boolean(wallRegions), opacity: wallRegions ? .25 : 1, visible: active,
      });
      return material;
    });
    object.userData.previewMaterials = materials;
    object.material = Array.isArray(object.material) ? materials : materials[0];
    if (!wallRegions) {
      const edges = new THREE.EdgesGeometry(object.geometry, 12);
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: selected ? 0x164085 : 0x29343b,
        transparent: true,
        opacity: selected ? 1 : .82,
        depthTest: false,
        depthWrite: false,
      });
      const edgeLine = new THREE.LineSegments(edges, edgeMaterial);
      edgeLine.renderOrder = selected ? 4 : 3;
      object.userData.previewEdgeMaterial = edgeMaterial;
      object.userData.previewEdgeGeometry = edges;
      object.add(edgeLine);
    }
  });
  elevationPreviewModel = root;
  elevationPreviewScene.add(root);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  root.traverse(object => {
    if (object.isMesh && object.visible && object.userData.cabinetRegions?.length &&
        !object.userData.cabinetElevationOccluder && !object.userData.elevationWallMaterialRegions) {
      bounds.expandByObject(object);
    }
  });
  const width = host.clientWidth || 180, height = host.clientHeight || 180;
  const aspect = width / height;
  elevationPreviewCamera = elevationPreviewCamera || new THREE.OrthographicCamera();
  frameTopView(elevationPreviewCamera, bounds, aspect, 1.04);
  elevationPreviewRenderer.setSize(width, height, false);
  elevationPreviewRenderer.render(elevationPreviewScene, elevationPreviewCamera);
  bindElevationPreviewPicking(host);
}

let elevationPreviewPickingBound = false;
function bindElevationPreviewPicking(host) {
  if (elevationPreviewPickingBound) return;
  elevationPreviewPickingBound = true;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  host.addEventListener('click', event => {
    if (state.activeStep === 'wallCabinet') return;
    if (event.target.closest('#elevation-select') || !elevationPreviewModel || !elevationPreviewCamera) return;
    const rect = elevationPreviewRenderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2);
    elevationPreviewCamera.updateMatrixWorld();
    elevationPreviewModel.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, elevationPreviewCamera);
    const hit = raycaster.intersectObject(elevationPreviewModel, true).find(entry =>
      entry.object.isMesh && entry.object.userData.cabinetRegions?.length);
    if (!hit) return;
    const regions = hit.object.userData.cabinetRegions;
    const region = hit.point.z >= .38 && regions.includes('window') ? 'window'
      : hit.point.x >= .62 && regions.includes('stove') ? 'stove'
        : hit.point.x <= -.82 && regions.includes('rice') ? 'rice'
          : regions.length === 1 ? regions[0] : null;
    if (region) setElevation(region);
  });
}

function updateElevationControls() {
  const active = isCabinetElevation();
  const wallCabinetElevation = state.activeStep === 'wallCabinet';
  $('#elevation-actions').hidden = !active;
  $('#elevation-map').hidden = !active;
  $('#edge-toggle').disabled = active;
  $('#elevation-select').value = state.elevation;
  $('#elevation-select option[value="window"]').hidden = wallCabinetElevation;
  $('#elevation-preview')?.setAttribute('aria-label',
    `${state.activeStep === 'wallCabinet' ? '吊柜' : '橱柜'}平面缩略图，当前立面：${cabinetElevations[state.elevation].label}`);
  $('#cutaway-legend').hidden = true;
  document.querySelectorAll('[data-view="elevation"]').forEach(button => { button.hidden = state.activeStep === 'countertop'; });
  document.querySelectorAll('[data-view="top"]').forEach(button => { button.hidden = false; });
}

function applyModelPresentation() {
  const elevation = isCabinetElevation();
  let visibleElevationLines = 0, visibleCabinetSurfaces = 0, visiblePanelEdges = 0;
  if (elevation) state.overall = false;
  modelRoot.traverse(object => {
    if (object.userData.elevationWall) {
      object.visible = elevation;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material, index) => {
        const region = object.userData.elevationWallMaterialRegions[index];
        material.visible = elevation && (region === 'all' || region === state.elevation);
      });
    }
    if (object.userData.elevationWallEdgeRegion) {
      object.visible = elevation && (object.userData.elevationWallEdgeRegion === 'all' ||
        object.userData.elevationWallEdgeRegion === state.elevation);
    }
    if (object.isMesh && object.userData.cabinetRegions) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material, index) => {
        material.visible = elevation ? false
          : object.userData.cabinetSurfaceWasVisible[index] !== false;
        if (object.userData.cutawayPanel) {
          const original = object.userData.cabinetMaterialState[index];
          material.color.set(original.color);
          material.transparent = original.transparent;
          material.opacity = original.opacity;
          material.depthWrite = original.depthWrite;
        }
      });
      if (materials.some(material => material.visible)) visibleCabinetSurfaces++;
      object.castShadow = !elevation;
    }
    if (object.userData.panelEdgeLine) {
      object.visible = !elevation && state.edgeLines;
      if (object.visible) visiblePanelEdges++;
    }
    if (object.userData.cabinetElevationLine) {
      object.visible = elevation && object.parent.userData.cabinetRegions.includes(state.elevation);
      if (object.visible) visibleElevationLines++;
    }
    if (object.userData.cabinetElevationOccluder) {
      object.visible = elevation && !object.parent.userData.cabinetElevationFillPanel &&
        object.parent.userData.cabinetRegions.includes(state.elevation);
    }
    if (object.userData.cabinetElevationFill) {
      object.visible = elevation && object.parent.userData.cabinetRegions.includes(state.elevation);
    }
  });
  scene.background.set(0xf5f5f7);
  if (sceneGrid) sceneGrid.visible = !elevation && !isTopView();
  if (sceneFloor) sceneFloor.visible = !elevation && !isTopView();
  modelBounds = regionModelBounds();
  sceneEl.dataset.elevation = elevation ? state.elevation : '';
  sceneEl.dataset.presentation = elevation ? 'wireframe' : 'surface';
  sceneEl.dataset.visibleElevationLines = String(visibleElevationLines);
  sceneEl.dataset.visibleCabinetSurfaces = String(visibleCabinetSurfaces);
  sceneEl.dataset.visiblePanelEdges = String(visiblePanelEdges);
  updateElevationControls();
}

function viewDirection() {
  if (state.view === 'top') return topViewDirection.clone();
  if (state.view === '3d') return new THREE.Vector3(1.15, .8, -1.5).normalize();
  if (!isCabinetSection()) return new THREE.Vector3(0, 0, -1);
  return new THREE.Vector3(...cabinetElevations[state.elevation].direction);
}

function frameView() {
  tapFocusAnimation = null;
  if (!modelBounds || !controls) return;
  // Consume residual orbit/pan damping before placing either camera.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
  const box = modelBounds.clone();
  if (state.annotations) for (const item of visibleDimensions()) for (const point of item.endpoints) {
    box.expandByPoint(blenderToThree(point).add(offset));
  }
  const direction = viewDirection();
  const aspect = sceneEl.clientWidth / Math.max(1, sceneEl.clientHeight);
  if (isTopView()) { box.min.y = box.max.y = modelBounds.min.y; }
  const topView = isTopView();
  const frame = topView ? null : cameraFrame(box, aspect, direction);
  camera = state.view !== '3d' ? orthographic : perspective;
  camera.up.set(0, 1, 0);
  controls.object = camera;
  camera.zoom = 1;
  if (topView) {
    frameTopView(camera, box, aspect);
    controls.target.copy(box.getCenter(new THREE.Vector3()));
  } else {
    controls.target.copy(frame.target);
    camera.position.copy(frame.target).addScaledVector(direction, frame.distance);
    camera.near = .01;
    if (camera.isOrthographicCamera) {
      const halfWidth = frame.halfView * aspect;
      const horizontalFlip = isCabinetElevation() && state.elevation === 'stove';
      camera.left = horizontalFlip ? halfWidth : -halfWidth;
      camera.right = horizontalFlip ? -halfWidth : halfWidth;
      camera.top = frame.halfView;
      camera.bottom = -frame.halfView;
    } else camera.aspect = aspect;
    camera.updateProjectionMatrix();
    camera.lookAt(frame.target);
  }
  controls.enableRotate = state.view === '3d';
  controls.maxPolarAngle = state.view === '3d' ? Math.PI / 2 - .025 : Math.PI / 2;
  controls.update();
  sceneEl.dataset.projection = camera.isOrthographicCamera ? 'orthographic' : 'perspective';
  labelLayoutDirty = true;
}

function setView(view) {
  if (view === 'elevation' && state.activeStep === 'countertop') return;
  state.view = view;
  applyModelPresentation();
  if (isCabinetElevation() && elevationPreviewSource) updateElevationPreview(elevationPreviewSource);
  document.querySelectorAll('[data-view]').forEach(button => {
    const selected = button.dataset.view === view;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const name = elevationLabel();
  $('#scene-mode-label').textContent = view === '3d' ? '透视 · 3D' : view === 'top' ? '正交 · 顶视' : `正交 · ${name}`;
  $('#camera-readout').textContent = view === '3d' ? '相机：透视 · 自由查看' : view === 'top' ? '相机：正交 · 顶视' : `相机：正交 · ${name}`;
  updateViewerHint();
  updateSection();
  renderAnnotations();
  frameView();
}

function renderAnnotations() {
  clearAnnotations();
  if (!state.annotations || !modelRoot.children.length) return;
  if (!state.overall && isCabinetSection() && !isTopView()) {
    renderInlineDimensions();
    return;
  }
  if (state.view === '3d') {
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x41464c, depthTest: true, depthWrite: false });
    const arrowGeometry = new THREE.ConeGeometry(1, 1, 4);
    visibleDimensions().forEach(item => {
      const a = blenderToThree(item.endpoints[0]).add(offset);
      const b = blenderToThree(item.endpoints[1]).add(offset);
      const direction = b.clone().sub(a).normalize();
      const selected = state.selected === item.id;
      const material = selected ? new THREE.LineBasicMaterial({ color: 0x0071e3, depthTest: true, depthWrite: false }) : lineMaterial;
      const arrowMaterial = new THREE.MeshBasicMaterial({ color: selected ? 0x0071e3 : 0x41464c, depthTest: true, depthWrite: false });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), material);
      line.renderOrder = 4;
      annotationRoot.add(line);
      const heads = isCabinetSection() ? dimensionArrowHeads(a, b)
        : [[a, direction], [b, direction.clone().negate()]].map(([point, facing]) => ({
          position: point.clone().addScaledVector(facing, .014), facing, length: .028, radius: .008,
        }));
      for (const { position, facing, length, radius } of heads) {
        const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
        arrow.position.copy(position);
        arrow.scale.set(radius, length, radius);
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), facing);
        arrow.renderOrder = 5;
        annotationRoot.add(arrow);
      }
      const button = document.createElement('button');
      button.className = `annotation-label${selected ? ' selected' : ''}`;
      button.type = 'button';
      button.textContent = formatMillimeters(item.value);
      button.title = `${item.label} · Blender 局部 Y 轴`;
      button.setAttribute('aria-label', `${item.label} ${formatMillimeters(item.value)}`);
      button.setAttribute('aria-pressed', String(selected));
      button.addEventListener('click', () => selectDimension(item.id));
      overlay.appendChild(button);
      labels.push({ button, item, anchor: a.clone().add(b).multiplyScalar(.5) });
    });
    labelLayoutDirty = true;
    return;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('annotation-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><marker id="dimension-arrow" markerWidth="6" markerHeight="6" refX="5.2" refY="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0.35 L 5.4 3 L 0 5.65 Z" fill="#41464c"/></marker><marker id="dimension-arrow-selected" markerWidth="6" markerHeight="6" refX="5.2" refY="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0.35 L 5.4 3 L 0 5.65 Z" fill="#0071e3"/></marker></defs>';
  if (!state.overall && isCabinetSection()) {
    svg.querySelectorAll('marker').forEach(marker => {
      marker.setAttribute('viewBox', '0 0 6 6');
      marker.setAttribute('markerWidth', '3.5');
      marker.setAttribute('markerHeight', '3.5');
      marker.setAttribute('refX', '5.4');
    });
  }
  overlay.appendChild(svg);
  const topLabelLanes = new Map();
  visibleDimensions().forEach((item, index) => {
    const a = blenderToThree(item.endpoints[0]).add(offset);
    const b = blenderToThree(item.endpoints[1]).add(offset);
    const selected = state.selected === item.id;
    const button = document.createElement('button');
    button.className = `annotation-label${selected ? ' selected' : ''}`;
    button.type = 'button';
    button.textContent = formatMillimeters(item.value);
    button.title = `${item.label} · ${item.axis} 轴${item.placement === 'reconstructed' ? ' · 标注位置按原尺寸重建' : ''}`;
    button.setAttribute('aria-label', `${item.label} ${formatMillimeters(item.value)}`);
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => selectDimension(item.id));
    overlay.appendChild(button);
    let topAnchor;
    if (isTopView() && modelBounds) {
      const midpoint = blenderToThree(item.endpoints[0]).add(blenderToThree(item.endpoints[1])).multiplyScalar(.5).add(offset);
      const perpendicular = item.axis === 'X' ? midpoint.z : midpoint.x;
      const laneKey = `${item.axis}:${Math.round(perpendicular / .16)}`;
      const lane = topLabelLanes.get(laneKey) || 0;
      topLabelLanes.set(laneKey, lane + 1);
      topAnchor = topViewLabelAnchor(item, modelBounds, offset, lane);
    }
    labels.push({ button, item, a, b, index, topAnchor });
  });
  labelLayoutDirty = true;
}

function renderInlineDimensions() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('annotation-svg');
  svg.setAttribute('aria-hidden', 'true');
  overlay.appendChild(svg);
  for (const item of visibleDimensions()) {
    const a = blenderToThree(item.endpoints[0]).add(offset);
    const b = blenderToThree(item.endpoints[1]).add(offset);
    const fixed = item.value <= .08 ? fixedDimensionGeometry(a, b, item.axis, fixedDimensionOffset(item)) : null;
    const anchor = fixed?.anchor || a.clone().add(b).multiplyScalar(.5);
    const selected = state.selected === item.id;
    const color = selected ? 0x0071e3 : new THREE.Color(dimensionColor).getHex();
    const geometry = new THREE.BufferGeometry();
    // baseline, two extension lines and two terminal ticks; long dimensions
    // use the first segment and receive their screen-space text gap below.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color, depthTest: false, depthWrite: false,
    }));
    geometry.setDrawRange(0, fixed ? 10 : 4);
    line.frustumCulled = false;
    line.renderOrder = 4;
    annotationRoot.add(line);
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('fill', selected ? '#0071e3' : '#30353a');
    svg.appendChild(arrowPath);
    const button = document.createElement('button');
    button.className = `annotation-label inline-dimension${fixed ? ` fixed-dimension axis-${item.axis.toLowerCase()}` : ''}${selected ? ' selected' : ''}`;
    button.type = 'button';
    button.textContent = formatMillimeters(item.value);
    button.title = `${item.label} · Blender 局部 Y 轴`;
    button.setAttribute('aria-label', `${item.label} ${formatMillimeters(item.value)}`);
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => selectDimension(item.id));
    overlay.appendChild(button);
    labels.push({ button, item, a, b, anchor, line, arrowPath, fixed, inline: true });
  }
  labelLayoutDirty = true;
}

// Short dimensions stay on their original measured segments. The offset map is
// retained as a compatibility hook for imported layouts, but no offset is
// applied by fixedDimensionGeometry.
function fixedDimensionOffset(item) {
  return 0;
}

function layoutInlineDimensions(project) {
  const view = viewDirection();
  const width = sceneEl.clientWidth, height = sceneEl.clientHeight;
  overlay.querySelector('.annotation-svg').setAttribute('viewBox', `0 0 ${width} ${height}`);
  // A fixed model-space text height makes labels shrink and grow with the model,
  // independent of the measured axis or the label's character count.
  const textUp = new THREE.Vector3(0, .045, 0).applyQuaternion(camera.quaternion);
  const projected = [];
  for (const entry of labels) {
    const { button, item, a, b, anchor, line, arrowPath, fixed } = entry;
    const lineA = fixed?.baselineA || a, lineB = fixed?.baselineB || b;
    const pa = project(lineA), pb = project(lineB);
    const distance = camera.isOrthographicCamera
      ? (camera.top - camera.bottom) / camera.zoom : camera.position.distanceTo(anchor);
    const bankVisible = isCabinetElevation() || state.view !== 'elevation' || anchor.x * view.x > -.08;
    const visible = pa.z >= -1 && pa.z <= 1 && pb.z >= -1 && pb.z <= 1 && bankVisible && Math.hypot(pb.x - pa.x, pb.y - pa.y) > .00001;
    button.hidden = !visible;
    line.visible = false;
    arrowPath.setAttribute('d', '');
    if (!visible) continue;
    const center = project(anchor), top = project(anchor.clone().add(textUp));
    const textScale = inlineDimensionTextScale(Math.hypot(top.x - center.x, top.y - center.y), parseFloat(getComputedStyle(button).fontSize));
    const layout = inlineDimensionLayout(pa, pb, button.offsetWidth, distance, textScale);
    projected.push({ ...layout, id: item.id, value: item.value, textWidth: button.offsetWidth, textHeight: button.offsetHeight,
      entry, pa, pb, fixed });
  }
  for (const layout of projected) {
    const { entry: { button, item, a, b, line, arrowPath, fixed }, pa, pb } = layout;
    const color = state.selected === item.id ? '#0071e3' : dimensionColor;
    line.material.color.set(color);
    arrowPath.setAttribute('fill', color);
    button.style.color = color;
    line.visible = true;
    // Fixed dimensions keep their model-space baseline and label direction;
    // only the projection changes, so camera rotation cannot move the marker
    // to a new side or attach it to a different segment.
    const angle = layout.angle * Math.PI / 180;
    const normalX = -Math.sin(angle);
    const normalY = -Math.cos(angle);
    const labelOffset = layout.labelAbove ? (button.offsetHeight * .72 + 5) : 0;
    const labelX = layout.x + normalX * labelOffset;
    const labelY = layout.y + normalY * labelOffset;
    const labelScale = fixed ? Math.max(.78, layout.textScale) : layout.textScale;
    button.style.transform = `translate(${labelX}px, ${labelY}px) translate(-50%, -50%) rotate(${layout.angle}deg) scale(${labelScale})`;
    // Only the central gap and arrow size respond to projection. Endpoints stay fixed.
    // Unproject the screen fractions so perspective does not shift the gap away from the text.
    const pointAt = fraction => new THREE.Vector3(
      THREE.MathUtils.lerp(pa.x, pb.x, fraction) / width * 2 - 1,
      1 - THREE.MathUtils.lerp(pa.y, pb.y, fraction) / height * 2,
      THREE.MathUtils.lerp(pa.z, pb.z, fraction),
    ).unproject(camera);
    const positions = line.geometry.attributes.position;
    if (fixed) {
      const points = [fixed.baselineA, fixed.baselineB,
        fixed.extensionA[0], fixed.extensionA[1], fixed.extensionB[0], fixed.extensionB[1],
        fixed.capA[0], fixed.capA[1], fixed.capB[0], fixed.capB[1]];
      points.forEach((point, index) => positions.setXYZ(index, point.x, point.y, point.z));
      positions.needsUpdate = true;
      // Short dimensions use the same screen-space arrows as the other
      // dimensions. Moving the label above the line never creates a leader.
      arrowPath.setAttribute('d', dimensionArrowTriangles(pa, pb, layout.arrowPixels)
        .map(points => `M ${points.map(point => `${point.x},${point.y}`).join(' L ')} Z`).join(' '));
      continue;
    }
    const gap = layout.gapFraction;
    const left = pointAt(.5 - gap);
    const right = pointAt(.5 + gap);
    [a, left, right, b].forEach((point, index) => positions.setXYZ(index, point.x, point.y, point.z));
    positions.needsUpdate = true;
    arrowPath.setAttribute('d', dimensionArrowTriangles(pa, pb, layout.arrowPixels)
      .map(points => `M ${points.map(point => `${point.x},${point.y}`).join(' L ')} Z`).join(' '));
  }
}

function layoutLabels() {
  labelLayoutDirty = false;
  const width = sceneEl.clientWidth, height = sceneEl.clientHeight, placed = [];
  camera.updateMatrixWorld();
  const project = point => {
    const projected = point.clone().project(camera);
    return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2, z: projected.z };
  };
  if (labels[0]?.inline) {
    layoutInlineDimensions(project);
    return;
  }
  if (state.view === '3d') {
    for (const { button, anchor } of labels) {
      const point = project(anchor);
      button.hidden = point.z < -1 || point.z > 1;
      if (button.hidden) continue;
      const x = THREE.MathUtils.clamp(point.x - button.offsetWidth / 2, 4, Math.max(4, width - button.offsetWidth - 4));
      const y = THREE.MathUtils.clamp(point.y - button.offsetHeight - 7, 30, Math.max(30, height - button.offsetHeight - 4));
      button.style.transform = `translate(${x}px, ${y}px)`;
    }
    return;
  }
  const svg = overlay.querySelector('.annotation-svg');
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.querySelectorAll('.dimension-drawing').forEach(node => node.remove());
  const view = viewDirection();
  const modelScreen = [];
  if (modelBounds) for (const x of [modelBounds.min.x, modelBounds.max.x]) for (const y of [modelBounds.min.y, modelBounds.max.y]) for (const z of [modelBounds.min.z, modelBounds.max.z]) modelScreen.push(project(new THREE.Vector3(x, y, z)));
  const bounds = modelScreen.length ? { left: Math.min(...modelScreen.map(p => p.x)), right: Math.max(...modelScreen.map(p => p.x)), top: Math.min(...modelScreen.map(p => p.y)), bottom: Math.max(...modelScreen.map(p => p.y)) } : { left: 8, right: width - 8, top: 8, bottom: height - 8 };
  const horizontal = [], vertical = [];
  for (const entry of labels) {
    const { button, item, a, b } = entry;
    const pa = project(a), pb = project(b);
    const length = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const center = a.clone().add(b).multiplyScalar(.5);
    const bankVisible = isCabinetElevation() || state.view !== 'elevation' || center.x * view.x > -.08;
    const edgeOn = length < 9 || (state.view === 'elevation' && !isCabinetElevation() && item.axis === 'Y');
    button.hidden = pa.z < -1 || pa.z > 1 || pb.z < -1 || pb.z > 1 || edgeOn || !bankVisible;
    if (button.hidden) continue;
    const data = { ...entry, pa, pb, length };
    const isVertical = Math.abs(pb.y - pa.y) > Math.abs(pb.x - pa.x) * 1.35;
    (isVertical ? vertical : horizontal).push(data);
  }
  const draw = (entry, p1, p2, selected) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.classList.add('dimension-drawing');
    if (selected) line.classList.add('selected');
    line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y); line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
    const marker = selected ? 'url(#dimension-arrow-selected)' : 'url(#dimension-arrow)';
    line.setAttribute('marker-start', marker); line.setAttribute('marker-end', marker);
    svg.appendChild(line);
    return line;
  };
  horizontal.sort((a, b) => a.pa.y - b.pa.y);
  vertical.sort((a, b) => a.pa.x - b.pa.x);
  if (isTopView()) {
    for (const entry of [...horizontal, ...vertical]) {
      const { button, item, pa, pb } = entry;
      const selected = state.selected === item.id;
      const point = project(entry.topAnchor || entry.a.clone().add(entry.b).multiplyScalar(.5));
      button.hidden = point.z < -1 || point.z > 1;
      if (button.hidden) continue;
      const labelX = THREE.MathUtils.clamp(point.x - button.offsetWidth / 2, 4, Math.max(4, width - button.offsetWidth - 4));
      const labelY = THREE.MathUtils.clamp(point.y - button.offsetHeight / 2, 24, Math.max(24, height - button.offsetHeight - 4));
      button.style.transform = `translate(${labelX}px, ${labelY}px)`;
      draw(entry, pa, pb, selected);
      const anchor = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      if (Math.hypot(anchor.x - point.x, anchor.y - point.y) > 10) {
        const dx = anchor.x - point.x, dy = anchor.y - point.y;
        const halfWidth = button.offsetWidth / 2, halfHeight = button.offsetHeight / 2;
        const scale = Math.min(halfWidth / Math.max(Math.abs(dx), .001),
          halfHeight / Math.max(Math.abs(dy), .001), 1);
        const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        leader.classList.add('dimension-drawing', 'extension');
        leader.setAttribute('x1', anchor.x);
        leader.setAttribute('y1', anchor.y);
        leader.setAttribute('x2', point.x + dx * scale);
        leader.setAttribute('y2', point.y + dy * scale);
        svg.appendChild(leader);
      }
    }
    return;
  }
  horizontal.forEach((entry, lane) => {
    const { button, pa, pb, item } = entry, selected = state.selected === item.id;
    let y = state.view === 'elevation' ? Math.max(bounds.bottom + 18 + lane * 19, Math.max(pa.y, pb.y) + 16) : (pa.y + pb.y) / 2;
    y = THREE.MathUtils.clamp(y, 16, height - 16);
    const p1 = { x: pa.x, y }, p2 = { x: pb.x, y };
    if (state.view === 'elevation') { for (const p of [pa, pb]) { const ext = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ext.classList.add('dimension-drawing', 'extension'); ext.setAttribute('x1', p.x); ext.setAttribute('y1', p.y); ext.setAttribute('x2', p.x); ext.setAttribute('y2', y); svg.appendChild(ext); } }
    draw(entry, p1, p2, selected);
    const w = button.offsetWidth || 105, h = button.offsetHeight || 27;
    const x = THREE.MathUtils.clamp((p1.x + p2.x) / 2 - w / 2, 6, Math.max(6, width - w - 6));
    const desiredY = THREE.MathUtils.clamp(y - h - 5, 30, Math.max(30, height - h - 5));
    let labelY = desiredY;
    const overlaps = top => placed.some(rect => x < rect.x + rect.w + 4 && x + w + 4 > rect.x && top < rect.y + rect.h + 4 && top + h + 4 > rect.y);
    for (let step = 0; overlaps(labelY) && step < 20; step++) {
      const delta = (Math.floor(step / 2) + 1) * (h + 5) * (step % 2 ? -1 : 1);
      labelY = THREE.MathUtils.clamp(desiredY + delta, 48, Math.max(48, height - h - 8));
    }
    button.style.transform = `translate(${x}px, ${labelY}px)`;
    placed.push({ x, y: labelY, w, h });
  });
  vertical.forEach((entry, lane) => {
    const { button, pa, pb, item } = entry, selected = state.selected === item.id;
    const right = (pa.x + pb.x) / 2 < (bounds.left + bounds.right) / 2;
    let x = right ? bounds.right + 18 + lane * 19 : bounds.left - 18 - lane * 19;
    x = THREE.MathUtils.clamp(x, 16, width - 16);
    const p1 = { x, y: pa.y }, p2 = { x, y: pb.y };
    if (state.view === 'elevation') for (const p of [pa, pb]) { const ext = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ext.classList.add('dimension-drawing', 'extension'); ext.setAttribute('x1', p.x); ext.setAttribute('y1', p.y); ext.setAttribute('x2', x); ext.setAttribute('y2', p.y); svg.appendChild(ext); }
    draw(entry, p1, p2, selected);
    const w = button.offsetWidth || 105, h = button.offsetHeight || 27;
    const lx = THREE.MathUtils.clamp(x + (right ? 5 : -w - 5), 6, Math.max(6, width - w - 6));
    const desiredY = THREE.MathUtils.clamp((p1.y + p2.y) / 2 - h / 2, 30, Math.max(30, height - h - 6));
    let labelY = desiredY;
    const overlaps = top => placed.some(rect => lx < rect.x + rect.w + 4 && lx + w + 4 > rect.x && top < rect.y + rect.h + 4 && top + h + 4 > rect.y);
    for (let step = 0; overlaps(labelY) && step < 20; step++) {
      const delta = (Math.floor(step / 2) + 1) * (h + 5) * (step % 2 ? -1 : 1);
      labelY = THREE.MathUtils.clamp(desiredY + delta, 30, Math.max(30, height - h - 6));
    }
    button.style.transform = `translate(${lx}px, ${labelY}px)`;
    placed.push({ x: lx, y: labelY, w, h });
  });
}

function selectDimension(id) {
  state.selected = state.selected === id ? null : id;
  renderAnnotations();
}

function renderNav() {
  const activeIndex = steps.findIndex(step => step.id === state.activeStep);
  $('#nav-count').textContent = `${String(activeIndex + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`;
  $('#step-list').replaceChildren(...steps.map((step, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `step-item${step.id === state.activeStep ? ' active' : ''}`;
    button.dataset.step = step.id;
    if (step.id === state.activeStep) button.setAttribute('aria-current', 'step');
    button.innerHTML = `<span class="step-number">${String(index + 1).padStart(2, '0')}</span><span><span class="step-name">${step.name}</span><small class="step-sub">${step.sub}</small></span>`;
    button.addEventListener('click', () => { void setStep(step.id); });
    return button;
  }));
}

async function setStep(id) {
  tapFocusAnimation = null;
  const version = ++requestVersion;
  state.activeStep = id;
  if (id === 'wallCabinet' && state.elevation === 'window') state.elevation = 'stove';
  state.overall = false;
  if (id === 'countertop' && state.view === 'elevation') state.view = '3d';
  state.selected = null;
  const step = steps.find(entry => entry.id === id);
  $('#active-title').textContent = step.name;
  $('#loading-label').textContent = step.name;
  loadingEl.hidden = false;
  errorEl.hidden = true;
  sceneEl.setAttribute('aria-busy', 'true');
  delete sceneEl.dataset.loadedStep;
  modelRoot.clear();
  modelBounds = null;
  fullModelBounds = null;
  applyModelPresentation();
  clearAnnotations();
  renderNav();
  try {
    if (!renderer) throw new Error('当前设备未能初始化 WebGL，请使用支持硬件加速的浏览器重试。');
    // Every export uses this common offset, preserving physical heights and annotation alignment.
    if (!referenceBox) {
      const reference = await loadModel(steps[0]);
      if (version !== requestVersion) return;
      referenceModelSource = reference;
      referenceBox = new THREE.Box3().setFromObject(reference);
      offset = centeredOffset(referenceBox);
    }
    const model = await loadModel(step);
    if (version !== requestVersion) return;
    model.traverse(child => {
      if (!child.isMesh) return;
      const materials = (Array.isArray(child.material) ? child.material : [child.material])
        .map(material => material.clone());
      child.material = Array.isArray(child.material) ? materials : materials[0];
    });
    togglePanelEdges(model, state.edgeLines);
    if (id === 'cabinetBody' || id === 'wallCabinet') {
      prepareCabinetElevations(model, id);
    }
    const panelEdgeObjects = new Set();
    model.traverse(child => { if (child.userData.panelEdgeLine) panelEdgeObjects.add(child.userData.panelEdgeSource); });
    sceneEl.dataset.panelEdgeObjects = JSON.stringify([...panelEdgeObjects]);
    const wrapper = new THREE.Group();
    wrapper.position.copy(offset);
    wrapper.add(model);
    modelRoot.add(wrapper);
    fullModelBounds = new THREE.Box3().setFromObject(wrapper);
    if (id === 'cabinetBody' || id === 'wallCabinet') {
      if (!referenceModelSource) referenceModelSource = await loadModel(steps[0]);
      if (version !== requestVersion) return;
      addElevationWalls(model, referenceModelSource);
      updateElevationPreview(model);
    }
    applyModelPresentation();
    updateSection();
    renderAnnotations();
    frameView();
    loadingEl.hidden = true;
    sceneEl.dataset.loadedStep = id;
    sceneEl.setAttribute('aria-busy', 'false');
  } catch (error) { if (version === requestVersion) showError(error); }
}

function setElevation(region) {
  if (!cabinetElevations[region]) return;
  state.elevation = region;
  state.selected = null;
  setView('elevation');
}

function setupEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    setView(button.dataset.view);
  }));
  $('#elevation-select').addEventListener('change', event => setElevation(event.currentTarget.value));
  $('#reset-view').addEventListener('click', frameView);
  $('#retry-model').addEventListener('click', () => {
    if (!renderer) { location.reload(); return; }
    if (!state.dimensions.length) { void boot(); return; }
    void setStep(state.activeStep);
  });
  $('#section-toggle').addEventListener('click', () => { state.section = !state.section; updateSection(); });
  $('#edge-toggle').addEventListener('click', event => {
    if (isCabinetElevation()) return;
    state.edgeLines = !state.edgeLines;
    event.currentTarget.setAttribute('aria-pressed', String(state.edgeLines));
    togglePanelEdges(modelRoot, state.edgeLines);
  });
  $('#annotation-switch').addEventListener('change', event => {
    state.annotations = event.target.checked;
    renderAnnotations();
  });
}

async function boot() {
  try {
    const response = await fetch('./public/dimensions.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`读取尺寸失败（HTTP ${response.status}）`);
    const text = await response.text();
    state.dimensions = validateDimensions(JSON.parse(text.replace(/^\uFEFF/, '')));
    try {
      const manifestResponse = await fetch('./public/manifest.json', { cache: 'no-store' });
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        const when = manifest.exportedAt ? new Date(manifest.exportedAt) : null;
        if (when && !Number.isNaN(when.valueOf())) $('#source-date').textContent = `Blender · ${when.toLocaleString('zh-CN', { hour12: false })}`;
        window.__MODEL_CACHE_VERSION__ = manifest.exportedAt || '';
      }
    } catch { /* manifest is optional for older exports */ }
    await setStep(state.activeStep);
  } catch (error) { showError(error); }
}

setupEvents();
try { setupScene(); } catch (error) { showError(error); }
void boot();
