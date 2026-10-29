export const mm = value => new Intl.NumberFormat('zh-CN', {maximumFractionDigits:0}).format(Math.round(value));
export const areaM2 = value => new Intl.NumberFormat('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2}).format(value);

export function drawingBounds(tiles) {
  const points = tiles.flatMap(tile=>tile.polygon);
  return {minX:Math.min(...points.map(p=>p[0])), maxX:Math.max(...points.map(p=>p[0])),
    minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))};
}

export function scheduleCsv(data) {
  const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  const rows=[['类型','区域','编号','宽度/轴向尺寸 (mm)','高度/另一向尺寸 (mm)','形状','面积 (m²)','各边长度 (mm)','核对','源块面编号']];
  const rulerType=data.section==='板块二'?'橱柜标尺':data.section==='板块三'?'吊柜标尺':data.section==='橱柜吊柜区'?'橱柜吊柜标尺':'硬装标尺';
  for(const d of data.dimensions) rows.push([rulerType,data.section,d.id,mm(d.value*1000),'',d.axis+' 轴','','','源标尺','']);
  for(const s of data.surfaces) for(const t of s.tiles) rows.push(['排版块面',s.name,t.id,mm(t.widthMm),mm(t.heightMm),
    t.rectangle?'矩形':'异形（包络宽高）',areaM2(t.areaM2),t.edgeLengthsMm.map(mm).join(' / '),t.oversize?'超标称规格，待核对':'',(t.sourceFaceIds||[t.id]).join(' / ')]);
  return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
}

export function dimensionVisible(d,view,direction='front') {
  if(view==='3d') return true;
  if(view==='top') return ['X','Y'].includes(d.axis)&&d.value>=.1;
  return d.axis!==(['left','right'].includes(direction)?'X':'Y');
}

export function keepNearAxisDimensions(dimensions,axis,depthOf,range) {
  const axial=dimensions.filter(d=>d.axis===axis);
  if(!axial.length)return dimensions;
  const nearest=Math.min(...axial.map(depthOf));
  return dimensions.filter(d=>d.axis!==axis||depthOf(d)-nearest<=range);
}

export function validateSection(data) {
  if(data.version!=='2.0'||data.unit!=='m'||Math.abs(data.unitScale-1)>.00001) throw Error('工程单位或版本不匹配');
  const ids=new Set();
  for(const d of data.dimensions) {
    const distance=Math.hypot(...d.endpoints[0].map((n,i)=>d.endpoints[1][i]-n));
    if(!Number.isFinite(distance)||Math.abs(distance-d.value)>1e-5) throw Error('标尺长度与端点不匹配：'+d.id);
  }
  for(const s of data.surfaces) for(const t of s.tiles) {
    if(ids.has(t.id)) throw Error('块面编号重复：'+t.id);
    ids.add(t.id);
    if(t.points.length<3||t.widthMm<=0||t.heightMm<=0||t.areaM2<=0) throw Error('无效块面：'+t.id);
    if(t.points.length!==t.polygon.length||t.edgeLengthsMm.length!==t.points.length) throw Error('块面边数不一致：'+t.id);
  }
  if(ids.size!==data.checks.faceCount) throw Error('块面数量不一致');
  return data;
}
