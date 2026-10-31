import {createSocketOutline} from './socket-outline.js?v=1.16';
import {isSocketObject,socketEdgeStyle} from './socket-highlight.js?v=1.16';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {bindTapToZoom,tapFocusFrame} from './tap-zoom.js?v=1.16';
import {mm,areaM2,drawingBounds,scheduleCsv,dimensionVisible,validateSection} from './v2-math.js?v=1.16';
import {tileSurfaceEdges,keepTileEdge,mergeTileFacesForDisplay} from './tile-edges.js?v=1.16';
import {dedupeTopViewDimensions} from './scene-math.js?v=1.16';
import {surfaceDepth,outlineMaterial,fitDepthRange} from './render-depth.js?v=1.16';
import {tilePresentation,TILE_FOCUS_OBJECT} from './tile-presentation.js?v=1.16';
import {tileUV,hatchTexture,gradientTexture,CEILING_COLORS} from './tile-gradient.js?v=1.16';
import {cabinetMaterial,studioEnvironment} from './cabinet-materials.js?v=1.16';
import {cuttingOutline,stockRemainderPath} from './cutting-geometry.js?v=1.16';

const $=s=>document.querySelector(s), ns='http://www.w3.org/2000/svg';
const isHostedRelease=/(?:^|\.)github\.io$/i.test(location.hostname);
const state={section:1,cabinetVisible:true,wallCabinetVisible:true,cabinetDimensions:true,wallCabinetDimensions:true,cabinetDoorsVisible:false,wallCabinetDoorsVisible:false,cabinetTransparency:70,floor2HardVisible:true,floor2SoftVisible:false,floor2Transparency:0,floor2TileType:'1200',view:'3d',perspectivePreset:null,direction:'front',edges:true,socketHighlights:{1:true,3:true},dimensions:true,tileFocus:true,ceilingVisible:false,contextTransparency:0,baseTransparency:0,tileTransparency:0,selectedRuler:null,selectedTile:null,surface:null};
let data,section1Dimensions,section1Surfaces,renderer,controls,camera,model,modelBounds,cameraPresets={},offset,previewRenderer,previewCamera;
const scene=new THREE.Scene(),root=new THREE.Group(),tileRoot=new THREE.Group();
scene.background=new THREE.Color(0xf5f7fa);scene.add(root,tileRoot);
const perspective=new THREE.PerspectiveCamera(42,1,.01,250),ortho=new THREE.OrthographicCamera(-5,5,5,-5,.01,250);
const raycaster=new THREE.Raycaster();let layoutDirty=true,focus=null,labels=[],lineSvg,meshEntries=[],edgeEntries=[];
let sharedAnnotations=[],annotationPlacement=false,annotationDraft=null,annotationEditingId=null,annotationLayoutDirty=true,annotationDocument={version:2,models:{}};
const mobile=matchMedia('(max-width:650px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
document.documentElement.classList.toggle('github-release',isHostedRelease);
function syncRangeVisual(input){
  if(!input||input.type!=='range')return;
  const min=Number(input.min||0),max=Number(input.max||100),value=Number(input.value||0);
  const progress=max>min?Math.max(0,Math.min(100,(value-min)/(max-min)*100)):0;
  input.style.setProperty('--range-progress',`${progress}%`);
}
function syncAllRanges(){document.querySelectorAll('input[type="range"]').forEach(syncRangeVisual);}
function element(tag,attrs={}){const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
function toThree(p){return new THREE.Vector3(p[0],p[2],-p[1]).add(offset||new THREE.Vector3());}
function saveFile(text,type,name){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function currentSurface(){return data.surfaces.find(s=>s.id===state.surface)||data.surfaces[0];}
function selectedTile(){return currentSurface().tiles.find(t=>t.id===state.selectedTile)||currentSurface().tiles[0];}
function sourceName(object){for(let o=object;o;o=o.parent){const name=o.userData.name||o.name;if(data.objects.includes(name))return name;}return object.name;}
function annotationObject(name){let match=null;model?.traverse(o=>{if(!match&&!o.userData.panelEdgeLine&&(o.userData.name===name||o.name===name))match=o;});return match;}
function annotationMessage(message,error=false){const status=$('#annotation-status');status.textContent=message;status.title=message;status.classList.toggle('error',error);}
function annotationStorageKey(){return`kitchen-three-annotations:v2:${data.sourceSha256}${annotationDocument.revision?':'+annotationDocument.revision:''}`;}
function annotationSections(){
  let modelData=annotationDocument.models[data.sourceSha256];
  if(Array.isArray(modelData))modelData={sections:{section1:modelData,section2:[]}};
  modelData||={};modelData.sections||={section1:[],section2:[],section3:[]};
  for(const key of ['section1','section2','section3'])if(!Array.isArray(modelData.sections[key]))modelData.sections[key]=[];
  annotationDocument.models[data.sourceSha256]=modelData;return modelData.sections;
}
function activateAnnotationSection(){sharedAnnotations=annotationSections()[`section${state.section}`];annotationLayoutDirty=true;annotationMessage(sharedAnnotations.length?`板块 ${state.section} 已载入 ${sharedAnnotations.length} 条标注。`:`板块 ${state.section} 暂无标注，可在视图中添加。`);}
function persistLocalAnnotations(){
  annotationDocument.version=2;annotationSections()[`section${state.section}`]=sharedAnnotations;
  try{localStorage.setItem(annotationStorageKey(),JSON.stringify(annotationSections()));annotationMessage('本机草稿已保存；导出 JSON 并发布后，其他人也能看到。');}
  catch{annotationMessage('浏览器无法保存本机草稿，请导出标注 JSON 备份。',true);}
  annotationLayoutDirty=true;
}
function setEditorPosition(clientX,clientY){const frame=$('#model-frame').getBoundingClientRect(),editor=$('#annotation-editor'),x=clientX-frame.left,y=clientY-frame.top;editor.style.left=`${Math.max(8,Math.min(frame.width-286,x+14))}px`;editor.style.top=`${Math.max(48,Math.min(frame.height-260,y+14))}px`;}
function openAnnotationEditor(item,position,clientX,clientY){
  annotationEditingId=item?.id||null;annotationDraft=position?{objectName:position.objectName,position:[...position.position]}:item?{objectName:item.objectName,position:[...item.position]}:null;
  $('#annotation-editor-heading').textContent=item?'编辑标注':'新建标注';$('#annotation-text').value=item?.text||'';$('#annotation-note').value=item?.note||'';
  $('#annotation-color').value=item?.color||$('#annotation-default-color').value;$('#annotation-size').value=item?.fontSize||$('#annotation-default-size').value;$('#annotation-size-value').value=$('#annotation-size').value;
  $('#annotation-delete').hidden=!item;$('#annotation-editor').hidden=false;setEditorPosition(clientX,clientY);
}
function startAnnotationPlacement(){annotationPlacement=true;renderer?.domElement.classList.add('placing-annotation');annotationMessage('点击模型表面放置文字标注。');}
function layoutAnnotationMarkers(){
  annotationLayoutDirty=false;const host=$('#shared-annotations');host.replaceChildren();if(!camera||!model)return;
  const bounds=$('#model-canvas').getBoundingClientRect(),width=bounds.width,height=bounds.height;
  sharedAnnotations.forEach(item=>{
    const object=annotationObject(item.objectName);if(!object||!object.visible)return;
    const point=object.localToWorld(new THREE.Vector3(...item.position));const projected=point.clone().project(camera);
    if(projected.z< -1||projected.z>1||Math.abs(projected.x)>1.05||Math.abs(projected.y)>1.05)return;
    const marker=document.createElement('button');marker.type='button';marker.className='model-note-marker';marker.textContent=item.text;marker.title=item.note||item.text;marker.style.left=`${(projected.x+1)*width/2}px`;marker.style.top=`${(1-projected.y)*height/2}px`;marker.style.color=item.color;marker.style.fontSize=`${item.fontSize}px`;marker.addEventListener('click',event=>{event.stopPropagation();openAnnotationEditor(item,null,event.clientX,event.clientY);});host.append(marker);
  });
}
async function loadAnnotations(){
  if(isHostedRelease){
    annotationDocument={version:2,models:{}};sharedAnnotations=[];
    $('#annotation-toolbar')?.setAttribute('hidden','');$('#annotation-editor').hidden=true;
    $('#shared-annotations').replaceChildren();annotationLayoutDirty=false;
    annotationMessage('线上版本不显示本地标注。');
    return;
  }
  try{const response=await fetch('./public/annotations.json',{cache:'no-store'});if(response.ok)annotationDocument=await response.json();}
  catch{annotationDocument={version:2,models:{}};}
  if(!annotationDocument||typeof annotationDocument!=='object')annotationDocument={version:2,models:{}};
  annotationDocument.version=2;annotationDocument.models||={};const sections=annotationSections();
  try{
    const draft=JSON.parse(localStorage.getItem(annotationStorageKey())||'null');
    if(Array.isArray(draft))sections.section1=draft;
    else if(draft&&typeof draft==='object')for(const key of ['section1','section2','section3'])if(Array.isArray(draft[key]))sections[key]=draft[key];
  }catch{}
  activateAnnotationSection();layoutAnnotationMarkers();annotationMessage(sharedAnnotations.length?`板块 ${state.section} 已载入 ${sharedAnnotations.length} 条标注。`:`板块 ${state.section} 暂无标注，可在视图中添加。`);
}
function exportAnnotations(){
  annotationSections()[`section${state.section}`]=sharedAnnotations;annotationDocument.version=2;
  saveFile(JSON.stringify(annotationDocument,null,2)+'\n','application/json;charset=utf-8','annotations.json');
  annotationMessage('已导出 annotations.json；将它放入项目 public 目录并发布，线上访问者就会看到这批标注。');
}
function placeAnnotationAt(event){
  if(!annotationPlacement)return;
  const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
  const hit=raycaster.intersectObjects(meshEntries.filter(entry=>entry.mesh.visible).map(entry=>entry.mesh),true).find(entry=>entry.object.isMesh&&entry.object.visible);
  if(!hit){annotationMessage('这里没有可标注的模型表面，请点击模型本体。',true);return;}
  const objectName=sourceName(hit.object),object=annotationObject(objectName);if(!object){annotationMessage('无法定位该模型对象，请换一个位置。',true);return;}
  const position=object.worldToLocal(hit.point.clone()).toArray(),point={objectName,position},item=annotationEditingId?sharedAnnotations.find(entry=>entry.id===annotationEditingId):null;
  annotationPlacement=false;renderer.domElement.classList.remove('placing-annotation');$('#annotation-mode').setAttribute('aria-pressed','false');$('#annotation-mode').textContent='＋ 标注';openAnnotationEditor(item,point,event.clientX,event.clientY);$('#annotation-text').focus();
}
function sectionDimensions(section){return section===1?section1Dimensions:section===2?[...data.section2.dimensions.map(d=>({...d,zone:'cabinet'})),...data.section3.dimensions.map(d=>({...d,zone:'wall-cabinet'}))]:(data.floor2Dimensions||[]);}
function visibleDimensions(){return state.section===1?data.dimensions:state.section===2?data.dimensions.filter(d=>d.zone==='cabinet'?state.cabinetDimensions:state.wallCabinetDimensions):data.dimensions;}
function formatLoadTime(seconds){const total=Math.max(1,Math.ceil(seconds));return total<60?`${total} 秒`:`${Math.floor(total/60)} 分 ${total%60} 秒`;}
function isRenderableMesh(mesh){
  const position=mesh.geometry?.getAttribute?.('position');
  if(!position||position.count<3)return false;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||Math.max(Math.abs(x),Math.abs(y),Math.abs(z))>10000)return false;
  }
  return true;
}
function validModelBounds(sceneRoot){
  const bounds=new THREE.Box3();
  sceneRoot.traverse(object=>{
    if(!object.isMesh)return;
    if(!isRenderableMesh(object)){object.userData.invalidGeometry=true;object.visible=false;return;}
    bounds.expandByObject(object);
  });
  return bounds;
}
function updateModelProgress(event,startedAt){
  const loaded=event.loaded||0,total=data?.modelFileSizeBytes||event.total||0,percent=total?Math.min(100,Math.round(loaded/total*100)):0;
  const elapsed=(performance.now()-startedAt)/1000,speed=elapsed>0?loaded/elapsed:0,remaining=speed&&total?Math.max(0,(total-loaded)/speed):0;
  const progress=$('#model-load-progress'),fill=$('#model-load-progress-fill');progress.setAttribute('aria-valuenow',String(percent));fill.style.width=percent+'%';
  const loadedMb=(loaded/1048576).toFixed(1),totalMb=(total/1048576).toFixed(1),speedMb=(speed/1048576).toFixed(1);
  $('#model-load-detail').textContent=total?percent===100?`模型已载入 ${totalMb} MB · 正在解析模型…`:`${loadedMb} / ${totalMb} MB · ${percent}% · ${speedMb} MB/s · 预计剩余 ${formatLoadTime(remaining)}`:`模型已载入 ${loadedMb} MB · 正在读取…`;
}

async function setupModel(){
  const host=$('#model-canvas');
  $('#space-controls').append($('.model-options'),$('.view-controls'));
  $('.model-options').append($('#floor2-tile-group-controls'));
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
  host.replaceChildren(renderer.domElement);camera=perspective;
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=.7;controls.maxDistance=50;controls.minZoom=.35;controls.maxZoom=10;
  controls.addEventListener('change',()=>{layoutDirty=true;annotationLayoutDirty=true;});
  scene.environment=studioEnvironment(renderer);
  scene.add(new THREE.HemisphereLight(0xf8fbff,0xa2afbe,2.7));const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(-5,10,-7);scene.add(key);const fill=new THREE.DirectionalLight(0xdceaff,1.4);fill.position.set(6,5,4);scene.add(fill);
  const loadStartedAt=performance.now();
  const gltf=await new GLTFLoader().loadAsync(`./public/v2/${data.modelFile}?v=${encodeURIComponent(data.exportedAt)}`,event=>updateModelProgress(event,loadStartedAt));
  model=gltf.scene;model.updateMatrixWorld(true);const rawBounds=validModelBounds(model);
  if(rawBounds.isEmpty())throw new Error('模型没有可显示的有效网格');
  const center=rawBounds.getCenter(new THREE.Vector3());offset=new THREE.Vector3(-center.x,-rawBounds.min.y,-center.z);model.position.add(offset);root.add(model);model.updateMatrixWorld(true);modelBounds=validModelBounds(model);
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
    if(o.isLight){o.userData.floor2Light=data.floor2LightObjects?.includes(o.name)||false;o.visible=false;return;}
    if(!o.isMesh)return;const name=sourceName(o),secondFloor=data.floor2Objects?.includes(name);o.userData.section=secondFloor?3:data.section2Objects.includes(name)||data.section3Objects.includes(name)?2:1;o.userData.floor2Soft=data.floor2SoftObjects?.includes(name)||false;o.userData.cabinetZone=o.userData.section===2?(data.section2Objects.includes(name)?'cabinet':'wall-cabinet'):null;o.userData.cabinetDoor=(data.section2Objects.includes(name)&&name.includes('橱柜柜门'))||(data.section3Objects.includes(name)&&name.includes('吊柜柜门'));const stair=name.includes('楼梯'),rank=Math.max(0,data.objects.indexOf(name));
    o.material=(Array.isArray(o.material)?o.material:[o.material]).map(original=>o.userData.section===2?cabinetMaterial(original,rank,data.objects.length):new THREE.MeshStandardMaterial({
      color:stair?0xc4cfdb:0xe5e9ed,roughness:.85,side:THREE.DoubleSide,
      ...surfaceDepth('hard',rank,data.objects.length),forceSinglePass:true}));
    o.userData.socket=isSocketObject(name)||isSocketObject(o.name);o.renderOrder=rank;
    if(o.material.length===1)o.material=o.material[0];
    meshEntries.push({mesh:o,name,materials:Array.isArray(o.material)?o.material:[o.material]});
  });
  const floor2TileNames=new Set(Object.values(data.floor2TileGroups||{}).flat());
  for(const entry of meshEntries){
    if(floor2TileNames.has(entry.name))continue;
    const geometry=new THREE.EdgesGeometry(entry.mesh.geometry,15);
    const edge=new THREE.LineSegments(geometry,outlineMaterial(0x75808e));edge.renderOrder=200;edge.userData.socket=Boolean(entry.mesh.userData.socket);entry.mesh.add(edge);edgeEntries.push(edge);
    if(entry.mesh.userData.socket){const highlight=createSocketOutline(geometry);entry.mesh.add(highlight);edge.highlightOutline=highlight;}
  }
  renderer.domElement.addEventListener('click',placeAnnotationAt);
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
    controls.update();fitDepthRange(camera,modelBounds);renderer.render(scene,camera);if(layoutDirty)layoutModelLabels();if(annotationLayoutDirty)layoutAnnotationMarkers();
  });
}

