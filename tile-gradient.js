import * as THREE from './public/vendor/three/build/three.module.js';

export const TILE_COLORS=['#b3deff','#fdecfe'];
export const CEILING_COLORS=['#fed2c3','#cdfeeb'];

export function tileUV(polygon) {
  const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]);
  const minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(...xs)-minX,height=Math.max(...ys)-minY;
  return polygon.flatMap(p=>[(p[0]-minX)/(width||1),(p[1]-minY)/(height||1)]);
}

export function gradientTexture(colors) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,128,128);
  gradient.addColorStop(0,colors[0]);gradient.addColorStop(1,colors[1]);
  ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}
