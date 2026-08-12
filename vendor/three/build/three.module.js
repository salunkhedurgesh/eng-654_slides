/*
  ENG-654 local lightweight Three-compatible fallback.
  Replace with the official Three.js file using tools/fetch_three.sh when you have internet.
  It implements only the tiny subset used by js/viz/threeRevolute.js.
*/
export const __ENG654_MINI_THREE__ = true;

export class Vector3 {
  constructor(x=0,y=0,z=0){ this.x=x; this.y=y; this.z=z; }
  set(x,y,z){ this.x=x; this.y=y; this.z=z; return this; }
}

export class Euler {
  constructor(x=0,y=0,z=0){ this.x=x; this.y=y; this.z=z; }
}

export class Object3D {
  constructor(){ this.children=[]; this.position=new Vector3(); this.rotation=new Euler(); }
  add(...objs){ this.children.push(...objs); return this; }
}

export class Group extends Object3D {}
export class Scene extends Object3D {}

export class PerspectiveCamera extends Object3D {
  constructor(fov=45, aspect=1, near=0.01, far=100){ super(); this.fov=fov; this.aspect=aspect; this.near=near; this.far=far; }
  lookAt(){ /* no-op in fallback */ }
  updateProjectionMatrix(){ /* no-op */ }
}

export class AmbientLight extends Object3D { constructor(color, intensity){ super(); this.color=color; this.intensity=intensity; } }
export class DirectionalLight extends Object3D { constructor(color, intensity){ super(); this.color=color; this.intensity=intensity; } }

export class MeshStandardMaterial { constructor(opts={}){ this.color = opts.color ?? 0x111111; } }
export class BoxGeometry { constructor(w,h,d){ this.type='box'; this.w=w; this.h=h; this.d=d; } }
export class CylinderGeometry { constructor(r1,r2,h,segments){ this.type='cylinder'; this.r1=r1; this.r2=r2; this.h=h; this.segments=segments; } }
export class Mesh extends Object3D { constructor(geometry, material){ super(); this.geometry=geometry; this.material=material; } }
export class AxesHelper extends Object3D { constructor(size=1){ super(); this.size=size; } }

export class WebGLRenderer {
  constructor(){ this.domElement=document.createElement('canvas'); this.ctx=this.domElement.getContext('2d'); }
  setPixelRatio(){ }
  setSize(w,h){ this.domElement.width=w; this.domElement.height=h; this.domElement.style.width=w+'px'; this.domElement.style.height=h+'px'; }
  render(scene){
    const ctx=this.ctx, w=this.domElement.width, h=this.domElement.height;
    ctx.clearRect(0,0,w,h);
    ctx.save();
    ctx.translate(w/2,h/2);
    ctx.scale(Math.min(w,h)/4, -Math.min(w,h)/4);
    drawObject(ctx, scene, {x:0,y:0,z:0, rz:0});
    ctx.restore();
    ctx.save();
    ctx.fillStyle='#555'; ctx.font='12px Arial';
    ctx.fillText('local mini-three fallback — run tools/fetch_three.sh for official Three.js', 12, h-12);
    ctx.restore();
  }
}

function drawObject(ctx, obj, t){
  const rz = t.rz + (obj.rotation?.z || 0);
  const cos=Math.cos(rz), sin=Math.sin(rz);
  const px = t.x + (obj.position?.x || 0)*cos - (obj.position?.y || 0)*sin;
  const py = t.y + (obj.position?.x || 0)*sin + (obj.position?.y || 0)*cos;
  const nt={x:px,y:py,z:t.z+(obj.position?.z||0),rz};

  if(obj instanceof AxesHelper){
    ctx.lineWidth=0.025;
    line(ctx, px, py, px+obj.size, py, '#ff0000');
    line(ctx, px, py, px, py+obj.size, '#82B366');
    line(ctx, px, py, px-0.45*obj.size, py+0.45*obj.size, '#6C8EBF');
  }
  if(obj instanceof Mesh){
    const color = '#'+(obj.material.color || 0x111111).toString(16).padStart(6,'0');
    ctx.save(); ctx.translate(px,py); ctx.rotate(rz);
    if(obj.geometry.type==='box'){
      ctx.fillStyle=color; ctx.strokeStyle='#111'; ctx.lineWidth=0.02;
      ctx.fillRect(-obj.geometry.w/2, -obj.geometry.h/2, obj.geometry.w, obj.geometry.h);
      ctx.strokeRect(-obj.geometry.w/2, -obj.geometry.h/2, obj.geometry.w, obj.geometry.h);
    } else if(obj.geometry.type==='cylinder'){
      ctx.fillStyle=color; ctx.beginPath(); ctx.arc(0,0,obj.geometry.r1,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  for(const child of obj.children || []) drawObject(ctx, child, nt);
}
function line(ctx,x1,y1,x2,y2,color){ ctx.strokeStyle=color; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