function addTileGeometry(){
  const textures={tile:hatchTexture(),ceiling:gradientTexture(CEILING_COLORS)};
  for(const s of [...data.surfaces,...(data.floor2Surfaces||[])]){
    const edgeMap=tileSurfaceEdges(s),displayTiles=mergeTileFacesForDisplay(s);
    for(const tile of displayTiles){
    const points=tile.points.map(p=>toThree(p).add(s.kind==='floor'&&s.id?.startsWith('floor2')?new THREE.Vector3(0,.012,0):new THREE.Vector3()));const indices=THREE.ShapeUtils.triangulateShape(tile.polygon.map(p=>new THREE.Vector2(...p)),[]).flat();
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(tileUV(tile.polygon,s.kind!=='ceiling'),2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,toneMapped:false,map:s.kind==='ceiling'?textures.ceiling:textures.tile,...surfaceDepth('tile')}));mesh.renderOrder=100;
    mesh.userData.gradientMap=s.kind==='ceiling'?textures.ceiling:textures.tile;
    Object.assign(mesh.userData,{tileId:tile.id,kind:s.kind,tileGroup:s.tileGroup,sourceObject:tile.sourceObject||s.sourceObject,floor2:Boolean(s.tileGroup)});tileRoot.add(mesh);
    const edgePoints=[];
    if(tile.mergedDisplay){for(let i=0;i<points.length;i++)edgePoints.push(points[i],points[(i+1)%points.length]);}
    else for(let i=0;i<tile.polygon.length;i++)if(keepTileEdge(edgeMap,tile.points[i],tile.points[(i+1)%tile.points.length],tile.id))edgePoints.push(points[i],points[(i+1)%points.length]);
    const outline=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edgePoints),outlineMaterial(0xa3b1c0,'tile'));outline.userData.tileOutline=true;outline.renderOrder=210;mesh.add(outline);
    }
  }
}
function viewDirection(){return new THREE.Vector3(...(state.view==='top'?[0,1,0]:state.view==='3d'?[1.15,.95,-1.45]:({front:[0,0,-1],back:[0,0,1],left:[-1,0,0],right:[1,0,0]})[state.direction])).normalize();}
function applyPresentation(){
  const top=state.view==='top',focus=state.view==='3d'&&state.tileFocus;
  const context=state.section>1,secondFloor=state.section===3,tileOverlayView=secondFloor&&(state.view==='3d'||state.view==='top'),transparency=secondFloor?state.floor2Transparency:context?state.baseTransparency:state.contextTransparency;
  $('#space-controls').classList.toggle('section3-active',secondFloor);
  const baseStyle=tilePresentation({view:context?'3d':state.view,focus:context||state.tileFocus,contextTransparency:transparency,kind:'hard'});
  for(const entry of meshEntries){
    const zone=entry.mesh.userData.cabinetZone;
    const zoneVisible=zone==='cabinet'?state.cabinetVisible:zone==='wall-cabinet'?state.wallCabinetVisible:true;
    const doorsVisible=zone==='cabinet'?state.cabinetDoorsVisible:zone==='wall-cabinet'?state.wallCabinetDoorsVisible:true;
    const sourceTileGroup=Object.entries(data.floor2TileGroups||{}).find(([,names])=>names.includes(entry.name))?.[0];
    const secondFloorTileObject=Boolean(sourceTileGroup);
    const tileTypeVisible=!secondFloorTileObject||sourceTileGroup===state.floor2TileType;
    const visible=secondFloor?entry.mesh.userData.section===3&&tileTypeVisible&&(entry.mesh.userData.floor2Soft?state.floor2SoftVisible:state.floor2HardVisible):state.section===2?entry.mesh.userData.section<=2&&zoneVisible:entry.mesh.userData.section===1;
    // The tile overlay is the authoritative colored surface in 3D/top views.
    // Hiding its coplanar source mesh prevents depth fighting and keeps all four
    // floor/wall specification groups equally visible when their group is active.
    entry.mesh.visible=visible&&!entry.mesh.userData.invalidGeometry&&(!entry.mesh.userData.cabinetDoor||doorsVisible)&&!(secondFloorTileObject&&tileOverlayView);
    const foreground=Boolean(zone)&&context;
    const cabinetOpacity=1-state.cabinetTransparency/100;
    const style=foreground?{color:0xc5d6e9,opacity:cabinetOpacity,transparent:cabinetOpacity<1,depthWrite:cabinetOpacity===1}:context?baseStyle:tilePresentation({view:state.view,focus:state.tileFocus,contextTransparency:state.contextTransparency,kind:'hard',door:entry.name.includes('门')});
    const socketObject=entry.mesh.userData.socket;
    const materials=entry.materials;for(const m of materials){m.color.setHex(socketObject?0x101010:!focus&&entry.name.includes('楼梯')?0xc4cfdb:style.color);m.opacity=style.opacity;m.transparent=style.transparent;m.depthWrite=style.depthWrite;m.needsUpdate=true;}
  }
  model?.traverse(o=>{if(o.isLight&&o.userData.floor2Light)o.visible=secondFloor&&state.floor2HardVisible;});
  const contextStyle=baseStyle;
  edgeEntries.forEach(edge=>{
    const floor2Source=edge.userData.floor2TileSource,owner=floor2Source?edge.userData.ownerMesh:edge.parent;
    const foreground=(floor2Source?3:owner?.userData.section)===state.section&&state.section>1;
    const style=foreground?{edgeOpacity:1}:contextStyle;
    const socketStyle=socketEdgeStyle({socket:edge.userData.socket,ownerSection:owner?.userData.section,section:state.section,highlight:state.socketHighlights[state.section],edges:state.edges,edgeOpacity:style.edgeOpacity});
    edge.visible=floor2Source?state.edges&&secondFloor&&tileOverlayView&&state.floor2HardVisible&&edge.userData.tileGroup===state.floor2TileType:Boolean(owner?.visible)&&socketStyle.visible;
    edge.userData.socketHighlighted=socketStyle.highlighted;
    if(edge.highlightOutline)edge.highlightOutline.visible=socketStyle.highlighted&&Boolean(owner?.visible);
    if(!floor2Source)edge.material.color.setHex(socketStyle.color);
    edge.material.transparent=socketStyle.opacity<1;edge.material.opacity=socketStyle.opacity;
    edge.material.toneMapped=!socketStyle.highlighted;
    edge.renderOrder=socketStyle.highlighted?410:floor2Source?220:foreground?210:400;edge.material.needsUpdate=true;
  });
  for(const mesh of tileRoot.children){const floor2Tile=mesh.userData.floor2,style=floor2Tile?tilePresentation({view:state.view,focus,contextTransparency:state.floor2Transparency,tileTransparency:state.tileTransparency,kind:mesh.userData.kind,sourceObject:TILE_FOCUS_OBJECT}):tilePresentation({view:state.view,focus:state.tileFocus,contextTransparency:state.contextTransparency,tileTransparency:state.tileTransparency,kind:mesh.userData.kind,sourceObject:mesh.userData.sourceObject});
    const floor2TypeVisible=!floor2Tile||mesh.userData.tileGroup===state.floor2TileType;
    mesh.visible=floor2Tile?state.section===3&&state.floor2HardVisible&&floor2TypeVisible&&(state.view==='3d'||state.view==='top'):!context&&(mesh.userData.kind==='ceiling'?state.view==='3d'&&state.ceilingVisible:mesh.userData.kind==='floor'||(!top&&state.view==='3d'));
    const m=mesh.material;m.map=mesh.userData.kind==='ceiling'?(state.view==='3d'?mesh.userData.gradientMap:null):mesh.userData.gradientMap;m.color.setHex(mesh.userData.kind==='ceiling'?style.color:0xffffff);m.opacity=style.opacity;m.transparent=style.transparent;m.depthWrite=style.depthWrite;m.forceSinglePass=true;m.needsUpdate=true;
    mesh.children.forEach(e=>{e.visible=state.edges;e.material.color.setHex(style.edgeColor);e.material.opacity=style.edgeOpacity;e.material.transparent=style.edgeOpacity<1;e.material.needsUpdate=true;e.renderOrder=style.target?210:focus?400:210;});
  }
  $('#tile-focus-toggle').disabled=state.view!=='3d';$('#tile-focus-toggle').setAttribute('aria-pressed',state.tileFocus);$('#model-canvas').dataset.tileFocus=String(focus);
  $('#ceiling-toggle').disabled=state.view!=='3d';$('#ceiling-toggle').setAttribute('aria-pressed',state.ceilingVisible);$('#model-canvas').dataset.ceilingVisible=String(state.view==='3d'&&state.ceilingVisible);
  $('#context-transparency').disabled=!context&&!focus;$('#context-transparency-control').classList.toggle('disabled',!context&&!focus);
  $('#context-transparency').value=transparency;$('#context-transparency-value').value=transparency+'%';$('#context-transparency').setAttribute('aria-valuetext',transparency+'% 透明');
  $('#global-dimension-control').hidden=context&&state.section===2;
  $('#cabinet-controls').hidden=state.section!==2;$('#floor2-controls').hidden=!secondFloor;$('#floor2-tile-group-controls').hidden=!secondFloor;$('.model-options').classList.toggle('section2',state.section===2);$('.model-options').classList.toggle('section3',secondFloor);
  $('#floor2-hard-visible').checked=state.floor2HardVisible;$('#floor2-soft-visible').checked=state.floor2SoftVisible;
  for(const [id,visible] of [['cabinet-visible',state.cabinetVisible],['cabinet-dimensions',state.cabinetDimensions],['cabinet-doors',state.cabinetDoorsVisible],['wall-cabinet-visible',state.wallCabinetVisible],['wall-cabinet-dimensions',state.wallCabinetDimensions],['wall-cabinet-doors',state.wallCabinetDoorsVisible]])$('#'+id).checked=visible;
  $('#cabinet-transparency').value=state.cabinetTransparency;$('#cabinet-transparency-value').value=state.cabinetTransparency+'%';$('#cabinet-transparency').setAttribute('aria-valuetext',state.cabinetTransparency+'% 透明');
  syncAllRanges();
  $('#model-canvas').dataset.doorsVisible=String(state.cabinetDoorsVisible||state.wallCabinetDoorsVisible);
  $('#model-canvas').dataset.cabinetTransparency=String(state.cabinetTransparency);
  $('#edges-toggle').setAttribute('aria-pressed',state.edges);
  $('#socket-highlight-control').hidden=state.section===2;$('#socket-highlight-toggle').checked=Boolean(state.socketHighlights[state.section]);
  $('#direction').hidden=state.view!=='elevation';$('#model-thumbnail').hidden=state.view!=='elevation';
  annotationLayoutDirty=true;
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===state.view&&!(button.dataset.view==='3d'&&state.perspectivePreset);button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  const presetActive=state.view==='3d'&&Boolean(state.perspectivePreset);$('#camera-preset-toggle').hidden=state.section!==2;$('#camera-preset-2-toggle').hidden=state.section!==2;$('#camera-preset-toggle').classList.toggle('active',presetActive&&state.perspectivePreset==='Camera_01');$('#camera-preset-toggle').setAttribute('aria-pressed',presetActive&&state.perspectivePreset==='Camera_01');$('#camera-preset-2-toggle').classList.toggle('active',presetActive&&state.perspectivePreset==='Camera_02');$('#camera-preset-2-toggle').setAttribute('aria-pressed',presetActive&&state.perspectivePreset==='Camera_02');
  const directionName=$('#direction').selectedOptions[0].textContent;
  $('#mode-label').textContent=state.view==='3d'?(state.perspectivePreset==='Camera_02'?'吊柜透视尺寸':state.perspectivePreset==='Camera_01'?'橱柜透视尺寸':secondFloor?'透视 · 二楼':context?'透视 · 橱柜吊柜区':focus?'透视 · 铺贴突出显示':'透视 · 3D'):state.view==='top'?'正交 · 顶视':`正交 · ${directionName}`;
  const visibleBase=new Set(meshEntries.filter(e=>e.mesh.visible&&e.mesh.userData.section===1).map(e=>e.name));const visibleCabinets=new Set(meshEntries.filter(e=>e.mesh.visible&&e.mesh.userData.section>1).map(e=>e.name));
  $('#model-canvas').dataset.view=state.view;$('#model-canvas').dataset.section=String(state.section);$('#model-canvas').dataset.visibleBase=String(visibleBase.size);$('#model-canvas').dataset.visibleCabinets=String(visibleCabinets.size);$('#model-canvas').dataset.loaded='section'+state.section;
  $('#model-hint').textContent=state.view==='3d'?'拖拽旋转 · 滚轮缩放 · 右键平移 · 手机轻点放大':'滚轮缩放 · 右键平移 · 手机轻点放大';
}
function resizeModel(){if(!renderer||!modelBounds)return;const host=$('#model-canvas');if(!host.clientWidth||!host.clientHeight)return;renderer.setSize(host.clientWidth,host.clientHeight,false);frameCamera();updateThumbnail();annotationLayoutDirty=true;}
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
  if(state.section!==2)return;
  state.view='3d';state.perspectivePreset=name;
  if(name==='Camera_02'){
    state.cabinetVisible=false;state.cabinetDimensions=false;state.cabinetDoorsVisible=false;
    state.wallCabinetVisible=true;state.wallCabinetDimensions=true;state.wallCabinetDoorsVisible=true;
    state.cabinetTransparency=0;state.baseTransparency=100;
  }else{
    state.cabinetVisible=true;state.cabinetDimensions=true;state.cabinetDoorsVisible=false;
    state.wallCabinetVisible=false;state.wallCabinetDimensions=false;state.wallCabinetDoorsVisible=false;
    state.cabinetTransparency=70;state.baseTransparency=100;
  }
  applyPresentation();renderModelLabels();frameCamera();
}

