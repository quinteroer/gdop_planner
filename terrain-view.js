/* Perspective terrain renderer using the prepared elevation grid and Canvas 2D. */
(function(root){
  'use strict';
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  class TerrainView {
    constructor(canvas,onChange){
      this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onChange=onChange;
      this.scene=null;this.mesh=[];this.meshKey=null;this.enabled=false;
      this.exaggeration=1;this.pointers=new Map();this.reset();
      canvas.addEventListener('pointerdown',event=>{
        if(!this.enabled)return;
        this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        canvas.setPointerCapture(event.pointerId);
        this.gesture=null;
      });
      canvas.addEventListener('pointermove',event=>this.move(event));
      const release=event=>{this.pointers.delete(event.pointerId);this.gesture=null;};
      canvas.addEventListener('pointerup',release);
      canvas.addEventListener('pointercancel',release);
      canvas.addEventListener('lostpointercapture',release);
      canvas.addEventListener('wheel',event=>{
        if(!this.enabled)return;
        event.preventDefault();this.zoom=clamp(this.zoom*Math.exp(event.deltaY*.001),.35,8);
        this.onChange();
      },{passive:false});
      canvas.addEventListener('contextmenu',event=>{if(this.enabled)event.preventDefault();});
      canvas.addEventListener('keydown',event=>{
        if(!this.enabled)return;
        const keys={ArrowLeft:()=>this.yaw-=.12,ArrowRight:()=>this.yaw+=.12,
          ArrowUp:()=>this.pitch=clamp(this.pitch+.1,.08,Math.PI/2-.005),
          ArrowDown:()=>this.pitch=clamp(this.pitch-.1,.08,Math.PI/2-.005),
          '+':()=>this.zoom=clamp(this.zoom*.85,.35,8),
          '=':()=>this.zoom=clamp(this.zoom*.85,.35,8),
          '-':()=>this.zoom=clamp(this.zoom/ .85,.35,8),'0':()=>this.reset()};
        if(keys[event.key]){event.preventDefault();keys[event.key]();this.onChange();}
      });
    }
    reset(){this.yaw=-Math.PI/2-.35;this.pitch=.82;this.zoom=1;this.pan=[0,0];this.gesture=null;}
    move(event){
      if(!this.enabled||!this.pointers.has(event.pointerId))return;
      const previous=this.pointers.get(event.pointerId);
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(this.pointers.size===2){
        const [a,b]=[...this.pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);
        const center=[(a.x+b.x)/2,(a.y+b.y)/2];
        if(this.gesture){
          this.zoom=clamp(this.zoom*this.gesture.distance/Math.max(distance,1),.35,8);
          this.pan[0]+=center[0]-this.gesture.center[0];this.pan[1]+=center[1]-this.gesture.center[1];
        }
        this.gesture={distance,center};
      }else if(this.pointers.size===1){
        const dx=event.clientX-previous.x,dy=event.clientY-previous.y;
        if(event.shiftKey||(event.buttons&2)){this.pan[0]+=dx;this.pan[1]+=dy;}
        else{this.yaw-=dx*.008;this.pitch=clamp(this.pitch+dy*.008,.08,Math.PI/2-.005);}
      }
      this.onChange();
    }
    setEnabled(value){
      this.enabled=value;this.pointers.clear();this.gesture=null;
      this.canvas.classList.toggle('orbiting',value);
    }
    prepare(scene){
      const key=scene.site||`${scene.width},${scene.height}`;
      if(this.meshKey===key)return;
      this.meshKey=key;this.reset();
      const n=scene.site?.gridSize||11;
      const elevations=scene.site?.elevations||Array(n*n).fill(0);
      const points=elevations.map((z,i)=>Number.isFinite(z)?[i%n/(n-1)*scene.width,Math.floor(i/n)/(n-1)*scene.height,z]:null);
      this.mesh=[];
      for(let row=0;row<n-1;row++)for(let col=0;col<n-1;col++){
        const a=row*n+col,b=a+1,c=a+n,d=c+1;
        for(const indices of [[a,b,d],[a,d,c]]){
          const vertices=indices.map(i=>points[i]);
          if(vertices.every(Boolean))this.mesh.push(vertices);
        }
      }
      this.groundPoints=points.filter(Boolean);
      const z=this.groundPoints.map(p=>p[2]);
      this.zMin=Math.min(...z);this.zMax=Math.max(...z);
    }
    render(scene){
      this.scene=scene;this.prepare(scene);
      const ctx=this.ctx,box=this.canvas.getBoundingClientRect(),w=box.width,h=box.height;
      if(!w||!h||!(scene.width>0&&scene.height>0))return;
      const dpr=window.devicePixelRatio||1;
      this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle='#152938';ctx.fillRect(0,0,w,h);
      const highest=Math.max(this.zMax,scene.plan?.cams[0]?.[2]??this.zMax);
      const center=[scene.width/2,scene.height/2,(this.zMin+highest)/2];
      const radius=Math.max(1,Math.hypot(scene.width,scene.height,(highest-this.zMin)*this.exaggeration)/2);
      const focal=h/(2*Math.tan(Math.PI/8));
      // Fit both narrow phone canvases and wide desktop canvases.
      const fov=Math.min(Math.PI/4,2*Math.atan(w/(2*focal)));
      const distance=Math.max(radius*1.15,radius/Math.sin(fov/2)*1.1*this.zoom);
      const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
      const project=point=>{
        const x=point[0]-center[0],y=point[1]-center[1],z=(point[2]-center[2])*this.exaggeration;
        const depth=distance-x*cy*cp-y*sy*cp-z*sp;
        return {x:w/2+this.pan[0]+focal*(-x*sy+y*cy)/depth,
          y:h/2+this.pan[1]-focal*(-x*cy*sp-y*sy*sp+z*cp)/depth,depth};
      };
      this.project=project;
      const floor=this.zMin-Math.max(1,(this.zMax-this.zMin)*.1);
      const line=(points,color,width=1,dash=[])=>{
        if(points.length<2)return;
        ctx.beginPath();points.forEach((p,i)=>{const q=project(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});
        ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);
      };
      const step=Math.max(5,10**Math.floor(Math.log10(Math.max(scene.width,scene.height)/6)));
      for(let x=0;x<=scene.width;x+=step)line([[x,0,floor],[x,scene.height,floor]],'#42606a60');
      for(let y=0;y<=scene.height;y+=step)line([[0,y,floor],[scene.width,y,floor]],'#42606a60');
      const triangles=this.mesh.map(vertices=>({vertices,screen:vertices.map(project)}));
      triangles.sort((a,b)=>b.screen.reduce((s,p)=>s+p.depth,0)-a.screen.reduce((s,p)=>s+p.depth,0));
      for(const {vertices,screen} of triangles){
        const z=vertices.reduce((sum,p)=>sum+p[2],0)/3;
        const t=(z-this.zMin)/Math.max(.1,this.zMax-this.zMin);
        ctx.beginPath();screen.forEach((q,i)=>{if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.closePath();
        ctx.fillStyle=`hsl(${165-t*65} 23% ${29+t*20}%)`;ctx.fill();
        if(scene.image?.complete&&scene.image.naturalWidth)this.texture(vertices,screen,scene);
        const [a,b,c]=vertices;
        const ux=b[0]-a[0],uy=b[1]-a[1],uz=(b[2]-a[2])*this.exaggeration;
        const vx=c[0]-a[0],vy=c[1]-a[1],vz=(c[2]-a[2])*this.exaggeration;
        const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
        const shade=clamp((nx*.3+ny*-.4+nz*.86)/Math.max(1e-9,Math.hypot(nx,ny,nz)),0,1);
        ctx.fillStyle=`rgba(2,16,22,${.24*(1-shade)})`;ctx.fill();
      }
      if(scene.boundary){
        const outline=scene.boundary.map(p=>[...p,scene.terrainAt(...p)??this.zMin]);
        line([...outline,outline[0]],'#cdf9e4',2);
      }
      if(scene.showCoverage&&scene.plan)scene.plan.points.forEach((p,i)=>{
        const q=project(p);ctx.fillStyle=scene.plan.analysis.counts[i]<4?'#ff9382':'#6ce2a477';ctx.fillRect(q.x-1.5,q.y-1.5,3,3);
      });
      scene.exclusions.forEach(e=>{
        const ring=Array.from({length:49},(_,i)=>{
          const angle=i/48*Math.PI*2,x=e.x+Math.cos(angle)*e.radius,y=e.y+Math.sin(angle)*e.radius;
          return [x,y,scene.terrainAt(x,y)??this.zMin];
        });line(ring,'#fc9c85',1.5,[4,3]);
      });
      if(scene.plan){
        const route=scene.plan.path.map(p=>p.position);
        line(route,'#0b1930',4);line(route,'#8fc9ff',2);
        if(scene.showMidpoints)scene.plan.midpoints.forEach(p=>{
          const z=scene.terrainAt(...p);if(!Number.isFinite(z))return;
          const q=project([...p,z]);ctx.beginPath();ctx.arc(q.x,q.y,4,0,Math.PI*2);ctx.strokeStyle='#91ffe3';ctx.lineWidth=1.5;ctx.stroke();
        });
        const start=project(scene.plan.cams[0]);ctx.fillStyle='#bfe9ff';ctx.beginPath();ctx.arc(start.x,start.y,4,0,Math.PI*2);ctx.fill();
        scene.plan.gcps.points.forEach((p,i)=>{
          const q=project(p);ctx.beginPath();ctx.arc(q.x,q.y,10,0,Math.PI*2);
          ctx.fillStyle='#f4c768';ctx.fill();ctx.strokeStyle='#fff0bb';ctx.lineWidth=1.5;ctx.stroke();
          ctx.font='600 11px Segoe UI, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#3b341f';ctx.fillText(i+1,q.x,q.y+.5);
        });
      }
      // World axes make viewpoint changes explicit and retain a true north cue.
      const origin=[scene.width,0,floor],axisLength=Math.max(scene.width,scene.height)*.12;
      for(const [delta,label,color] of [[[axisLength,0,0],'E','#f1b4a9'],[[0,axisLength,0],'N','#b5e5bd'],[[0,0,axisLength],'Z','#a5d8ff']]){
        const tip=origin.map((v,i)=>v+delta[i]);line([origin,tip],color,2);
        const q=project(tip);ctx.fillStyle=color;ctx.font='11px Segoe UI, sans-serif';ctx.textAlign='left';ctx.fillText(label,q.x+4,q.y);
      }
      ctx.fillStyle='#d4e8e9';ctx.font='11px Segoe UI, sans-serif';ctx.textAlign='left';
      ctx.fillText(`${this.exaggeration}× vertical scale`,15,h-17);
    }
    texture(vertices,screen,scene){
      const ctx=this.ctx,image=scene.image;
      const source=vertices.map(p=>[p[0]/scene.width*image.naturalWidth,(1-p[1]/scene.height)*image.naturalHeight]);
      const [[u0,v0],[u1,v1],[u2,v2]]=source,[a,b,c]=screen;
      const determinant=(u1-u0)*(v2-v0)-(u2-u0)*(v1-v0);
      if(Math.abs(determinant)<1e-9)return;
      const xx=((b.x-a.x)*(v2-v0)-(c.x-a.x)*(v1-v0))/determinant;
      const xy=((c.x-a.x)*(u1-u0)-(b.x-a.x)*(u2-u0))/determinant;
      const yx=((b.y-a.y)*(v2-v0)-(c.y-a.y)*(v1-v0))/determinant;
      const yy=((c.y-a.y)*(u1-u0)-(b.y-a.y)*(u2-u0))/determinant;
      ctx.save();ctx.clip();ctx.transform(xx,yx,xy,yy,a.x-xx*u0-xy*v0,a.y-yx*u0-yy*v0);
      ctx.drawImage(image,0,0);ctx.restore();
    }
  }
  root.TerrainView=TerrainView;
})(globalThis);
