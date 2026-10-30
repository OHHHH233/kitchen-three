const EDGE_TOLERANCE = 1e-5;

export function tileEdgeKey(a,b){
  const quantize=point=>point.map(value=>Math.round(value/EDGE_TOLERANCE)).join(',');
  return [quantize(a),quantize(b)].sort().join('|');
}

function isCoplanarPair(surface,a,b,depthAxis){
  const aDepth=a.points[0]?.[depthAxis],bDepth=b.points[0]?.[depthAxis];
  if(!Number.isFinite(aDepth)||!Number.isFinite(bDepth)||Math.abs(aDepth-bDepth)>EDGE_TOLERANCE)return false;
  return a.points.every(point=>Math.abs(point[depthAxis]-aDepth)<EDGE_TOLERANCE)&&
    b.points.every(point=>Math.abs(point[depthAxis]-bDepth)<EDGE_TOLERANCE);
}

function isInternalDiagonal(surface,occurrences){
  if(occurrences.length!==2)return false;
  const [a,b]=occurrences;
  if(a.materialIndex!==b.materialIndex||a.sourceObject!==b.sourceObject)return false;
  const depthAxis=surface.axis;
  if(Number.isInteger(depthAxis)&&!isCoplanarPair(surface,a.tile,b.tile,depthAxis))return false;
  const axes=(surface.axes||[]).map(axis=>'XYZ'.indexOf(axis)).filter(axis=>axis>=0);
  if(axes.length!==2)return false;
  const [axisA,axisB]=axes;
  const deltaA=Math.abs(a.a[axisA]-a.b[axisA]);
  const deltaB=Math.abs(a.a[axisB]-a.b[axisB]);
  if(deltaA<=EDGE_TOLERANCE||deltaB<=EDGE_TOLERANCE)return false;
  // Blender may leave a few millimetres of slope on an authored horizontal
  // or vertical grout line. Only edges with balanced projected movement are
  // actual triangulation diagonals.
  return Math.min(deltaA,deltaB)/Math.max(deltaA,deltaB)>0.1;
}

export function tileSurfaceEdges(surface){
  const edges=new Map();
  for(const tile of surface.tiles)for(let i=0;i<tile.polygon.length;i++){
    const a=tile.points[i],b=tile.points[(i+1)%tile.polygon.length],key=tileEdgeKey(a,b);
    const edge=edges.get(key)||{occurrences:[],internalDiagonal:false};
    edge.occurrences.push({tile,a,b,materialIndex:tile.materialIndex,sourceObject:tile.sourceObject});
    edges.set(key,edge);
  }
  for(const edge of edges.values())edge.internalDiagonal=isInternalDiagonal(surface,edge.occurrences);
  return edges;
}

export function keepTileEdge(edgeMap,a,b){
  return !edgeMap.get(tileEdgeKey(a,b))?.internalDiagonal;
}

export function mergeTileFacesForDisplay(surface){
  const tiles=surface.tiles||[],edgeMap=tileSurfaceEdges(surface),parents=tiles.map((_,index)=>index);
  const root=index=>{while(parents[index]!==index){parents[index]=parents[parents[index]];index=parents[index];}return index;};
  for(const edge of edgeMap.values())if(edge.internalDiagonal){const a=tiles.indexOf(edge.occurrences[0].tile),b=tiles.indexOf(edge.occurrences[1].tile);if(a>=0&&b>=0)parents[root(b)]=root(a);}
  const groups=new Map();tiles.forEach((tile,index)=>{const key=root(index),group=groups.get(key)||[];group.push(tile);groups.set(key,group);});
  const axes=(surface.axes||[]).map(axis=>'XYZ'.indexOf(axis)).filter(axis=>axis>=0);
  return [...groups.values()].flatMap(group=>{
    if(group.length<2)return group;
    const boundary=new Map();
    for(const tile of group)for(let i=0;i<tile.points.length;i++){
      const a=tile.points[i],b=tile.points[(i+1)%tile.points.length],key=tileEdgeKey(a,b),edge=edgeMap.get(key);
      if(edge?.internalDiagonal)continue;
      if(!boundary.has(key))boundary.set(key,[a,b]);
    }
    const neighbors=new Map(),coordinates=new Map();
    for(const [a,b] of boundary.values()){
      const ka=tileEdgeKey(a,a),kb=tileEdgeKey(b,b),adjA=neighbors.get(ka)||[],adjB=neighbors.get(kb)||[];
      adjA.push(kb);adjB.push(ka);neighbors.set(ka,adjA);neighbors.set(kb,adjB);coordinates.set(ka,a);coordinates.set(kb,b);
    }
    if(!neighbors.size||[...neighbors.values()].some(list=>list.length!==2))return group;
    const loop=[],start=neighbors.keys().next().value;let previous=null,current=start;
    while(!loop.includes(current)&&loop.length<=neighbors.size){loop.push(current);const next=neighbors.get(current).find(key=>key!==previous);previous=current;current=next;}
    if(current!==start||loop.length!==neighbors.size)return group;
    let points=loop.map(key=>coordinates.get(key));
    let changed=true;while(changed&&points.length>3){changed=false;for(let i=0;i<points.length;i++){
      const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
      const ab=Math.hypot(...a.map((v,k)=>v-b[k])),bc=Math.hypot(...b.map((v,k)=>v-c[k])),ac=Math.hypot(...a.map((v,k)=>v-c[k]));
      if(Math.abs(ab+bc-ac)<1e-5){points.splice(i,1);changed=true;break;}
    }}
    if(axes.length!==2)return group;
    let polygon=points.map(point=>axes.map(axis=>point[axis]));
    const signedArea=polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
    if(signedArea<0){points=points.reverse();polygon=polygon.reverse();}
    const xs=polygon.map(point=>point[0]),ys=polygon.map(point=>point[1]),width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys),area=Math.abs(signedArea);
    const {cuttingClass,...source}=group[0];
    return [{...source,id:group.map(tile=>tile.id).join(' + '),displayId:group.map(tile=>tile.id).join(' + '),sourceFaceIds:group.flatMap(tile=>tile.sourceFaceIds||[tile.id]),points,polygon,widthMm:Math.max(width,height)*1000,heightMm:Math.min(width,height)*1000,areaM2:area,rectangle:Math.abs(area-width*height)<1e-5,mergedDisplay:true}];
  });
}