function renderModelLabels(){
  const host=$('#model-annotations');host.replaceChildren();labels=[];lineSvg=element('svg',{'aria-hidden':'true'});host.append(lineSvg);if(state.section===1&&!state.dimensions)return;
  const sourceDimensions=state.section===1?data.dimensions:visibleDimensions();
  const cameraDimensions=sourceDimensions;
  const dimensions=state.view==='top'?dedupeTopViewDimensions(cameraDimensions):cameraDimensions.filter(d=>dimensionVisible(d,state.view,state.direction));
  for(const d of dimensions){
    const fixed=Boolean(d.fixed)||d.id.includes('固定尺寸');const label=document.createElement('span');label.className='model-label'+(d.value<.1?' short-dimension':'')+(fixed?' fixed-dimension':'')+(state.selectedRuler===d.id?' selected':'');label.textContent=mm(d.value*1000)+' mm';label.setAttribute('aria-label',d.id+' '+label.textContent);label.title=d.id;host.append(label);
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
  const marker=element('marker',{id:'v2-arrow',markerWidth:5,markerHeight:5,refX:4.5,refY:2.5,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});marker.append(element('path',{d:'M0 .3L4.6 2.5L0 4.7Z',fill:'#536171'}));const shortMarker=element('marker',{id:'v2-arrow-short',markerWidth:5,markerHeight:5,refX:4.5,refY:2.5,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});shortMarker.append(element('path',{d:'M0 .3L4.6 2.5L0 4.7Z',fill:'#b6ef79'}));const zMarker=element('marker',{id:'v2-arrow-z',markerWidth:5,markerHeight:5,refX:4.5,refY:2.5,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});zMarker.append(element('path',{d:'M0 .3L4.6 2.5L0 4.7Z',fill:'#55b9e8'}));const fixedMarker=element('marker',{id:'v2-arrow-fixed',markerWidth:5,markerHeight:5,refX:4.5,refY:2.5,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});fixedMarker.append(element('path',{d:'M0 .3L4.6 2.5L0 4.7Z',fill:'#b66a70'}));const defs=element('defs');defs.append(marker,shortMarker,zMarker,fixedMarker);lineSvg.append(defs);
  for(const entry of labels){const {a,b,d,button}=entry,pa=project(a),pb=project(b),mid=a.clone().add(b).multiplyScalar(.5);const span=Math.hypot(pa.x-pb.x,pa.y-pb.y);button.hidden=Boolean(entry.mergedInto)||pa.z< -1||pa.z>1||pb.z< -1||pb.z>1||span<4;if(button.hidden)continue;
    button.dataset.calloutSide=String(entry.calloutSide||0);button.dataset.dimensionValue=String(d.value);
    if(entry.calloutSide)button.dataset.calloutDistanceMm='50';else delete button.dataset.calloutDistanceMm;
    const fixed=Boolean(d.fixed)||d.id.includes('固定尺寸');const arrow=fixed?'url(#v2-arrow-fixed)':d.axis==='Z'?'url(#v2-arrow-z)':d.value<.1?'url(#v2-arrow-short)':'url(#v2-arrow)';const line=element('line',{x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y,'data-dimension-id':d.id,class:'dimension-line'+(d.axis==='Z'?' axis-z':'')+(fixed?' fixed-dimension':'')+(d.value<.1?' short-callout':' inline')+(state.selectedRuler===d.id?' selected':''),'marker-start':arrow,'marker-end':arrow});lineSvg.append(line);
    const p=project(entry.anchor||mid),scale=1;
    const angle=entry.inlineRotation?` rotate(${entry.inlineRotation}deg)`:'';
    button.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%)${angle} scale(${scale})`;button.dataset.anchor=(entry.anchor||mid).toArray().join(',');
    if(d.value<.1&&entry.calloutSide){
      const normal=entry.leaderNormal||{x:0,y:1};
      const edgeDistance=Math.min((button.offsetWidth*scale/2+3)/Math.max(.001,Math.abs(normal.x)),(button.offsetHeight*scale/2+3)/Math.max(.001,Math.abs(normal.y)));
      lineSvg.append(element('line',{x1:(pa.x+pb.x)/2,y1:(pa.y+pb.y)/2,
        x2:p.x-normal.x*edgeDistance,y2:p.y-normal.y*edgeDistance,'data-dimension-id':d.id,'data-gap-mm':'50',class:'dimension-leader'+(d.axis==='Z'?' axis-z':'')+(fixed?' fixed-dimension':'')}));
    }
  }
}
function updateThumbnail(){
  if(!model)return;const host=$('#model-thumbnail');if(!previewRenderer){previewRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true});previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.append(previewRenderer.domElement);}
  const preview=new THREE.Scene();
  // Fat socket highlight lines use instanced line geometry, which is not part
  // of the thumbnail and cannot be cloned by Three.js' ordinary Object3D clone.
  const socketHighlights=[];model.traverse(o=>{if(o.userData.socketHighlight){socketHighlights.push([o,o.parent]);o.parent?.remove(o);}});
  const copy=model.clone(true);for(const [object,parent] of socketHighlights)parent?.add(object);
  copy.traverse(o=>{if(o.userData.socketHighlight)o.visible=false;if(o.isMesh)o.material=new THREE.MeshBasicMaterial({color:0xbacde4,side:THREE.DoubleSide,...surfaceDepth('hard',Math.max(0,data.objects.indexOf(sourceName(o))),data.objects.length)});else if(o.isLine){o.material=o.material.clone();}});preview.add(copy);
  previewCamera=previewCamera||new THREE.OrthographicCamera();const size=modelBounds.getSize(new THREE.Vector3()),center=modelBounds.getCenter(new THREE.Vector3()),half=Math.max(size.x,size.z)/2*1.08;
  Object.assign(previewCamera,{left:-half,right:half,top:half,bottom:-half,near:.01,far:100});previewCamera.up.set(0,0,-1);previewCamera.position.copy(center).add(new THREE.Vector3(0,20,0));previewCamera.lookAt(center);fitDepthRange(previewCamera,modelBounds);previewCamera.updateProjectionMatrix();const width=mobile.matches?92:140;previewRenderer.setSize(width,width,false);previewRenderer.render(preview,previewCamera);copy.traverse(o=>{if(o.isMesh||o.isLine)o.material.dispose();});
}

let drawView,initialDrawView,dragStart;
function renderDrawing(){
  const s=currentSurface(),svg=$('#tile-drawing');if(!svg.clientWidth||!svg.clientHeight)return;svg.replaceChildren();const edgeMap=tileSurfaceEdges(s),rawBounds=drawingBounds(s.tiles),rawCenterX=(rawBounds.minX+rawBounds.maxX)/2,rawCenterY=(rawBounds.minY+rawBounds.maxY)/2;
  const transformPoint=point=>{let x=point[0],y=s.flipY?point[1]:-point[1];const cx=rawCenterX,cy=s.flipY?rawCenterY:-rawCenterY;if(s.rotateDeg){const angle=THREE.MathUtils.degToRad(s.rotateDeg),dx=x-cx,dy=y-cy;x=cx+dx*Math.cos(angle)-dy*Math.sin(angle);y=cy+dx*Math.sin(angle)+dy*Math.cos(angle);}if(s.flipX)x=rawBounds.minX+rawBounds.maxX-x;if(s.flipAfterY)y=2*cy-y;return [x*1000,y*1000];};
  const displayTiles=mergeTileFacesForDisplay(s),transformed=displayTiles.flatMap(tile=>tile.polygon.map(transformPoint));const bounds={minX:Math.min(...transformed.map(p=>p[0]))/1000,maxX:Math.max(...transformed.map(p=>p[0]))/1000,minY:Math.min(...transformed.map(p=>p[1]))/1000,maxY:Math.max(...transformed.map(p=>p[1]))/1000};const width=(bounds.maxX-bounds.minX)*1000,height=(bounds.maxY-bounds.minY)*1000;
  const pad=Math.max(260,Math.max(width,height)*.065),hostRatio=svg.clientWidth/svg.clientHeight;let vw=width+pad*2,vh=height+pad*2;if(vw/vh<hostRatio)vw=vh*hostRatio;else vh=vw/hostRatio;
  initialDrawView={x:bounds.minX*1000+width/2-vw/2,y:bounds.minY*1000+height/2-vh/2,w:vw,h:vh};drawView={...initialDrawView};setDrawingView();
  const title=element('title');title.textContent=s.name+'，单位毫米';svg.append(title);
  const hatchDefs=element('defs'),planHatch=element('pattern',{id:'tile-hatch-pattern',width:50,height:50,patternUnits:'userSpaceOnUse'});
  planHatch.append(element('rect',{width:50,height:50,fill:'#fbfcfd'}),element('path',{d:'M-50 50L50 -50M0 100L100 0M50 150L150 50',fill:'none',stroke:'#d6dfe8','stroke-width':2.4}));
  hatchDefs.append(planHatch);svg.append(hatchDefs);
  for(const tile of displayTiles){
    const selected=(tile.sourceFaceIds||[tile.id]).includes(state.selectedTile);
    const cuttingClass=tile.cuttingClass||(tile.oversize?'review':tile.rectangle&&Math.abs(tile.areaM2-(s.nominalMm[0]*s.nominalMm[1]/1000000))<.00001?'full':'cut');
    const faceLabel=tile.id,primaryTileId=tile.id;
    const polygon=element('polygon',{points:tile.polygon.map(p=>transformPoint(p).join(',')).join(' '),class:`tile-piece ${s.kind||'floor'} ${cuttingClass}${tile.rectangle?'':' irregular'}${tile.oversize?' oversize':''}${selected?' selected':''}`,'data-tile':primaryTileId,tabindex:0,role:'button','aria-label':`${faceLabel} ${mm(tile.widthMm)}乘${mm(tile.heightMm)}毫米 ${cuttingClass==='full'?'整面':cuttingClass==='cut'?'切割面':'待核对'}`});
    const title=element('title');title.textContent=`${faceLabel} · ${mm(tile.widthMm)} × ${mm(tile.heightMm)} mm · ${cuttingClass==='full'?'整面':cuttingClass==='cut'?'切割面':'待核对'}${tile.rectangle?'':'（异形包络）'}`;polygon.append(title);svg.append(polygon);
    const edgePath=element('path',{class:`drawing-tile-edge${selected?' selected':''}`,'data-tile-edge':tile.id});let edgePathData='';
    for(let i=0;i<tile.polygon.length;i++){const a=transformPoint(tile.polygon[i]),b=transformPoint(tile.polygon[(i+1)%tile.polygon.length]);edgePathData+=`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;}
    edgePath.setAttribute('d',edgePathData);svg.append(edgePath);
    polygon.addEventListener('click',()=>selectTile(primaryTileId));polygon.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectTile(primaryTileId);}});
    const labelPoint=transformPoint(tile.polygon.reduce((sum,p)=>[sum[0]+p[0]/tile.polygon.length,sum[1]+p[1]/tile.polygon.length],[0,0]));const [cx,cy]=labelPoint;
    const font=Math.min(75,Math.max(28,Math.min(tile.widthMm/7.8,tile.heightMm/3)));
    const group=element('g',{class:'tile-label-group','data-label':tile.id});
    const code=element('text',{x:cx,y:cy-font*.64,'font-size':font*.9,class:'tile-label tile-code'});code.textContent=faceLabel;group.append(code);
    const size=element('text',{x:cx,y:cy+font*.64,'font-size':font,class:'tile-label tile-measurement'});size.textContent=`${mm(tile.widthMm)} × ${mm(tile.heightMm)}`;group.append(size);svg.append(group);
  }
  const top=bounds.minY*1000-90,left=bounds.minX*1000-90,right=bounds.maxX*1000,bottom=bounds.maxY*1000;
  const lineTop=element('path',{d:`M${left+90} ${top+30}V${top-30}M${left+90} ${top}H${right}M${right} ${top+30}V${top-30}`,class:'drawing-outline'});svg.append(lineTop);
  const widthLabel=element('text',{x:(left+90+right)/2,y:top-70,class:'drawing-dimension'});widthLabel.textContent=mm(width)+' mm';widthLabel.setAttribute('font-size',Math.max(65,Math.max(width,height)*.014));svg.append(widthLabel);
  const yTop=bounds.minY*1000,yBottom=bounds.maxY*1000;
  const lineSide=element('path',{d:`M${left-30} ${yTop}H${left+30}M${left} ${yTop}V${yBottom}M${left-30} ${yBottom}H${left+30}`,class:'drawing-outline'});svg.append(lineSide);
  const heightLabel=element('text',{x:left-85,y:(yTop+yBottom)/2,class:'drawing-dimension',transform:`rotate(-90 ${left-85} ${(yTop+yBottom)/2})`});heightLabel.textContent=mm(height)+' mm';heightLabel.setAttribute('font-size',Math.max(65,Math.max(width,height)*.014));svg.append(heightLabel);
  $('#drawing-caption').textContent=`${s.name} · ${s.axes.join(' / ')} 方向 · mm`;
  const cut=state.section===3?data.floor2CuttingPlans?.[state.floor2TileType]:data.cuttingPlans?.[s.id];
  $('#surface-spec').textContent=`标称 ${s.nominalMm.join(' × ')} mm · ${s.tiles.length} 块面 · 净面积 ${areaM2(s.areaM2)} m²${cut?` · 整面 ${cut.fullTilePieces??cut.fullTiles} · 切割面 ${cut.cutTilePieces??cut.cutPieces} · 理论下限 ${cut.theoreticalMinimumTiles} · 建议用砖 ${cut.estimatedStockTiles} 块`:''}`;
  $('#schedule-context').textContent=`当前区域 ${s.tiles.length} 块面，尺寸单位为毫米；编号可在图中定位。`;
  updateDrawingLabels();renderTileTable();updateTileDetail();
}
function setDrawingView(){if(drawView)$('#tile-drawing').setAttribute('viewBox',`${drawView.x} ${drawView.y} ${drawView.w} ${drawView.h}`);}
function zoomDrawing(factor,ratio={x:.5,y:.5}){const newW=drawView.w*factor,newH=drawView.h*factor;if(newW<initialDrawView.w*.12||newW>initialDrawView.w*4)return;drawView={x:drawView.x+(drawView.w-newW)*ratio.x,y:drawView.y+(drawView.h-newH)*ratio.y,w:newW,h:newH};setDrawingView();}
function updateDrawingLabels(){const show=$('#tile-label-toggle').checked;$('#tile-drawing').querySelectorAll('.tile-label-group').forEach(g=>g.style.display=show?'':'none');}
function renderCuttingPlan(){
  const section=$('#original-cutting');if(!section)return;
  const surface=currentSurface(),secondFloor=state.section===3;
  const plan=secondFloor?data.floor2FloorCuttingPlans?.[state.floor2TileType]:data.cuttingPlans?.[surface.id],grid=$('#cutting-plan-grid');
  section.hidden=state.section===2||!plan;if(section.hidden||!grid)return;
  const stockW=plan.stockMm[0],stockH=plan.stockMm[1],pieceMap=new Map((secondFloor?data.floor2Surfaces:[surface]).flatMap(s=>s.tiles).map(tile=>[tile.id,tile]));
  section.querySelector('.eyebrow').textContent=secondFloor?'04 / 原砖切割图':'03 / 原砖切割图';
  $('#cutting-title').textContent=`原砖切割排版图 · ${stockW} × ${stockH} mm`;
  $('#cutting-summary').textContent=`${secondFloor?'地砖':surface.name} · 已排 ${plan.stocks.length} 块原砖 · 建议备料 ${plan.estimatedStockTiles} 块 · 整面 ${plan.fullTilePieces??plan.fullTiles} · 切割面 ${plan.cutTilePieces??plan.cutPieces} · 理论下限 ${plan.theoreticalMinimumTiles}`;
  const unplaced=$('#cutting-unplaced');unplaced.hidden=!plan.unplaced?.length;unplaced.textContent=plan.unplaced?.length?`待复核、未放入原砖的块面（尺寸超过 ${stockW} × ${stockH} mm）：${plan.unplaced.join('、')}`:'';
  grid.replaceChildren();
  const page=document.createElement('div');page.className='cutting-page';
  const pageTitle=document.createElement('div');pageTitle.className='cutting-page-title';pageTitle.textContent=`${stockW} × ${stockH} mm · 原砖切割图`;page.append(pageTitle);
  const pageGrid=document.createElement('div');pageGrid.className='cutting-page-grid';page.append(pageGrid);grid.append(page);
  const isWholeStock=stock=>stock.placements.length===1&&pieceMap.get(stock.placements[0].id)?.cuttingClass==='full'&&Math.abs(stock.placements[0].x)<.01&&Math.abs(stock.placements[0].y)<.01&&Math.abs(stock.placements[0].w-stockW)<.01&&Math.abs(stock.placements[0].h-stockH)<.01;
  const wholeStocks=plan.stocks.filter(isWholeStock),cutStocks=plan.stocks.filter(stock=>!isWholeStock(stock));
  pageGrid.style.setProperty('--cutting-rows',Math.max(5,Math.ceil((cutStocks.length+(wholeStocks.length?1:0))/8)));
  {
    const card=document.createElement('article');card.className='cutting-plan-card full-tile-summary'+(wholeStocks.length?'':' empty-full-tile-summary');
    const wholeIds=wholeStocks.map(stock=>stock.placements[0].id);card.dataset.tileIds=wholeIds.join(',');card.title=`完整瓷砖对应铺贴序号：${wholeIds.join('、')}`;
    const heading=document.createElement('h3');heading.textContent=`完整瓷砖 × ${wholeStocks.length}`;card.append(heading);
    if(wholeStocks.length){
      const svg=element('svg',{viewBox:`-24 -24 ${stockW+48} ${stockH+48}`,role:'img','aria-label':`完整瓷砖，共${wholeStocks.length}块`});
      const title=element('title');title.textContent=card.title;svg.append(title);
      svg.append(element('rect',{x:0,y:0,width:stockW,height:stockH,class:'stock-sheet'}));
      card.append(svg);
    }else{const empty=document.createElement('p');empty.textContent='当前排版没有整砖，全部为切割面。';card.append(empty);}
    pageGrid.append(card);
  }
  cutStocks.forEach((stock,index)=>{
    const card=document.createElement('article');card.className='cutting-plan-card';
    const heading=document.createElement('h3');heading.textContent=`原砖 ${String(index+1).padStart(2,'0')}`;card.append(heading);
    const svg=element('svg',{viewBox:`-24 -24 ${stockW+48} ${stockH+48}`,role:'img','aria-label':`切割砖 ${index+1}，${stockW}乘${stockH}毫米`});
    const defs=element('defs');svg.append(defs);
    const remainderId=`stock-remainder-${index}`,remainderPattern=element('pattern',{id:remainderId,width:44,height:44,patternUnits:'userSpaceOnUse'});
    remainderPattern.append(element('rect',{width:44,height:44,fill:'#fbf4e8'}),element('circle',{cx:22,cy:22,r:3.5,fill:'#bca17b'}));defs.append(remainderPattern);
    const outlines=stock.placements.map(placement=>cuttingOutline(pieceMap.get(placement.id),placement,stockH));
    svg.append(element('path',{d:stockRemainderPath(stockW,stockH,outlines),fill:`url(#${remainderId})`,'fill-rule':'evenodd',class:'cutting-remainder','aria-label':'切割后剩余砖料'}));
    svg.append(element('rect',{x:0,y:0,width:stockW,height:stockH,class:'stock-sheet'}));
    stock.placements.forEach((placement,pieceIndex)=>{
      const tile=pieceMap.get(placement.id),kind=tile?.cuttingClass||'cut';
      if(kind==='cut'){
        const patternId=`cut-hatch-${index}-${pieceIndex}`;
        const offsetX=(index*11+pieceIndex*7)%34,offsetY=(index*5+pieceIndex*13)%34;
        const pattern=element('pattern',{id:patternId,width:34,height:34,patternUnits:'userSpaceOnUse',patternTransform:`translate(${offsetX} ${offsetY})`});
        pattern.append(element('path',{d:'M-17 17L17 -17M0 34L34 0M17 51L51 17',fill:'none',stroke:'#b7c8d9','stroke-width':2,'stroke-opacity':.58}));
        defs.append(pattern);
        svg.append(element('polygon',{points:outlines[pieceIndex].map(p=>p.join(',')).join(' '),fill:`url(#${patternId})`,class:'cutting-piece-fill','aria-hidden':'true'}));
      }
      const rect=element('polygon',{points:outlines[pieceIndex].map(p=>p.join(',')).join(' '),class:`cutting-piece ${kind}`,'data-tile-id':placement.id});
      const label=element('text',{x:placement.x+placement.w/2,y:stockH-placement.y-placement.h/2,class:'cutting-piece-label'});label.textContent=placement.id;svg.append(rect,label);
    });
    card.append(svg);pageGrid.append(card);
  });
  const legend=document.createElement('div');legend.className='cutting-legend';legend.setAttribute('aria-label','原砖切割图填充图例');
  for(const [kind,text] of [['whole','完整瓷砖'],['piece','切割块面'],['remainder','余砖 / 余料']]){
    const item=document.createElement('span'),swatch=document.createElement('i');swatch.className=`cutting-swatch ${kind}`;swatch.setAttribute('aria-hidden','true');item.append(swatch,document.createTextNode(text));legend.append(item);
  }
  page.append(legend);
}
function selectSurface(id){state.surface=id;state.selectedTile=currentSurface().tiles[0].id;$('#surface-select').value=id;$('#tile-search').value='';renderDrawing();renderCuttingPlan();}
function floor2TileLabel(kind){
  const options=data.floor2Surfaces?.filter(surface=>surface.tileGroup===kind)||[];
  return options[0]?.nominalMm?.join('×')||kind;
}
function selectFloor2TileType(kind){
  const options=data.floor2Surfaces.filter(surface=>surface.tileGroup===kind).sort((a,b)=>Number(b.kind==='floor')-Number(a.kind==='floor'));
  if(!options.length)return;
  state.floor2TileType=kind;
  document.querySelectorAll('[data-tile-type]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tileType===kind)));
  const picker=$('#surface-select');picker.hidden=options.length<2;
  $('.surface-label').hidden=options.length<2;
  picker.replaceChildren(...options.map(surface=>{const option=document.createElement('option');option.value=surface.id;option.textContent=surface.name;return option;}));
  const count=options.reduce((sum,surface)=>sum+surface.tiles.length,0),tag=document.createElement('span');tag.textContent=`${options[0].nominalMm.join(' × ')} · ${count} 块面`;
  $('#layout-counts').replaceChildren(tag);
  $('#layout-title').textContent=`二楼瓷砖铺贴平面图 · ${floor2TileLabel(kind)}`;
  selectSurface(options[0].id);if(model)applyPresentation();
}
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
  $('#ruler-schedule').replaceChildren(...data.dimensions.map(d=>{const tr=document.createElement('tr');tr.dataset.ruler=d.id;tr.tabIndex=0;tr.classList.toggle('selected',state.selectedRuler===d.id);tr.classList.toggle('fixed-dimension',Boolean(d.fixed)||d.id.includes('固定尺寸'));const mid=d.endpoints[0].map((v,i)=>(v+d.endpoints[1][i])*500);for(const v of[d.id,d.axis+' 轴',mm(d.value*1000),mid.map(mm).join(' / ')]){const td=document.createElement('td');td.textContent=v;tr.append(td);}tr.addEventListener('click',()=>selectRuler(d.id,true));tr.addEventListener('keydown',e=>{if(e.key==='Enter')selectRuler(d.id,true);});return tr;}));
}
function selectRuler(id,scroll){state.selectedRuler=state.selectedRuler===id?null:id;const d=data.dimensions.find(d=>d.id===id);if(state.selectedRuler){if(d.zone==='cabinet'){state.cabinetVisible=true;state.cabinetDimensions=true;}else if(d.zone==='wall-cabinet'){state.wallCabinetVisible=true;state.wallCabinetDimensions=true;}if(!dimensionVisible(d,state.view,state.direction))state.view='3d';}$('#dimension-toggle').checked=true;state.dimensions=true;applyPresentation();renderModelLabels();renderRulerTable();frameCamera();if(scroll)$('#space').scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'});}
function setSection(section){
  if(!model)return;
  if(![1,2,3].includes(section))return;
  state.section=section;state.selectedRuler=null;state.view='3d';state.perspectivePreset=section===2?'Camera_01':null;activateAnnotationSection();
  if(section===2){
    state.cabinetVisible=true;state.cabinetDimensions=true;state.cabinetDoorsVisible=false;
    state.wallCabinetVisible=false;state.wallCabinetDimensions=false;state.wallCabinetDoorsVisible=false;
    state.cabinetTransparency=70;state.baseTransparency=100;
  }else if(section===3){
    state.cabinetTransparency=70;state.baseTransparency=0;state.floor2HardVisible=true;state.floor2SoftVisible=false;state.floor2Transparency=0;state.floor2TileType='1200';
  }else{state.cabinetTransparency=70;state.baseTransparency=75;}
  const sectionName=section===1?'板块一':section===2?'橱柜吊柜区':'二楼';
  const sectionLabel=section===1?'硬装与铺贴':section===2?'橱柜区与吊柜区':'硬装与软装';
  data.dimensions=sectionDimensions(section);data.section=sectionName;data.surfaces=section===3?(data.floor2Surfaces||[]):section1Surfaces;
  $('#surface-select').hidden=section===3;
  $('.tile-type-switch').hidden=section!==3;
  document.querySelectorAll('button[data-section]').forEach(button=>{const active=Number(button.dataset.section)===section;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  document.title=`O.家庭装修 V.1.15 · ${section===1?'一楼硬装':section===2?'厨房橱柜、吊柜':'二楼硬装'}`;
  $('#layout').hidden=section===2;document.querySelector('nav a[href="#layout"]').hidden=section===2;$('#original-cutting').hidden=section===2;
  if(section===3)selectFloor2TileType('1200');else if(section===1)selectSurface('floor');
  $('#layout-title').textContent=section===3?`二楼瓷砖铺贴平面图 · ${floor2TileLabel(state.floor2TileType)}`:'铺贴排版平面图';$('#layout .section-heading .eyebrow').textContent=section===3?'03 / 独立排版图':'02 / 独立排版图';
  $('.model-options').classList.toggle('section2',section===2);$('.model-options').classList.toggle('section3',section===3);
  $('.settings-primary').hidden=section>1;
  $('#context-transparency-control>span').textContent=section===1?'其余模型透明度':section===2?'一楼硬装透明度':'二楼模型透明度';
  $('#context-transparency').value=section===3?state.floor2Transparency:section===2?state.baseTransparency:state.contextTransparency;$('#context-transparency-value').value=$('#context-transparency').value+'%';
  $('#context-transparency-help').textContent=section===1?'0% 为不透明，100% 为完全透明，仅在 3D 突出铺贴时生效':'0% 为不透明，100% 为完全透明，所有视图生效';
  $('#measurement-title').textContent=section===1?'硬装尺寸':section===2?'橱柜吊柜尺寸':'二楼尺寸';
  $('#measurements .section-description').textContent=section===3&&!data.floor2Dimensions?.length?'二楼集合中没有单独的尺寸标尺。':`以下为源工程中的${sectionLabel}标尺；点击一行在模型中高亮。顶视只显示 X、Y 方向且不小于 100 mm 的尺寸。`;
  $('#model-canvas').setAttribute('aria-label',section===1?'一楼硬装三维视图':section===2?'橱柜吊柜区与一楼硬装三维视图':'二楼模型三维视图');
  document.querySelector('.site-footer>span').textContent=`O.家庭装修 / ${data.section} · V.1.15`;
  const url=new URL(location);if(section===1)url.searchParams.delete('section');else url.searchParams.set('section',section);history.replaceState(null,'',url);
  applyPresentation();renderModelLabels();renderRulerTable();frameCamera();updateThumbnail();
}

function bindEvents(){
  document.querySelectorAll('button[data-section]').forEach(button=>button.addEventListener('click',()=>setSection(Number(button.dataset.section))));
  for(const [id,key] of [['cabinet-visible','cabinetVisible'],['cabinet-dimensions','cabinetDimensions'],['cabinet-doors','cabinetDoorsVisible'],['wall-cabinet-visible','wallCabinetVisible'],['wall-cabinet-dimensions','wallCabinetDimensions'],['wall-cabinet-doors','wallCabinetDoorsVisible']])$('#'+id).addEventListener('change',e=>{state[key]=e.target.checked;applyPresentation();if(id.endsWith('dimensions'))renderModelLabels();if(id.endsWith('visible'))frameCamera();});
  $('#cabinet-transparency').addEventListener('input',e=>{syncRangeVisual(e.target);state.cabinetTransparency=Number(e.target.value);applyPresentation();});
  $('#socket-highlight-toggle').addEventListener('change',e=>{state.socketHighlights[state.section]=e.target.checked;applyPresentation();});
  $('#ceiling-toggle').addEventListener('click',()=>{state.ceilingVisible=!state.ceilingVisible;applyPresentation();});
  $('#tile-focus-toggle').addEventListener('click',()=>{state.tileFocus=!state.tileFocus;applyPresentation();frameCamera();});
  $('#context-transparency').addEventListener('input',e=>{syncRangeVisual(e.target);if(state.section===3)state.floor2Transparency=Number(e.target.value);else if(state.section===2)state.baseTransparency=Number(e.target.value);else state.contextTransparency=Number(e.target.value);applyPresentation();});
  $('#floor2-hard-visible').addEventListener('change',e=>{state.floor2HardVisible=e.target.checked;applyPresentation();frameCamera();});
  $('#floor2-soft-visible').addEventListener('change',e=>{state.floor2SoftVisible=e.target.checked;applyPresentation();frameCamera();});
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));$('#camera-preset-toggle').addEventListener('click',setPerspectiveView);$('#camera-preset-2-toggle').addEventListener('click',setPerspectiveView2);$('#direction').addEventListener('change',e=>{state.direction=e.target.value;setView('elevation');});
$('#edges-toggle').addEventListener('click',()=>{state.edges=!state.edges;applyPresentation();});$('#dimension-toggle').addEventListener('change',e=>{state.dimensions=e.target.checked;renderModelLabels();});$('#reset-camera').addEventListener('click',frameCamera);$('#retry').addEventListener('click',()=>location.reload());
  $('#surface-select').addEventListener('change',e=>selectSurface(e.target.value));$('#tile-search').addEventListener('input',renderTileTable);$('#tile-label-toggle').addEventListener('change',updateDrawingLabels);
  document.querySelectorAll('[data-tile-type]').forEach(button=>button.addEventListener('click',()=>selectFloor2TileType(button.dataset.tileType)));
  $('#drawing-in').addEventListener('click',()=>zoomDrawing(.8));$('#drawing-out').addEventListener('click',()=>zoomDrawing(1.25));$('#drawing-reset').addEventListener('click',()=>{drawView={...initialDrawView};setDrawingView();});
  const svg=$('#tile-drawing');svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoomDrawing(e.deltaY>0?1.12:1/1.12,{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});},{passive:false});
  svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragStart={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...drawView},moved:false};});svg.addEventListener('pointermove',e=>{if(!dragStart||dragStart.id!==e.pointerId)return;const dx=e.clientX-dragStart.x,dy=e.clientY-dragStart.y;if(Math.hypot(dx,dy)>5){dragStart.moved=true;svg.setPointerCapture(e.pointerId);}if(!dragStart.moved)return;const r=svg.getBoundingClientRect();drawView={...dragStart.view,x:dragStart.view.x-dx/r.width*dragStart.view.w,y:dragStart.view.y-dy/r.height*dragStart.view.h};setDrawingView();});svg.addEventListener('pointerup',()=>dragStart=null);svg.addEventListener('pointercancel',()=>dragStart=null);
  $('#download-csv').addEventListener('click',()=>saveFile(scheduleCsv(state.section>1?{...data,surfaces:[]}:data),'text/csv;charset=utf-8',`${data.section}_全部尺寸_2.0.csv`));
  $('#annotation-mode').addEventListener('click',event=>{annotationPlacement=!annotationPlacement;event.currentTarget.setAttribute('aria-pressed',String(annotationPlacement));event.currentTarget.textContent=annotationPlacement?'取消标注':'＋ 标注';if(annotationPlacement){annotationEditingId=null;annotationDraft=null;$('#annotation-editor').hidden=true;startAnnotationPlacement();}else{renderer.domElement.classList.remove('placing-annotation');annotationMessage('选点已取消。');}});
  $('#annotation-default-size').addEventListener('input',event=>{syncRangeVisual(event.target);$('#annotation-default-size-value').value=event.target.value;});
  $('#annotation-size').addEventListener('input',event=>{syncRangeVisual(event.target);$('#annotation-size-value').value=event.target.value;});
  $('#annotation-editor-close').addEventListener('click',()=>{$('#annotation-editor').hidden=true;annotationEditingId=null;annotationDraft=null;});
  $('#annotation-reposition').addEventListener('click',()=>{$('#annotation-editor').hidden=true;startAnnotationPlacement();});
  $('#annotation-delete').addEventListener('click',()=>{if(!annotationEditingId||!confirm('删除这条本机标注？'))return;sharedAnnotations=sharedAnnotations.filter(item=>item.id!==annotationEditingId);annotationEditingId=null;annotationDraft=null;$('#annotation-editor').hidden=true;persistLocalAnnotations();});
  $('#annotation-export').addEventListener('click',exportAnnotations);
  $('#annotation-editor').addEventListener('submit',event=>{event.preventDefault();if(!annotationDraft){annotationMessage('请先在模型上选择标注位置。',true);return;}const item={id:annotationEditingId||crypto.randomUUID(),modelSha:data.sourceSha256,objectName:annotationDraft.objectName,position:annotationDraft.position,text:$('#annotation-text').value.trim(),note:$('#annotation-note').value.trim(),color:$('#annotation-color').value,fontSize:Number($('#annotation-size').value)};
    if(annotationEditingId)sharedAnnotations=sharedAnnotations.map(existing=>existing.id===annotationEditingId?item:existing);else sharedAnnotations.push(item);annotationEditingId=item.id;persistLocalAnnotations();$('#annotation-editor').hidden=true;annotationPlacement=false;renderer.domElement.classList.remove('placing-annotation');$('#annotation-mode').setAttribute('aria-pressed','false');$('#annotation-mode').textContent='＋ 标注';
  });
  $('#download-svg').addEventListener('click',()=>{const s=currentSurface(),svg=$('#tile-drawing').cloneNode(true);svg.setAttribute('xmlns',ns);svg.setAttribute('width','1600');svg.setAttribute('height','1200');svg.setAttribute('viewBox',`${initialDrawView.x} ${initialDrawView.y} ${initialDrawView.w} ${initialDrawView.h}`);const style=element('style');style.textContent='.tile-piece{fill:url(#tile-hatch-pattern);stroke:none}.drawing-tile-edge{fill:none;stroke:#6f849b;stroke-width:1;vector-effect:non-scaling-stroke}.drawing-tile-edge.selected{stroke:#2265bc;stroke-width:2}.tile-label{font-family:Arial,Microsoft YaHei,sans-serif;fill:#506071;text-anchor:middle;dominant-baseline:middle}.tile-code{font-weight:600}.drawing-outline{fill:none;stroke:#63778d;stroke-width:1;vector-effect:non-scaling-stroke}.drawing-dimension{font-family:Arial,Microsoft YaHei,sans-serif;fill:#536477;text-anchor:middle;dominant-baseline:middle}';svg.prepend(style);saveFile(new XMLSerializer().serializeToString(svg),'image/svg+xml;charset=utf-8',`板块${state.section===3?'三':'一'}_${s.name.replaceAll('/','_')}.svg`);});
  let previousWidth=innerWidth;window.addEventListener('resize',()=>{if(Math.abs(innerWidth-previousWidth)>20){previousWidth=innerWidth;if(data)renderDrawing();}});
}

async function boot(){
  try{
    const response=await fetch('./public/v2/section1.json',{cache:'no-store'});if(!response.ok)throw Error(`尺寸数据读取失败：HTTP ${response.status}`);data=validateSection(await response.json());section1Dimensions=data.dimensions;
    $('#surface-select').replaceChildren(...data.surfaces.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=`${s.name}（${s.tiles.length}）`;return o;}));
    $('#layout-counts').replaceChildren(...data.tileObjects.map(o=>{const s=document.createElement('span');s.textContent=`${o.nominalMm.join(' × ')} · ${o.tileCount??o.faceCount} 块面`;return s;}));
    section1Surfaces=data.surfaces;bindEvents();selectSurface('floor');renderRulerTable();document.body.dataset.ready='section1';
    await setupModel();await loadAnnotations();const requestedSection=Number(new URLSearchParams(location.search).get('section'));if([2,3].includes(requestedSection))setSection(requestedSection);
  }catch(error){console.error(error);$('#model-loading').hidden=true;$('#model-error').hidden=false;$('#error-detail').textContent=error.message;}
}
void boot();




