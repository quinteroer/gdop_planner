/* Capture planning helpers. Coordinates are local metres; bearings clockwise from north. */
(function(root) {
  'use strict';
  const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const unit=a=>{const n=Math.hypot(...a);return a.map(x=>x/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function inside(p,poly) {
    if(!poly)return true;
    let hit=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const a=poly[j],b=poly[i],dx=b[0]-a[0],dy=b[1]-a[1];
      if(Math.abs(dx*(p[1]-a[1])-dy*(p[0]-a[0]))<1e-7 && p[0]>=Math.min(a[0],b[0])-1e-7 && p[0]<=Math.max(a[0],b[0])+1e-7 && p[1]>=Math.min(a[1],b[1])-1e-7 && p[1]<=Math.max(a[1],b[1])+1e-7)return true;
      if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
    }
    return hit;
  }
  function polygon(text,width,height) {
    if(!text.trim())return null;
    const p=JSON.parse(text);
    if(!Array.isArray(p)||p.length<3||p.length>100||p.some(v=>!Array.isArray(v)||v.length!==2||v.some(x=>!Number.isFinite(x))||v[0]<0||v[0]>width||v[1]<0||v[1]>height))throw Error('Boundary needs 3–100 [east,north] vertices inside the site, in local metres.');
    const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++) {
      if(j===i+1||(i===0&&j===p.length-1))continue;
      const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
      if(orient(a,b,c)*orient(a,b,d)<=0&&orient(c,d,a)*orient(c,d,b)<=0&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1])))throw Error('Boundary must not cross or touch itself.');
    }
    const area=Math.abs(p.reduce((v,a,i)=>{const b=p[(i+1)%p.length];return v+a[0]*b[1]-a[1]*b[0];},0))/2;
    if(area<1e-6||p.some((a,i)=>Math.hypot(...sub(a,p[(i+1)%p.length]))<1e-6))throw Error('Boundary has zero area or duplicate adjacent vertices.');
    return p;
  }
  // A sampled height field is not a mesh of walls, trees, or overhangs.
  function sight(p,c,terrain,step=2) {
    if(!terrain)return true;
    const n=Math.max(2,Math.ceil(Math.hypot(c[0]-p[0],c[1]-p[1])/step));
    for(let i=1;i<n;i++) {
      const t=i/n,x=p[0]+t*(c[0]-p[0]),y=p[1]+t*(c[1]-p[1]),z=p[2]+t*(c[2]-p[2]);
      const h=terrain(x,y);
      if(h===null||!Number.isFinite(h)||h>z+.05)return false;
    }
    return true;
  }
  function projected(p,c,s,axis) {
    const flight=typeof module!=='undefined'?require('./optimizer.js'):root.FlightOptimizer;
    if(!c.pose) {
      if(!flight.viewing(p,c,s,axis))return null;
      return flight.footprint(c[2]-p[2],s).gsd;
    }
    const yaw=c.pose.heading*Math.PI/180,tilt=c.pose.tilt*Math.PI/180;
    const forward=[Math.sin(yaw)*Math.sin(tilt),Math.cos(yaw)*Math.sin(tilt),-Math.cos(tilt)];
    const right=[Math.cos(yaw),-Math.sin(yaw),0],up=cross(right,forward),v=sub(p,c),depth=dot(v,forward);
    if(depth<=0)return null;
    const f=flight.footprint(depth,s);
    if(Math.abs(dot(v,right))>f.across/2||Math.abs(dot(v,up))>f.along/2)return null;
    // Conservative local surface resolution bound, accounting for incidence.
    const normal=p.normal||[0,0,1],incidence=Math.abs(dot(unit(sub(c,p)),normal));
    if(incidence<.15)return null;
    return c.gsd>0?c.gsd:f.gsd===null?undefined:f.gsd/incidence;
  }
  function visible(p,c,s,axis,options={}) {
    const flight=typeof module!=='undefined'?require('./optimizer.js'):root.FlightOptimizer;
    if(!c.pose&&!flight.viewing(p,c,s,axis))return false;
    if(c.pose&&projected(p,c,s,axis)===null)return false;
    return !options.terrain||sight(p,c,options.terrain,options.step);
  }
  function weak(a,o) {return a.count<o.minViews||a.angle<o.minAngle||(o.maxGsd&&a.gsd>o.maxGsd);}
  function supplement(points,cams,s,axis,analysis,o,model) {
    const targetSet=new Set(o.targetIds||[]),candidates=[],weakIds=points.map((p,i)=>i).filter(i=>weak({count:analysis.counts[i],angle:analysis.angles[i],gsd:analysis.gsds[i]},o)),ids=[...new Set([...weakIds,...targetSet])];
    // Bound candidate generation and scoring; every surface sample is still evaluated.
    for(let k=0;k<ids.length;k+=Math.max(1,Math.ceil(ids.length/40))) {
      const p=points[ids[k]];
      for(let heading=0;heading<360;heading+=90) {
        const h=s.altitude,r=h*Math.tan(Math.PI/6),a=heading*Math.PI/180;
        const c=[p[0]-r*Math.sin(a),p[1]-r*Math.cos(a),p[2]+h];
        if(c[0]<0||c[1]<0||c[0]>s.width||c[1]>s.height)continue;
        const ground=o.terrain?.(c[0],c[1]);
        if(o.terrain&&(ground===null||c[2]-ground<o.minClearance))continue;
        c.pose={heading,tilt:30};candidates.push(c);
      }
    }
    const selected=[],base=cams.slice();let current=analysis;
    for(let n=0;n<o.budget;n++) {
      let best=null,bestGain=0;
      for(const c of candidates) {
        if(selected.includes(c))continue;
        let gain=0;
        for(const i of ids) {
          if(!visible(points[i],c,s,axis,o))continue;
          const g=projected(points[i],c,s,axis);if(o.maxGsd&&g!==null&&g>o.maxGsd)continue;
          if(targetSet.has(i)&&selected.filter(v=>visible(points[i],v,s,axis,o)).length<2)gain++;
          if(current.counts[i]<o.minViews)gain++;
          if(current.angles[i]<o.minAngle&&base.some(b=>visible(points[i],b,s,axis,o)&&Math.acos(Math.max(-1,Math.min(1,dot(unit(sub(c,points[i])),unit(sub(b,points[i]))))))*180/Math.PI>=o.minAngle))gain++;
        }
        if(gain>bestGain){bestGain=gain;best=c;}
      }
      if(!best)break;
      selected.push(best);base.push(best);current=model.analyze(points,base,s,axis,o);
    }
    return {cameras:selected,analysis:current,weakBefore:weakIds.length,weakAfter:points.filter((p,i)=>weak({count:current.counts[i],angle:current.angles[i],gsd:current.gsds[i]},o)).length,feedbackTargets:targetSet.size};
  }
  function parseCsv(text) {
    // Numeric audit interchange intentionally disallows quoted/newline fields.
    const rows=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(x=>x.trim());
    if(rows.length<2||rows.length>5001)throw Error('CSV needs a header and 1–5000 records.');
    const keys=rows.shift().split(',').map(x=>x.trim());
    if(new Set(keys).size!==keys.length)throw Error('CSV contains duplicate headers.');
    const required=['x_m','y_m','z_m','timestamp_s','heading_deg','tilt_deg'];
    if(required.some(k=>!keys.includes(k)))throw Error('Required CSV fields: '+required.join(', '));
    const records=rows.map((row,i)=>{
      const fields=row.split(',');if(fields.length!==keys.length)throw Error(`CSV row ${i+2} has the wrong number of fields.`);
      const r=Object.fromEntries(keys.map((k,j)=>[k,fields[j].trim()===''?null:Number(fields[j])]));
      if(required.some(k=>r[k]===null||!Number.isFinite(r[k]))||Object.values(r).some(v=>v!==null&&!Number.isFinite(v))||r.tilt_deg<0||r.tilt_deg>=90||r.heading_deg<0||r.heading_deg>=360||['exposure_s','gsd_m'].some(k=>r[k]!=null&&r[k]<=0)||(r.sharpness!=null&&r.sharpness<0))throw Error(`Invalid numeric data or pose in CSV row ${i+2}.`);
      return r;
    });
    if(records.some((r,i)=>i&&r.timestamp_s<=records[i-1].timestamp_s))throw Error('Capture timestamps must increase strictly in capture order.');
    return records;
  }
  function audit(records,plan,sharpnessMin,blurLimit,s) {
    let slow=0,blurred=0,unknownSharpness=0,unknownBlur=0,maxDeviation=0,maxGap=0;
    const usable=[];
    records.forEach((r,i)=>{
      const c=[r.x_m,r.y_m,r.z_m];c.pose={heading:r.heading_deg,tilt:r.tilt_deg};c.gsd=r.gsd_m;
      const previous=records[i-1],dt=previous?r.timestamp_s-previous.timestamp_s:null;
      const speed=previous?Math.hypot(r.x_m-previous.x_m,r.y_m-previous.y_m)/dt:null;
      const g=r.gsd_m>0?r.gsd_m:null; // Explicit measured/local GSD; no invented altitude datum.
      const blur=speed!==null&&r.exposure_s>0&&g?speed*r.exposure_s/g:null;
      const sharp=r.sharpness==null?null:r.sharpness>=sharpnessMin;
      if(sharp===false)slow++;if(sharp===null)unknownSharpness++;
      if(blur!==null&&blur>blurLimit)blurred++;if(blur===null)unknownBlur++;
      if(dt!==null)maxGap=Math.max(maxGap,dt);
      if(plan.length)maxDeviation=Math.max(maxDeviation,Math.min(...plan.map(p=>Math.hypot(...sub(c,p)))));
      if(sharp!==false&&(blur===null||blur<=blurLimit))usable.push(c);
    });
    return {total:records.length,usable,lowSharpness:slow,blurred,unknownSharpness,unknownBlur,maxDeviation,maxGap};
  }
  function reconstruction(text,points,radius,errorLimit,minViews) {
    if(!Number.isFinite(radius)||!Number.isFinite(errorLimit)||!(radius>0&&errorLimit>0)||!Number.isInteger(minViews)||minViews<1)throw Error('Support radius, reprojection limit and minimum views must be valid positive values.');
    const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(x=>x.trim()),header=lines.shift()?.split(',').map(x=>x.trim());
    const keys=['x_m','y_m','z_m','registered_views','reprojection_error_px'];
    if(!header||new Set(header).size!==header.length||keys.some(k=>!header.includes(k))||!lines.length||lines.length>200000)throw Error('Reconstruction CSV needs x_m,y_m,z_m,registered_views,reprojection_error_px and 1–200000 records.');
    const buckets=new Map();
    for(const [i,line] of lines.entries()){
      const fields=line.split(',');if(fields.length!==header.length)throw Error(`Invalid reconstruction row ${i+2}.`);
      const values=keys.map(k=>{const v=fields[header.indexOf(k)].trim();return v===''?NaN:Number(v);});
      if(values.some(v=>!Number.isFinite(v))||!Number.isInteger(values[3])||values[3]<0||values[4]<0)throw Error(`Invalid reconstruction row ${i+2}.`);
      const key=Math.floor(values[0]/radius)+','+Math.floor(values[1]/radius);
      if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(values);
    }
    const counts=[],errors=[],supported=[];
    for(const p of points){
      const x=Math.floor(p[0]/radius),y=Math.floor(p[1]/radius);let views=0,error=Infinity;
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const r of buckets.get((x+dx)+','+(y+dy))||[]){
        if(Math.hypot(p[0]-r[0],p[1]-r[1],p[2]-r[2])>radius)continue;
        if(r[4]<=errorLimit){views=Math.max(views,r[3]);error=Math.min(error,r[4]);}
      }
      counts.push(views);errors.push(error);supported.push(views>=minViews);
    }
    return {counts,errors,supported,records:lines.length};
  }
  const api={inside,polygon,sight,projected,visible,supplement,parseCsv,audit,reconstruction};
  if(typeof module!=='undefined')module.exports=api;else root.CapturePlanning=api;
})(typeof window!=='undefined'?window:globalThis);
