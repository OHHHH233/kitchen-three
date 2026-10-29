import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {bindTapToZoom,tapFocusFrame} from './tap-zoom.js?v=20261021-mobile-tap1';
import {mm,areaM2,drawingBounds,scheduleCsv,dimensionVisible,validateSection,keepNearAxisDimensions} from './v2-math.js?v=20261029-integer-dimensions1';
import {dedupeTopViewDimensions} from './scene-math.js?v=20261028-inline-dim14';
import {surfaceDepth,outlineMaterial,fitDepthRange} from './render-depth.js?v=20261028-depth4';
import {tilePresentation,TILE_FOCUS_OBJECT} from './tile-presentation.js?v=20261028-dimlabels14';
import {tileUV,gradientTexture,TILE_COLORS,CEILING_COLORS} from './tile-gradient.js?v=20261028-dimlabels14';
import {cabinetMaterial,studioEnvironment} from './cabinet-materials.js?v=20261028-doors13';

const $=s=>document.querySelector(s), ns='http://www.w3.org/2000/svg';
const state={section:1,cabinetVisible:true,wallCabinetVisible:true,cabinetDimensions:true,wallCabinetDimensions:true,cabinetDoorsVisible:false,wallCabinetDoorsVisible:false,cabinetTransparency:70,view:'3d',perspectivePreset:null,direction:'front',edges:true,dimensions:true,tileFocus:true,ceilingVisible:false,contextTransparency:75,baseTransparency:75,tileTransparency:100,selectedRuler:null,selectedTile:null,surface:null};
let data,section1Dimensions,renderer,controls,camera,model,modelBounds,cameraPresets={},offset,previewRenderer,previewCamera;
const scene=new THREE.Scene(),root=new THREE.Group(),tileRoot=new THREE.Group();
scene.background=new THREE.Color(0xf5f7fa);scene.add(root,tileRoot);
const perspective=new THREE.PerspectiveCamera(42,1,.01,250),ortho=new THREE.OrthographicCamera(-5,5,5,-5,.01,250);
const raycaster=new THREE.Raycaster();let layoutDirty=true,focus=null,labels=[],lineSvg,meshEntries=[],edgeEntries=[];
const mobile=matchMedia('(max-width:650px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
function element(tag,attrs={}){const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
function toThree(p){return new THREE.Vector3(p[0],p[2],-p[1]).add(offset||new THREE.Vector3());}
function saveFile(text,type,name){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function currentSurface(){return data.surfaces.find(s=>s.id===state.surface)||data.surfaces[0];}
function selectedTile(){return currentSurface().tiles.find(t=>t.id===state.selectedTile)||currentSurface().tiles[0];}
function sourceName(object){for(let o=object;o;o=o.parent){const name=o.userData.name||o.name;if(data.objects.includes(name))return name;}return object.name;}
function sectionDimensions(section){return section===1?section1Dimensions:[...data.section2.dimensions.map(d=>({...d,zone:'cabinet'})),...data.section3.dimensions.map(d=>({...d,zone:'wall-cabinet'}))];}
function visibleDimensions(){return data.dimensions.filter(d=>state.section===1||(d.zone==='cabinet'?state.cabinetDimensions:state.wallCabinetDimensions));}

async function setupModel(){
  const host=$('#model-canvas');
  $('#space-controls').append($('.model-options'),$('.view-controls'));
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
  host.replaceChildren(renderer.domElement);camera=perspective;
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=.7;controls.maxDistance=50;controls.minZoom=.35;controls.maxZoom=10;
  controls.addEventListener('change',()=>{layoutDirty=true;});
  scene.environment=studioEnvironment(renderer);
  scene.add(new THREE.HemisphereLight(0xf8fbff,0xa2afbe,2.7));const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(-5,10,-7);scene.add(key);const fill=new THREE.DirectionalLight(0xdceaff,1.4);fill.position.set(6,5,4);scene.add(fill);
  const gltf=await new GLTFLoader().loadAsync(`./public/v2/${data.modelFile}?v=${encodeURIComponent(data.exportedAt)}`);
  model=gltf.scene;model.updateMatrixWorld(true);const rawBounds=new THREE.Box3().setFromObject(model);
  const center=rawBounds.getCenter(new THREE.Vector3());offset=new THREE.Vector3(-center.x,-rawBounds.min.y,-center.z);model.position.add(offset);root.add(model);model.updateMatrixWorld(true);modelBounds=new THREE.Box3().setFromObject(model);
  cameraPresets={};
  for(const name of ['Camera_01','Camera_02']){
    const authoredCamera=model.getObjectByName(name);
    if(!authoredCamera?.isPerspectiveCamera)throw new Error(`${name} 摄影机未包含在模型文件中`);
    authoredCamera.updateWorldMatrix(true,false);
    const cameraPosition=authoredCamera.getWorldPosition(new THREE.Vector3());
    const cameraDirection=authoredCamera.getWorldDirection(new THREE.Vector3()).normalize();
    const cameraTarget=modelBounds.getCenter(new THREE.Vector3());
    cameraTarget.copy(cameraPosition).addScaledVector(cameraDirection,Math.max(cameraPosition.distanceTo(cameraTarget),1));
    cameraPresets[name]={position:cameraPosition,quaternion:authoredCamera.getWorldQuaternion(new THREE.Quaternion()),target:cameraTarget,fov:authoredCamera.fov};
  }
  model.traverse(o=>{
    if(!o.isMesh)return;const name=sourceName(o);o.userData.section=data.section3Objects.includes(name)?3:data.section2Objects.includes(name)?2:1;o.userData.cabinetZone=o.userData.section===2?'cabinet':o.userData.section===3?'wall-cabinet':null;o.userData.cabinetDoor=(data.section2Objects.includes(name)&&name.includes('橱柜柜门'))||(data.section3Objects.includes(name)&&name.includes('吊柜柜门'));const stair=name.includes('楼梯'),rank=Math.max(0,data.objects.indexOf(name));
    o.material=(Array.isArray(o.material)?o.material:[o.material]).map(original=>o.userData.section>1?cabinetMaterial(original,rank,data.objects.length):new THREE.MeshStandardMaterial({
      color:stair?0xc4cfdb:0xe5e9ed,roughness:.85,side:THREE.DoubleSide,
      ...surfaceDepth('hard',rank,data.objects.length),forceSinglePass:true}));
    o.renderOrder=rank;
    if(o.material.length===1)o.material=o.material[0];
    meshEntries.push({mesh:o,name,materials:Array.isArray(o.material)?o.material:[o.material]});
  });
  for(const entry of meshEntries){const edge=new THREE.LineSegments(new THREE.EdgesGeometry(entry.mesh.geometry,15),outlineMaterial(0x75808e));edge.renderOrder=200;entry.mesh.add(edge);edgeEntries.push(edge);}
  addTileGeometry();
  bindTapToZoom(renderer.domElement,event=>{
    const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
    const hits=raycaster.intersectObjects([...meshEntries.map(e=>e.mesh),...tileRoot.children],true).filter(h=>h.object.isMesh&&h.object.visible);
    const hit=(state.section>1?hits.find(h=>h.object.userData.section===state.section):state.view==='3d'&&state.tileFocus?hits.find(h=>h.object.userData.sourceObject===TILE_FOCUS_OBJECT):null)||hits[0];
    if(!hit)return;const end=tapFocusFrame(camera,controls.target,hit.point,{minDistance:controls.minDistance,maxZoom:controls.maxZoom});focus={start:performance.now(),position:camera.position.clone(),target:controls.target.clone(),zoom:camera.zoom,end};
    host.dataset.tapZoomCount=String(Number(host.dataset.tapZoomCount||0)+1);
  },{isEnabled:e=>e.pointerType==='touch'||e.pointerType==='pen'||mobile.matches,onStart:()=>focus=null});
  renderer.domElement.addEventListener('wheel',()=>focus=null,{passive:true});
  new ResizeObserver(()=>resizeModel()).observe(host);resizeModel();applyPresentation();renderModelLabels();frameCamera();updateThumbnail();
  $('#model-loading').hidden=true;host.dataset.loaded='section'+state.section;
  renderer.setAnimationLoop(()=>{
    if(focus){const t=reduced.matches?1:Math.min(1,(performance.now()-focus.start)/260),e=1-(1-t)**3;camera.position.lerpVectors(focus.position,focus.end.position,e);controls.target.lerpVectors(focus.target,focus.end.target,e);camera.zoom=THREE.MathUtils.lerp(focus.zoom,focus.end.zoom,e);camera.updateProjectionMatrix();layoutDirty=true;if(t===1)focus=null;}
    controls.update();fitDepthRange(camera,modelBounds);renderer.render(scene,camera);if(layoutDirty)layoutModelLabels();
  });
}

function addTileGeometry(){
  const textures={tile:gradientTexture(TILE_COLORS),ceiling:gradientTexture(CEILING_COLORS)};
  for(const s of data.surfaces)for(const tile of s.tiles){
    const points=tile.points.map(toThree);const indices=THREE.ShapeUtils.triangulateShape(tile.polygon.map(p=>new THREE.Vector2(...p)),[]).flat();
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(tileUV(tile.polygon),2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,toneMapped:false,map:s.kind==='ceiling'?textures.ceiling:textures.tile,...surfaceDepth('tile')}));mesh.renderOrder=100;
    mesh.userData.gradientMap=s.kind==='ceiling'?textures.ceiling:textures.tile;
    Object.assign(mesh.userData,{tileId:tile.id,kind:s.kind,sourceObject:tile.sourceObject||s.sourceObject});tileRoot.add(mesh);
    const outline=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),outlineMaterial(0xa3b1c0,'tile'));outline.userData.tileOutline=true;outline.renderOrder=210;mesh.add(outline);
  }
}
function viewDirection(){return new THREE.Vector3(...(state.view==='top'?[0,1,0]:state.view==='3d'?[1.15,.95,-1.45]:({front:[0,0,-1],back:[0,0,1],left:[-1,0,0],right:[1,0,0]})[state.direction])).normalize();}
function applyPresentation(){
  const top=state.view==='top',focus=state.view==='3d'&&state.tileFocus;
  const context=state.section>1,transparency=context?state.baseTransparency:state.contextTransparency;
  const baseStyle=tilePresentation({view:context?'3d':state.view,focus:context||state.tileFocus,contextTransparency:transparency,kind:'hard'});
  for(const entry of meshEntries){
    const zone=entry.mesh.userData.cabinetZone;
    const zoneVisible=zone==='cabinet'?state.cabinetVisible:zone==='wall-cabinet'?state.wallCabinetVisible:true;
    const doorsVisible=zone==='cabinet'?state.cabinetDoorsVisible:zone==='wall-cabinet'?state.wallCabinetDoorsVisible:true;
    entry.mesh.visible=(entry.mesh.userData.section===1||context&&zoneVisible)&&(!entry.mesh.userData.cabinetDoor||doorsVisible);
    const foreground=Boolean(zone)&&context;
    const cabinetOpacity=1-state.cabinetTransparency/100;
    const style=foreground?{color:0xc5d6e9,opacity:cabinetOpacity,transparent:cabinetOpacity<1,depthWrite:cabinetOpacity===1}:context?baseStyle:tilePresentation({view:state.view,focus:state.tileFocus,contextTransparency:state.contextTransparency,kind:'hard',door:entry.name.includes('门')});
    const materials=entry.materials;for(const m of materials){m.color.setHex(!focus&&entry.name.includes('楼梯')?0xc4cfdb:style.color);m.opacity=style.opacity;m.transparent=style.transparent;m.depthWrite=style.depthWrite;m.needsUpdate=true;}
  }
  const contextStyle=baseStyle;
  edgeEntries.forEach(edge=>{const foreground=edge.parent.userData.section===state.section&&state.section>1;const style=foreground?{edgeOpacity:1}:contextStyle;edge.visible=state.edges;edge.material.transparent=style.edgeOpacity<1;edge.material.opacity=style.edgeOpacity;edge.renderOrder=foreground?210:400;edge.material.needsUpdate=true;});
  for(const mesh of tileRoot.children){const style=tilePresentation({view:state.view,focus:state.tileFocus,contextTransparency:state.contextTransparency,tileTransparency:state.tileTransparency,kind:mesh.userData.kind,sourceObject:mesh.userData.sourceObject});
    mesh.visible=!context&&(mesh.userData.kind==='ceiling'?state.view==='3d'&&state.ceilingVisible:mesh.userData.kind==='floor'||(!top&&state.view==='3d'));
    const m=mesh.material;m.map=state.view==='3d'?mesh.userData.gradientMap:null;m.color.setHex(style.color);m.opacity=style.opacity;m.transparent=style.transparent;m.depthWrite=style.depthWrite;m.forceSinglePass=true;m.needsUpdate=true;
    mesh.children.forEach(e=>{e.visible=state.edges;e.material.color.setHex(style.edgeColor);e.material.opacity=style.edgeOpacity;e.material.transparent=style.edgeOpacity<1;e.material.needsUpdate=true;e.renderOrder=style.target?210:focus?400:210;});
  }
  $('#tile-focus-toggle').disabled=state.view!=='3d';$('#tile-focus-toggle').setAttribute('aria-pressed',state.tileFocus);$('#model-canvas').dataset.tileFocus=String(focus);
  $('#ceiling-toggle').disabled=state.view!=='3d';$('#ceiling-toggle').setAttribute('aria-pressed',state.ceilingVisible);$('#model-canvas').dataset.ceilingVisible=String(state.view==='3d'&&state.ceilingVisible);
  $('#tile-transparency').disabled=state.view!=='3d';$('#tile-transparency-control').classList.toggle('disabled',state.view!=='3d');
  $('#tile-transparency').value=state.tileTransparency;$('#tile-transparency-value').value=state.tileTransparency+'%';$('#tile-transparency').setAttribute('aria-valuetext',state.tileTransparency+'% 透明');
  $('#context-transparency').disabled=!context&&!focus;$('#context-transparency-control').classList.toggle('disabled',!context&&!focus);
  $('#context-transparency').value=transparency;$('#context-transparency-value').value=transparency+'%';$('#context-transparency').setAttribute('aria-valuetext',transparency+'% 透明');
  $('#global-dimension-control').hidden=context;
  $('#cabinet-controls').hidden=!context;$('.model-options').classList.toggle('section2',context);
  for(const [id,visible] of [['cabinet-visible',state.cabinetVisible],['cabinet-dimensions',state.cabinetDimensions],['cabinet-doors',state.cabinetDoorsVisible],['wall-cabinet-visible',state.wallCabinetVisible],['wall-cabinet-dimensions',state.wallCabinetDimensions],['wall-cabinet-doors',state.wallCabinetDoorsVisible]])$('#'+id).checked=visible;
  $('#cabinet-transparency').value=state.cabinetTransparency;$('#cabinet-transparency-value').value=state.cabinetTransparency+'%';$('#cabinet-transparency').setAttribute('aria-valuetext',state.cabinetTransparency+'% 透明');
  $('#model-canvas').dataset.doorsVisible=String(state.cabinetDoorsVisible||state.wallCabinetDoorsVisible);
  $('#model-canvas').dataset.cabinetTransparency=String(state.cabinetTransparency);
  $('#edges-toggle').setAttribute('aria-pressed',state.edges);
  $('#direction').hidden=state.view!=='elevation';$('#model-thumbnail').hidden=state.view!=='elevation';
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===state.view&&!(button.dataset.view==='3d'&&state.perspectivePreset);button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  const presetActive=state.view==='3d'&&Boolean(state.perspectivePreset);$('#camera-preset-toggle').classList.toggle('active',presetActive&&state.perspectivePreset==='Camera_01');$('#camera-preset-toggle').setAttribute('aria-pressed',presetActive&&state.perspectivePreset==='Camera_01');$('#camera-preset-2-toggle').classList.toggle('active',presetActive&&state.perspectivePreset==='Camera_02');$('#camera-preset-2-toggle').setAttribute('aria-pressed',presetActive&&state.perspectivePreset==='Camera_02');
  const directionName=$('#direction').selectedOptions[0].textContent;
  $('#mode-label').textContent=state.view==='3d'?(state.perspectivePreset==='Camera_02'?'透视视角二':state.perspectivePreset==='Camera_01'?'透视视角':context?'透视 · 橱柜吊柜区':focus?'透视 · 铺贴突出显示':'透视 · 3D'):state.view==='top'?'正交 · 顶视':`正交 · ${directionName}`;
  const visibleBase=new Set(meshEntries.filter(e=>e.mesh.visible&&e.mesh.userData.section===1).map(e=>e.name));const visibleCabinets=new Set(meshEntries.filter(e=>e.mesh.visible&&e.mesh.userData.section>1).map(e=>e.name));
  $('#model-canvas').dataset.view=state.view;$('#model-canvas').dataset.section=String(state.section);$('#model-canvas').dataset.visibleBase=String(visibleBase.size);$('#model-canvas').dataset.visibleCabinets=String(visibleCabinets.size);$('#model-canvas').dataset.loaded='section'+state.section;
  $('#model-hint').textContent=state.view==='3d'?'拖拽旋转 · 滚轮缩放 · 右键平移 · 手机轻点放大':'滚轮缩放 · 右键平移 · 手机轻点放大';
}
function resizeModel(){if(!renderer||!modelBounds)return;const host=$('#model-canvas');if(!host.clientWidth||!host.clientHeight)return;renderer.setSize(host.clientWidth,host.clientHeight,false);frameCamera();updateThumbnail();}
function frameCamera(){
  if(!modelBounds)return;focus=null;const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
  const host=$('#model-canvas');if(!host.clientWidth||!host.clientHeight)return;
  const aspect=host.clientWidth/host.clientHeight;
  const cameraPreset=cameraPresets[state.perspectivePreset];
  if(state.view==='3d'&&cameraPreset){
    camera=perspective;controls.object=perspective;perspective.fov=cameraPreset.fov;perspective.aspect=aspect;perspective.position.copy(cameraPreset.position);perspective.quaternion.copy(cameraPreset.quaternion);perspective.updateProjectionMatrix();controls.target.copy(cameraPreset.target);controls.enableRotate=true;controls.maxPolarAngle=Math.PI/2-.01;controls.update();placeModelLabels();layoutDirty=true;return;
  }
  const box=modelBounds.clone(),fitPoints=[];
  if(state.view==='3d'){
    box.makeEmpty();
    for(const entry of meshEntries){if(!entry.mesh.visible||(state.section>1&&entry.mesh.userData.section===1))continue;const bounds=new THREE.Box3().setFromObject(entry.mesh);if(bounds.isEmpty())continue;
      box.union(bounds);for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])fitPoints.push(new THREE.Vector3(x,y,z));
    }
    for(const mesh of tileRoot.children)if(mesh.visible){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i);fitPoints.push(v);box.expandByPoint(v);}}
  }
  if(state.section>1&&state.view!=='3d'){box.makeEmpty();for(const entry of meshEntries)if(entry.mesh.userData.section>1&&entry.mesh.visible)box.union(new THREE.Box3().setFromObject(entry.mesh));}
  if((state.section>1||state.dimensions))for(const d of visibleDimensions().filter(d=>dimensionVisible(d,state.view,state.direction)))for(const p of d.endpoints){const v=toThree(p);box.expandByPoint(v);fitPoints.push(v);}
  const target=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),dir=viewDirection();camera=state.view==='3d'?perspective:ortho;controls.object=camera;camera.zoom=1;
  camera.up.set(0,1,0);if(state.view==='top')camera.up.set(0,0,-1);
  if(camera.isPerspectiveCamera){camera.aspect=aspect;const right=new THREE.Vector3().crossVectors(camera.up,dir).normalize(),up=new THREE.Vector3().crossVectors(dir,right),tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let distance=1;
    for(const point of fitPoints){const v=point.clone().sub(target);distance=Math.max(distance,v.dot(dir)+Math.max(Math.abs(v.dot(up))/tan,Math.abs(v.dot(right))/(tan*aspect))*1.18);}
    camera.position.copy(target).addScaledVector(dir,distance);
  }
  else{const horizontal=state.view==='top'?size.x:['left','right'].includes(state.direction)?size.z:size.x;const vertical=state.view==='top'?size.z:size.y;const half=Math.max(vertical/2,horizontal/(2*aspect))*(mobile.matches?1.42:1.25);camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.position.copy(target).addScaledVector(dir,size.length()+5);}
  camera.updateProjectionMatrix();camera.lookAt(target);controls.target.copy(target);controls.enableRotate=state.view==='3d';controls.maxPolarAngle=state.view==='3d'?Math.PI/2-.01:Math.PI;controls.update();placeModelLabels();layoutDirty=true;
}
function setView(view){state.view=view;state.perspectivePreset=null;applyPresentation();renderModelLabels();frameCamera();}
function setPerspectiveView(){setPerspectivePreset('Camera_01');}
function setPerspectiveView2(){setPerspectivePreset('Camera_02');}
function setPerspectivePreset(name){
  state.view='3d';state.perspectivePreset=name;
  if(name==='Camera_02'){
    state.cabinetVisible=false;state.cabinetDimensions=false;state.cabinetDoorsVisible=false;
    state.wallCabinetVisible=true;state.wallCabinetDimensions=true;state.wallCabinetDoorsVisible=false;
  }else{
    state.cabinetVisible=true;state.cabinetDimensions=true;state.cabinetDoorsVisible=false;
    state.wallCabinetVisible=false;state.wallCabinetDimensions=false;state.wallCabinetDoorsVisible=false;
  }
  applyPresentation();renderModelLabels();frameCamera();
}

