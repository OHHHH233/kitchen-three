// Place authored tile outlines on stock in SVG coordinates (millimetres).
export function cuttingOutline(tile,placement,stockHeight){
  const {x,y,w,h,rotated}=placement;
  const polygon=tile?.polygon;
  if(!polygon?.length)return [[x,stockHeight-y],[x+w,stockHeight-y],[x+w,stockHeight-y-h],[x,stockHeight-y-h]];
  const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]);
  const minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(...xs)-minX,height=Math.max(...ys)-minY;
  if(width<=0||height<=0)throw new Error('切割块面轮廓无有效面积');
  return polygon.map(([px,py])=>{
    const u=(px-minX)/width,v=(py-minY)/height;
    return rotated?[x+(1-v)*w,stockHeight-y-u*h]:[x+u*w,stockHeight-y-v*h];
  });
}

export function closedOutline(points){
  return points.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join('')+'Z';
}

// Even-odd filling subtracts the actual used polygons, including notches.
export function stockRemainderPath(stockWidth,stockHeight,outlines){
  return `M0 0H${stockWidth}V${stockHeight}H0Z`+outlines.map(closedOutline).join('');
}
