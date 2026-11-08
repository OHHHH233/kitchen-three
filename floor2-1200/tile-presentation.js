export const TILE_FOCUS_OBJECT='一楼铺贴区域排版800x800';

// Opacity is reduced only in 3D. Keep depth testing so the tiles themselves
// still occlude each other; context surfaces must not write opaque depth.
export function tilePresentation({view,focus,kind,sourceObject='',door=false,contextTransparency=75,tileTransparency=100}) {
  const active=view==='3d'&&focus;
  const target=kind!=='hard'&&sourceObject===TILE_FOCUS_OBJECT;
  // Tile fill transparency is independent of the context; keep depth writes to prevent rear tiles
  // and their outlines from bleeding through the front tile layer.
  if(view==='3d'&&(target||kind==='ceiling')){
    const transparency=Number.isFinite(tileTransparency)?Math.max(0,Math.min(100,tileTransparency)):100,opacity=(100-transparency)/100;
    return {color:0xffffff,opacity,transparent:opacity<1,depthWrite:true,edgeColor:kind==='ceiling'?0x785847:0x163c68,edgeOpacity:1,target};
  }
  if(active){const transparency=Number.isFinite(contextTransparency)?Math.max(0,Math.min(100,contextTransparency)):75,opacity=(100-transparency)/100;
    return {color:0xcbd4df,opacity,transparent:opacity<1,depthWrite:opacity===1,edgeColor:0x8e9eaf,edgeOpacity:Math.min(1,opacity*1.3),target:false};}
  return {color:kind==='hard'?(door?0xaac5e3:0xe5e9ed):kind==='floor'?0xd5dfeb:kind==='ceiling'?0xdce8f4:0xcbd8e7,
    opacity:door?.45:1,transparent:door,depthWrite:!door,edgeColor:kind==='hard'?0x75808e:0xa3b1c0,edgeOpacity:1,target:false};
}
