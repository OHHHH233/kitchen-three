export const SOCKET_EDGE_COLOR=0x168cff;
export const isSocketObject=name=>typeof name==='string'&&name.includes('插座');

// Socket highlighting has its own switch and never changes model visibility.
export function socketEdgeStyle({socket,ownerSection,section,highlight,edges,edgeOpacity=1}){
  const active=socket&&ownerSection===section&&[1,3].includes(section)&&highlight;
  return {highlighted:active,visible:active||edges,color:active?SOCKET_EDGE_COLOR:0x75808e,opacity:active?1:edgeOpacity};
}
