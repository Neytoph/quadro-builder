// 两条有限线段之间的最短距离。
export function segmentDistance(a,b,c,d){
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2];
  const vx=d[0]-c[0],vy=d[1]-c[1],vz=d[2]-c[2];
  const wx=a[0]-c[0],wy=a[1]-c[1],wz=a[2]-c[2];
  const aa=ux*ux+uy*uy+uz*uz,bb=ux*vx+uy*vy+uz*vz,cc=vx*vx+vy*vy+vz*vz;
  const dd=ux*wx+uy*wy+uz*wz,ee=vx*wx+vy*wy+vz*wz,det=aa*cc-bb*bb;
  if(cc===0){const s=aa>1e-8?Math.max(0,Math.min(1,-dd/aa)):0;return Math.hypot(wx+s*ux,wy+s*uy,wz+s*uz);}
  let s=det>1e-8?Math.max(0,Math.min(1,(bb*ee-cc*dd)/det)):0,t=cc>1e-8?(bb*s+ee)/cc:0;
  if(t<0){t=0;s=aa>1e-8?Math.max(0,Math.min(1,-dd/aa)):0;}
  else if(t>1){t=1;s=aa>1e-8?Math.max(0,Math.min(1,(bb-dd)/aa)):0;}
  return Math.hypot(wx+s*ux-t*vx,wy+s*uy-t*vy,wz+s*uz-t*vz);
}
