/* Nadir footprint visibility plus a dimensionless direction geometry diagnostic. */
(function(root) {
  'use strict';
  const flight=typeof module!=='undefined'?require('./optimizer.js'):root.FlightOptimizer;
  const capture=typeof module!=='undefined'?require('./capture-planning.js'):root.CapturePlanning;
  function diagnostic(p,cams) {
    if(cams.length<3)return Infinity;
    const m=[[0,0,0],[0,0,0],[0,0,0]];
    for(const c of cams){const v=[p[0]-c[0],p[1]-c[1],(p[2]||0)-c[2]],r=Math.hypot(...v);if(r<1e-9)continue;
      for(let i=0;i<3;i++)for(let j=0;j<3;j++)m[i][j]+=v[i]*v[j]/(r*r);}
    const [a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2];
    const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
    if(Math.abs(det)<1e-12)return Infinity;
    const trace=((e*i-f*h)+(a*i-c*g)+(a*e-b*d))/det;
    return trace>0?Math.sqrt(trace):Infinity;
  }
  function analyze(points,cams,s,axis,options={}) {
    const values=[],counts=[],angles=[],gsds=[];
    for(const p of points){const visible=cams.filter(c=>capture.visible(p,c,s,axis,options)&&(!options.maxGsd||capture.projected(p,c,s,axis)<=options.maxGsd));
      const dirs=visible.map(c=>{const v=[c[0]-p[0],c[1]-p[1],c[2]-(p[2]||0)],r=Math.hypot(...v);return v.map(x=>x/r);});
      let minDot=1;
      for(let i=0;i<dirs.length;i++)for(let j=i+1;j<dirs.length;j++)minDot=Math.min(minDot,dirs[i].reduce((sum,x,k)=>sum+x*dirs[j][k],0));
      values.push(diagnostic(p,visible));counts.push(visible.length);angles.push(Math.acos(Math.max(-1,Math.min(1,minDot)))*180/Math.PI);
      const resolutions=visible.map(c=>capture.projected(p,c,s,axis)).filter(v=>v!==null&&Number.isFinite(v));
      gsds.push(resolutions.length?Math.max(...resolutions):Infinity);
    }
    return {values,counts,angles,gsds};
  }
  const api={analyze,diagnostic};if(typeof module!=='undefined')module.exports=api;else root.PlannerModel=api;
})(typeof window!=='undefined'?window:globalThis);