function renderModelLabels(){
  const host=$('#model-annotations');host.replaceChildren();labels=[];lineSvg=element('svg',{'aria-hidden':'true'});host.append(lineSvg);if(state.section===1&&!state.dimensions)return;
  const sourceDimensions=state.section===1?data.dimensions:visibleDimensions();
  const cameraPreset=cameraPresets[state.perspectivePreset];
  const cameraForward=cameraPreset?.target.clone().sub(cameraPreset.position).normalize();
  const cameraDimensions=cameraPreset&&cameraForward?keepNearAxisDimensions(sourceDimensions,'Z',d=>{
    const midpoint=toThree(d.endpoints[0]).add(toThree(d.endpoints[1])).multiplyScalar(.5);
    return midpoint.sub(cameraPreset.position).dot(cameraForward);
  },.6):sourceDimensions;
  const dimensions=state.view==='top'?dedupeTopViewDimensions(cameraDimensions):cameraDimensions.filter(d=>dimensionVisible(d,state.view,state.direction));
  for(const d of dimensions){
    const label=document.createElement('span');label.className='model-label'+(d.value<.1?' short-dimension':'')+(state.selectedRuler===d.id?' selected':'');label.textContent=mm(d.value*1000)+' mm';label.setAttribute('aria-label',d.id+' '+label.textContent);label.title=d.id;host.append(label);
    labels.push({d,button:label,a:toThree(d.endpoints[0]),b:toThree(d.endpoints[1])});
  }if(camera&&modelBounds)placeModelLabels();layoutDirty=true;
}
function placeModelLabels(){
  if(!camera||!labels.length)return;camera.updateMatrixWorld();
  const host=$('#model-canvas'),width=host.clientWidth,height=host.clientHeight;
  if(!width||!height)return;
  for(const entry of labels){entry.mergedInto=null;entry.button.hidden=false;entry.button.textContent=mm(entry.d.value*1000)+' mm';entry.button.title=entry.d.id;entry.button.setAttribute('aria-label',entry.d.id+' '+entry.button.textContent);}
  const project=p=>{const v=p.clone().project(camera);return{x:(v.x+1)*width/2,y:(1-v.y)*height/2,z:v.z};};
  const entries=labels.map(e=>{
    const a=project(e.a),b=project(e.b),mid=e.a.clone().add(e.b).multiplyScalar(.5),p=project(mid);
    const horizontal=Math.abs(a.x-b.x)>Math.abs(a.y-b.y);
    return{id:e.d.id,value:e.d.value,axis:e.d.axis,x:p.x,y:p.y,horizontal,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y),textWidth:e.button.offsetWidth,textHeight:e.button.offsetHeight,z:p.z,mid};
  });
  if(state.view==='elevation'){
    const groups=[];
    for(const entry of entries.filter(entry=>entry.value>=.1)){
      const group=groups.find(group=>group[0].axis===entry.axis&&group[0].horizontal===entry.horizontal&&Math.hypot(group[0].x-entry.x,group[0].y-entry.y)<10);
      if(group)group.push(entry);else groups.push([entry]);
    }
    for(const group of groups.filter(group=>group.length>1)){
      const primary=labels.find(label=>label.d.id===group[0].id),values=group.map(entry=>mm(entry.value*1000).replace(/ mm$/,''));
      primary.button.textContent=values.join(' / ')+' mm';primary.button.title=group.map(entry=>entry.id).join(' · ');primary.button.setAttribute('aria-label',primary.button.title+' '+primary.button.textContent);
      group[0].textWidth=primary.button.offsetWidth;group[0].textHeight=primary.button.offsetHeight;
      for(const entry of group.slice(1)){const merged=labels.find(label=>label.d.id===entry.id);merged.mergedInto=primary.d.id;merged.button.hidden=true;}
    }
  }
  const unitsPerPixel=entry=>camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom/height:
    2*camera.position.distanceTo(entry.mid)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/height;
  const inlineEntries=entries.filter(entry=>entry.value>=.1&&!labels.find(label=>label.d.id===entry.id).mergedInto);
  const inlineRotations=new Map(inlineEntries.map(entry=>[entry.id,state.view==='top'&&entry.axis==='Y'?-90:0]));
  const textBox=entry=>{
    const angle=inlineRotations.get(entry.id)*Math.PI/180;
    const boxWidth=Math.abs(Math.cos(angle))*entry.textWidth+Math.abs(Math.sin(angle))*entry.textHeight;
    const boxHeight=Math.abs(Math.sin(angle))*entry.textWidth+Math.abs(Math.cos(angle))*entry.textHeight;
    return{left:entry.x-boxWidth/2,right:entry.x+boxWidth/2,top:entry.y-boxHeight/2,bottom:entry.y+boxHeight/2};
  };
  for(let pass=0;pass<16;pass++){
    let collision=false;
    for(let i=0;i<inlineEntries.length;i++)for(let j=i+1;j<inlineEntries.length;j++){
      const a=textBox(inlineEntries[i]),b=textBox(inlineEntries[j]);
      if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top){
        collision=true;
        if(state.view==='elevation'){
          const candidate=inlineEntries[j],original=inlineRotations.get(candidate.id);
          inlineRotations.set(candidate.id,original===0?90:0);
          const c=textBox(candidate);
          if(!(a.left<c.right&&a.right>c.left&&a.top<c.bottom&&a.bottom>c.top))continue;
          inlineRotations.set(candidate.id,original);
        }
      }
    }
    if(!collision)break;
  }
  for(const entry of inlineEntries){const label=labels.find(label=>label.d.id===entry.id);label.inlineRotation=inlineRotations.get(entry.id);if(label.mergedInto)continue;entry.textWidth=label.button.offsetWidth;entry.textHeight=label.button.offsetHeight;}
  for(const e of labels){const entry=entries.find(p=>p.id===e.d.id);
    const isShort=entry.value<.1;
    if(isShort){
      const dx=project(e.b).x-project(e.a).x,dy=project(e.b).y-project(e.a).y,span=Math.hypot(dx,dy)||1,nx=-dy/span,ny=dx/span;
      const shift=.05/unitsPerPixel(entry),plusRoom=Math.min(nx>0?(width-entry.x)/nx:entry.x/-nx,ny>0?(height-entry.y)/ny:entry.y/-ny),minusRoom=Math.min(nx>0?entry.x/nx:(width-entry.x)/-nx,ny>0?entry.y/ny:(height-entry.y)/-ny);
      e.calloutSide=plusRoom>=minusRoom?1:-1;e.leaderNormal={x:nx*e.calloutSide,y:ny*e.calloutSide};
      const x=entry.x+e.leaderNormal.x*shift,y=entry.y+e.leaderNormal.y*shift;
      e.anchor=new THREE.Vector3(x/width*2-1,1-y/height*2,entry.z).unproject(camera);
    }else{e.calloutSide=0;e.anchor=entry.mid.clone();}
    e.referenceDistance=camera.position.distanceTo(entry.mid);e.referenceZoom=camera.zoom;
  }
}
function layoutModelLabels(){
  layoutDirty=false;if(!camera||!lineSvg)return;camera.updateMatrixWorld();const host=$('#model-canvas'),width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;lineSvg.setAttribute('viewBox',`0 0 ${width} ${height}`);lineSvg.replaceChildren();
  const project=p=>{const v=p.clone().project(camera);return{x:(v.x+1)*width/2,y:(1-v.y)*height/2,z:v.z};};
  const marker=element('marker',{id:'v2-arrow',markerWidth:5,markerHeight:5,refX:4.5,refY:2.5,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});marker.append(element('path',{d:'M0 .3L4.6 2.5L0 4.7Z',fill:'#536171'}));const shortMarker=element('marker',{id:'v2-arrow-short',markerWidth:5,markerHeight:5,refX:4.5,refY:2.5,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});shortMarker.append(element('path',{d:'M0 .3L4.6 2.5L0 4.7Z',fill:'#b6ef79'}));const zMarker=element('marker',{id:'v2-arrow-z',markerWidth:5,markerHeight:5,refX:4.5,refY:2.5,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});zMarker.append(element('path',{d:'M0 .3L4.6 2.5L0 4.7Z',fill:'#55b9e8'}));const defs=element('defs');defs.append(marker,shortMarker,zMarker);lineSvg.append(defs);
  for(const entry of labels){const {a,b,d,button}=entry,pa=project(a),pb=project(b),mid=a.clone().add(b).multiplyScalar(.5);const span=Math.hypot(pa.x-pb.x,pa.y-pb.y);button.hidden=Boolean(entry.mergedInto)||pa.z< -1||pa.z>1||pb.z< -1||pb.z>1||span<4;if(button.hidden)continue;
    button.dataset.calloutSide=String(entry.calloutSide||0);button.dataset.dimensionValue=String(d.value);
    if(entry.calloutSide)button.dataset.calloutDistanceMm='50';else delete button.dataset.calloutDistanceMm;
    const arrow=d.axis==='Z'?'url(#v2-arrow-z)':d.value<.1?'url(#v2-arrow-short)':'url(#v2-arrow)';const line=element('line',{x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y,'data-dimension-id':d.id,class:'dimension-line'+(d.axis==='Z'?' axis-z':'')+(d.value<.1?' short-callout':' inline')+(state.selectedRuler===d.id?' selected':''),'marker-start':arrow,'marker-end':arrow});lineSvg.append(line);
    const p=project(entry.anchor||mid),scale=1;
    const angle=entry.inlineRotation?` rotate(${entry.inlineRotation}deg)`:'';
    button.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%)${angle} scale(${scale})`;button.dataset.anchor=(entry.anchor||mid).toArray().join(',');
    if(d.value<.1&&entry.calloutSide){
      const normal=entry.leaderNormal||{x:0,y:1};
      const edgeDistance=Math.min((button.offsetWidth*scale/2+3)/Math.max(.001,Math.abs(normal.x)),(button.offsetHeight*scale/2+3)/Math.max(.001,Math.abs(normal.y)));
      lineSvg.append(element('line',{x1:(pa.x+pb.x)/2,y1:(pa.y+pb.y)/2,
        x2:p.x-normal.x*edgeDistance,y2:p.y-normal.y*edgeDistance,'data-dimension-id':d.id,'data-gap-mm':'50',class:'dimension-leader'+(d.axis==='Z'?' axis-z':'')}));
    }
  }
}
function updateThumbnail(){
  if(!model)return;const host=$('#model-thumbnail');if(!previewRenderer){previewRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true});previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.append(previewRenderer.domElement);}
  const preview=new THREE.Scene(),copy=model.clone(true);copy.traverse(o=>{if(o.isMesh)o.material=new THREE.MeshBasicMaterial({color:0xbacde4,side:THREE.DoubleSide,...surfaceDepth('hard',Math.max(0,data.objects.indexOf(sourceName(o))),data.objects.length)});else if(o.isLine){o.material=o.material.clone();}});preview.add(copy);
  previewCamera=previewCamera||new THREE.OrthographicCamera();const size=modelBounds.getSize(new THREE.Vector3()),center=modelBounds.getCenter(new THREE.Vector3()),half=Math.max(size.x,size.z)/2*1.08;
  Object.assign(previewCamera,{left:-half,right:half,top:half,bottom:-half,near:.01,far:100});previewCamera.up.set(0,0,-1);previewCamera.position.copy(center).add(new THREE.Vector3(0,20,0));previewCamera.lookAt(center);fitDepthRange(previewCamera,modelBounds);previewCamera.updateProjectionMatrix();const width=mobile.matches?92:140;previewRenderer.setSize(width,width,false);previewRenderer.render(preview,previewCamera);copy.traverse(o=>{if(o.isMesh||o.isLine)o.material.dispose();});
}

let drawView,initialDrawView,dragStart;
function renderDrawing(){
  const s=currentSurface(),svg=$('#tile-drawing');if(!svg.clientWidth||!svg.clientHeight)return;svg.replaceChildren();const bounds=drawingBounds(s.tiles);const width=(bounds.maxX-bounds.minX)*1000,height=(bounds.maxY-bounds.minY)*1000;
  const pad=Math.max(260,Math.max(width,height)*.065);const hostRatio=svg.clientWidth/svg.clientHeight;let vw=width+pad*2,vh=height+pad*2;if(vw/vh<hostRatio)vw=vh*hostRatio;else vh=vw/hostRatio;
  initialDrawView={x:bounds.minX*1000+width/2-vw/2,y:-bounds.maxY*1000+height/2-vh/2,w:vw,h:vh};drawView={...initialDrawView};setDrawingView();
  const title=element('title');title.textContent=s.name+'，单位毫米';svg.append(title);
  for(const tile of s.tiles){
    const polygon=element('polygon',{points:tile.polygon.map(p=>[p[0]*1000,-p[1]*1000].join(',')).join(' '),class:`tile-piece${tile.rectangle?'':' irregular'}${tile.oversize?' oversize':''}${state.selectedTile===tile.id?' selected':''}`,'data-tile':tile.id,tabindex:0,role:'button','aria-label':`${tile.id} ${mm(tile.widthMm)}乘${mm(tile.heightMm)}毫米`});
    const title=element('title');title.textContent=`${tile.id} · ${mm(tile.widthMm)} × ${mm(tile.heightMm)} mm${tile.rectangle?'':'（异形包络）'}${tile.oversize?' · 待核对':''}`;polygon.append(title);svg.append(polygon);
    polygon.addEventListener('click',()=>selectTile(tile.id));polygon.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectTile(tile.id);}});
    const cx=tile.polygon.reduce((a,p)=>a+p[0],0)/tile.polygon.length*1000,cy=-tile.polygon.reduce((a,p)=>a+p[1],0)/tile.polygon.length*1000;
    const font=Math.min(75,Math.max(28,Math.min(tile.widthMm/7.8,tile.heightMm/3)));
    const group=element('g',{class:'tile-label-group','data-label':tile.id});
    const code=element('text',{x:cx,y:cy-font*.64,'font-size':font*.9,class:'tile-label tile-code'});code.textContent=tile.id;group.append(code);
    const size=element('text',{x:cx,y:cy+font*.64,'font-size':font,class:'tile-label tile-measurement'});size.textContent=`${mm(tile.widthMm)} × ${mm(tile.heightMm)}`;group.append(size);svg.append(group);
  }
  const top=-bounds.maxY*1000-90,left=bounds.minX*1000-90,right=bounds.maxX*1000,bottom=-bounds.minY*1000;
  const lineTop=element('path',{d:`M${bounds.minX*1000} ${top+30}V${top-30}M${bounds.minX*1000} ${top}H${right}M${right} ${top+30}V${top-30}`,class:'drawing-outline'});svg.append(lineTop);
  const widthLabel=element('text',{x:(bounds.minX+bounds.maxX)*500,y:top-70,class:'drawing-dimension'});widthLabel.textContent=mm(width)+' mm';widthLabel.setAttribute('font-size',Math.max(65,Math.max(width,height)*.014));svg.append(widthLabel);
  const lineSide=element('path',{d:`M${left-30} ${-bounds.maxY*1000}H${left+30}M${left} ${-bounds.maxY*1000}V${bottom}M${left-30} ${bottom}H${left+30}`,class:'drawing-outline'});svg.append(lineSide);
  const heightLabel=element('text',{x:left-85,y:(bottom-bounds.maxY*1000)/2,class:'drawing-dimension',transform:`rotate(-90 ${left-85} ${(bottom-bounds.maxY*1000)/2})`});heightLabel.textContent=mm(height)+' mm';heightLabel.setAttribute('font-size',Math.max(65,Math.max(width,height)*.014));svg.append(heightLabel);
  $('#drawing-caption').textContent=`${s.name} · ${s.axes.join(' / ')} 方向 · mm`;
  $('#surface-spec').textContent=`标称 ${s.nominalMm.join(' × ')} mm · ${s.tiles.length} 块面 · ${areaM2(s.areaM2)} m²`;
  $('#schedule-context').textContent=`当前区域 ${s.tiles.length} 块面，尺寸单位为毫米；编号可在图中定位。`;
  updateDrawingLabels();renderTileTable();updateTileDetail();
}
function setDrawingView(){if(drawView)$('#tile-drawing').setAttribute('viewBox',`${drawView.x} ${drawView.y} ${drawView.w} ${drawView.h}`);}
function zoomDrawing(factor,ratio={x:.5,y:.5}){const newW=drawView.w*factor,newH=drawView.h*factor;if(newW<initialDrawView.w*.12||newW>initialDrawView.w*4)return;drawView={x:drawView.x+(drawView.w-newW)*ratio.x,y:drawView.y+(drawView.h-newH)*ratio.y,w:newW,h:newH};setDrawingView();}
function updateDrawingLabels(){const show=$('#tile-label-toggle').checked;$('#tile-drawing').querySelectorAll('.tile-label-group').forEach(g=>g.style.display=show?'':'none');}
function selectSurface(id){state.surface=id;state.selectedTile=currentSurface().tiles[0].id;$('#surface-select').value=id;$('#tile-search').value='';renderDrawing();}
function selectTile(id){state.selectedTile=id;$('#tile-drawing').querySelectorAll('[data-tile]').forEach(e=>e.classList.toggle('selected',e.dataset.tile===id));$('#tile-schedule').querySelectorAll('tr').forEach(r=>r.classList.toggle('selected',r.dataset.tile===id));updateTileDetail();}
function updateTileDetail(){
  const s=currentSurface(),t=selectedTile();$('#tile-id').textContent=t.id;$('#tile-size').textContent=`${mm(t.widthMm)} × ${mm(t.heightMm)} mm`;$('#tile-shape').textContent=t.rectangle?'矩形块面':'异形块面 · 宽高为包络尺寸';$('#tile-position').textContent=`${s.tiles.indexOf(t)+1} / ${s.tiles.length}`;
  const entries=[['区域',s.name],['面积',areaM2(t.areaM2)+' m²'],['各边长度',t.edgeLengthsMm.map(mm).join(' / ')+' mm']];if(t.sourceFaceIds?.length>1)entries.push(['对应源块面',t.sourceFaceIds.join(' / ')]);if(t.heightMmFromOrigin!==null)entries.push(['源工程 Z 高度',mm(t.heightMmFromOrigin)+' mm']);
  $('#tile-facts').replaceChildren(...entries.map(([term,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=term;dd.textContent=value;row.append(dt,dd);return row;}));$('#tile-warning').hidden=!t.oversize;$('#tile-warning').textContent=`该块面的包络尺寸超过 ${s.nominalMm.join(' × ')} mm 标称规格。图纸保留源模型形状，请核对拼缝或原砖规格。`;
}
function renderTileTable(){
  const query=$('#tile-search').value.trim().toUpperCase(),s=currentSurface();const tiles=s.tiles.filter(t=>t.id.includes(query));$('#empty-schedule').hidden=tiles.length>0;
  $('#tile-schedule').replaceChildren(...tiles.map(t=>{const tr=document.createElement('tr');tr.dataset.tile=t.id;tr.classList.toggle('selected',t.id===state.selectedTile);tr.tabIndex=0;
    const values=[t.id,`${mm(t.widthMm)} × ${mm(t.heightMm)}`,t.rectangle?'矩形':'异形包络',areaM2(t.areaM2),t.edgeLengthsMm.map(mm).join(' / '),t.oversize?'待核对':'—'];for(const value of values){const td=document.createElement('td');td.textContent=value;if(value==='待核对')td.className='review-text';tr.append(td);}tr.addEventListener('click',()=>selectTile(t.id));tr.addEventListener('keydown',e=>{if(e.key==='Enter')selectTile(t.id);});return tr;}));
}
function renderRulerTable(){
  $('#ruler-schedule').replaceChildren(...data.dimensions.map(d=>{const tr=document.createElement('tr');tr.dataset.ruler=d.id;tr.tabIndex=0;tr.classList.toggle('selected',state.selectedRuler===d.id);const mid=d.endpoints[0].map((v,i)=>(v+d.endpoints[1][i])*500);for(const v of[d.id,d.axis+' 轴',mm(d.value*1000),mid.map(mm).join(' / ')]){const td=document.createElement('td');td.textContent=v;tr.append(td);}tr.addEventListener('click',()=>selectRuler(d.id,true));tr.addEventListener('keydown',e=>{if(e.key==='Enter')selectRuler(d.id,true);});return tr;}));
}
function selectRuler(id,scroll){state.selectedRuler=state.selectedRuler===id?null:id;const d=data.dimensions.find(d=>d.id===id);if(state.selectedRuler){if(d.zone==='cabinet'){state.cabinetVisible=true;state.cabinetDimensions=true;}else if(d.zone==='wall-cabinet'){state.wallCabinetVisible=true;state.wallCabinetDimensions=true;}if(!dimensionVisible(d,state.view,state.direction))state.view='3d';}$('#dimension-toggle').checked=true;state.dimensions=true;applyPresentation();renderModelLabels();renderRulerTable();frameCamera();if(scroll)$('#space').scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'});}
function renderCheckNotice(){
  const notice=$('#check-notice');notice.hidden=!data.checks.oversizeCount;notice.textContent=`尺寸核对：有 ${data.checks.oversizeCount} 个块面超过标称 800 × 800 mm，已按源模型保留。点击编号定位：`;
  for(const issue of data.checks.issues){const button=document.createElement('button');button.textContent=issue.id;button.addEventListener('click',()=>{const s=data.surfaces.find(s=>s.tiles.some(t=>t.id===issue.id));selectSurface(s.id);selectTile(issue.id);});notice.append(button);}
}
function setSection(section){
  if(!model)return;
  if(section===3)section=2;
  state.section=section;state.selectedRuler=null;state.view='3d';state.perspectivePreset=section===2?'Camera_01':null;
  if(section===2){
    state.cabinetVisible=true;state.cabinetDimensions=true;state.cabinetDoorsVisible=false;
    state.wallCabinetVisible=false;state.wallCabinetDimensions=false;state.wallCabinetDoorsVisible=false;
    state.cabinetTransparency=70;state.baseTransparency=100;
  }else{state.cabinetTransparency=70;state.baseTransparency=75;}
  const sectionName=section===1?'板块一':'橱柜吊柜区';
  const sectionLabel=section===1?'硬装与铺贴':'橱柜吊柜区';
  data.dimensions=sectionDimensions(section);data.section=section===1?'板块一':'橱柜吊柜区';
  document.querySelectorAll('button[data-section]').forEach(button=>{const active=Number(button.dataset.section)===section;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  document.querySelector('.page-intro .eyebrow').textContent=`SECTION 0${section} / 一楼`;
  document.querySelector('h1').textContent=section===1?`${sectionName} · ${sectionLabel}`:sectionName;
  document.title=`一楼空间 2.0 · ${data.section}`;
  $('#space-title').textContent=section===1?'一楼硬装':sectionLabel;
  $('#layout').hidden=section>1;document.querySelector('nav a[href="#layout"]').hidden=section>1;
  $('.model-options').classList.toggle('section2',section>1);
  $('.settings-primary').hidden=section>1;$('#tile-transparency-control').hidden=section>1;
  $('#context-transparency-control>span').textContent=section>1?'一楼硬装透明度':'其余模型透明度';
  $('#context-transparency-help').textContent=section>1?'0% 为不透明，100% 为完全透明，所有视图生效':'0% 为不透明，100% 为完全透明，仅在 3D 突出铺贴时生效';
  $('#measurement-title').textContent=section===1?'硬装尺寸':'橱柜吊柜尺寸';
  $('#measurements .section-description').textContent=`以下为源工程中的${sectionLabel}标尺；点击一行在模型中高亮。顶视只显示 X、Y 方向且不小于 100 mm 的尺寸。`;
  $('#model-canvas').setAttribute('aria-label',section===1?'一楼硬装三维视图':'橱柜吊柜区与一楼硬装三维视图');
  document.querySelector('.site-footer>span').textContent=`一楼空间 / ${data.section} · 2.0`;
  const url=new URL(location);if(section===1)url.searchParams.delete('section');else url.searchParams.set('section',2);history.replaceState(null,'',url);
  applyPresentation();renderModelLabels();renderRulerTable();frameCamera();updateThumbnail();
}

function bindEvents(){
  document.querySelectorAll('button[data-section]').forEach(button=>button.addEventListener('click',()=>setSection(Number(button.dataset.section))));
  for(const [id,key] of [['cabinet-visible','cabinetVisible'],['cabinet-dimensions','cabinetDimensions'],['cabinet-doors','cabinetDoorsVisible'],['wall-cabinet-visible','wallCabinetVisible'],['wall-cabinet-dimensions','wallCabinetDimensions'],['wall-cabinet-doors','wallCabinetDoorsVisible']])$('#'+id).addEventListener('change',e=>{state[key]=e.target.checked;applyPresentation();if(id.endsWith('dimensions'))renderModelLabels();if(id.endsWith('visible'))frameCamera();});
  $('#cabinet-transparency').addEventListener('input',e=>{state.cabinetTransparency=Number(e.target.value);applyPresentation();});
  $('#ceiling-toggle').addEventListener('click',()=>{state.ceilingVisible=!state.ceilingVisible;applyPresentation();});
  $('#tile-focus-toggle').addEventListener('click',()=>{state.tileFocus=!state.tileFocus;applyPresentation();frameCamera();});
  $('#tile-transparency').addEventListener('input',e=>{state.tileTransparency=Number(e.target.value);applyPresentation();});
  $('#context-transparency').addEventListener('input',e=>{if(state.section>1)state.baseTransparency=Number(e.target.value);else state.contextTransparency=Number(e.target.value);applyPresentation();});
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));$('#camera-preset-toggle').addEventListener('click',setPerspectiveView);$('#camera-preset-2-toggle').addEventListener('click',setPerspectiveView2);$('#direction').addEventListener('change',e=>{state.direction=e.target.value;setView('elevation');});
$('#edges-toggle').addEventListener('click',()=>{state.edges=!state.edges;applyPresentation();});$('#dimension-toggle').addEventListener('change',e=>{state.dimensions=e.target.checked;renderModelLabels();});$('#reset-camera').addEventListener('click',frameCamera);$('#retry').addEventListener('click',()=>location.reload());
  $('#surface-select').addEventListener('change',e=>selectSurface(e.target.value));$('#tile-search').addEventListener('input',renderTileTable);$('#tile-label-toggle').addEventListener('change',updateDrawingLabels);
  $('#drawing-in').addEventListener('click',()=>zoomDrawing(.8));$('#drawing-out').addEventListener('click',()=>zoomDrawing(1.25));$('#drawing-reset').addEventListener('click',()=>{drawView={...initialDrawView};setDrawingView();});
  const svg=$('#tile-drawing');svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoomDrawing(e.deltaY>0?1.12:1/1.12,{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});},{passive:false});
  svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragStart={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...drawView},moved:false};});svg.addEventListener('pointermove',e=>{if(!dragStart||dragStart.id!==e.pointerId)return;const dx=e.clientX-dragStart.x,dy=e.clientY-dragStart.y;if(Math.hypot(dx,dy)>5){dragStart.moved=true;svg.setPointerCapture(e.pointerId);}if(!dragStart.moved)return;const r=svg.getBoundingClientRect();drawView={...dragStart.view,x:dragStart.view.x-dx/r.width*dragStart.view.w,y:dragStart.view.y-dy/r.height*dragStart.view.h};setDrawingView();});svg.addEventListener('pointerup',()=>dragStart=null);svg.addEventListener('pointercancel',()=>dragStart=null);
  $('#download-csv').addEventListener('click',()=>saveFile(scheduleCsv(state.section>1?{...data,surfaces:[]}:data),'text/csv;charset=utf-8',`${state.section===1?'板块一':'橱柜吊柜区'}_全部尺寸_2.0.csv`));
  $('#download-svg').addEventListener('click',()=>{const s=currentSurface(),svg=$('#tile-drawing').cloneNode(true);svg.setAttribute('xmlns',ns);svg.setAttribute('width','1600');svg.setAttribute('height','1200');svg.setAttribute('viewBox',`${initialDrawView.x} ${initialDrawView.y} ${initialDrawView.w} ${initialDrawView.h}`);const style=element('style');style.textContent='.tile-piece{fill:#e8edf2;stroke:#6f849b;stroke-width:1;vector-effect:non-scaling-stroke}.tile-piece.irregular{fill:#dbe7f5}.tile-piece.oversize{fill:#faf0da}.tile-label{font-family:Arial,Microsoft YaHei,sans-serif;fill:#506071;text-anchor:middle;dominant-baseline:middle}.tile-code{font-weight:600}.drawing-outline{fill:none;stroke:#63778d;stroke-width:1;vector-effect:non-scaling-stroke}.drawing-dimension{font-family:Arial,Microsoft YaHei,sans-serif;fill:#536477;text-anchor:middle;dominant-baseline:middle}';svg.prepend(style);saveFile(new XMLSerializer().serializeToString(svg),'image/svg+xml;charset=utf-8',`板块一_${s.name.replaceAll('/','_')}.svg`);});
  let previousWidth=innerWidth;window.addEventListener('resize',()=>{if(Math.abs(innerWidth-previousWidth)>20){previousWidth=innerWidth;if(data)renderDrawing();}});
}

async function boot(){
  try{
    const response=await fetch('./public/v2/section1.json',{cache:'no-store'});if(!response.ok)throw Error(`尺寸数据读取失败：HTTP ${response.status}`);data=validateSection(await response.json());section1Dimensions=data.dimensions;
    $('#source-status').textContent='源工程更新 '+new Date(data.sourceModifiedAt).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'});
    $('#source-footer').textContent=`来源：${data.source} · 读取时间：${new Date(data.exportedAt).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'})} · 已隐藏 ${data.checks.hiddenTopologySeams||0} 条内部斜向布线，尺寸按合并后的铺贴轮廓读取，未修改源工程。`;
    $('#surface-select').replaceChildren(...data.surfaces.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=`${s.name}（${s.tiles.length}）`;return o;}));
    $('#layout-counts').replaceChildren(...data.tileObjects.map(o=>{const s=document.createElement('span');s.textContent=`${o.nominalMm.join(' × ')} · ${o.tileCount??o.faceCount} 块面`;return s;}));
    bindEvents();selectSurface('floor');renderRulerTable();renderCheckNotice();document.body.dataset.ready='section1';
    await setupModel();const requestedSection=Number(new URLSearchParams(location.search).get('section'));if([2,3].includes(requestedSection))setSection(requestedSection);
  }catch(error){console.error(error);$('#model-loading').hidden=true;$('#model-error').hidden=false;$('#error-detail').textContent=error.message;$('#source-status').textContent='读取失败，请检查工程数据';}
}
void boot();


