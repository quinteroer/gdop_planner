/* Browser client and result adapter for the Python geometric optimizer. */
(function(root){
  'use strict';
  let worker=null,pending=null;
  function stop(message='Search canceled.') {
    worker?.terminate();worker=null;
    if(pending){pending.reject(Error(message));pending=null;}
  }
  function solve(request,onProgress){
    if(location.protocol==='file:')return Promise.reject(Error('Start the visualizer with python -m http.server 8000, then open http://localhost:8000.'));
    if(pending)return Promise.reject(Error('A search is already running.'));
    return new Promise((resolve,reject)=>{
      pending={resolve,reject,onProgress};
      try {worker??=new Worker('python-worker.js');}
      catch(error){pending=null;reject(error);return;}
      worker.onmessage=({data})=>{
        if(!pending)return;
        const message=typeof data==='string'?JSON.parse(data):data;
        if(message.type==='result'){const done=pending;pending=null;done.resolve(message.result);}
        else if(message.type==='error'){const done=pending;pending=null;done.reject(Error(message.message));}
        else pending.onProgress?.(message);
      };
      worker.onerror=()=>{stop('Python worker failed. Check internet access and reload the page.');};
      worker.postMessage(request);
    });
  }
  function adapt(result,state){
    const p=result.plan;if(!p)return null;
    let distance=0;
    const path=p.path.map((position,i)=>{
      if(i)distance+=Math.hypot(position[0]-p.path[i-1][0],position[1]-p.path[i-1][1]);
      return {position,capture:false,distance};
    });
    p.cams.forEach((position,i)=>path.push({position,capture:true,distance:i*p.capture_spacing_m}));
    path.sort((a,b)=>a.distance-b.distance || Number(a.capture)-Number(b.capture));
    const merged=[];
    for(const point of path){
      if(merged.length&&Math.abs(merged.at(-1).distance-point.distance)<1e-7){
        if(point.capture)merged[merged.length-1]=point;
      }else merged.push(point);
    }
    return {state:{...state,altitude:p.altitude_m,numGcps:p.gcp_count},
      cams:p.cams,path:merged,points:result.points,
      gcps:{points:p.gcps,values:p.gcp_indices.map(i=>p.analysis[i].gdop),
        maxDistance:p.max_gcp_distance,meanGdop:p.mean_gdop},
      analysis:{values:p.analysis.map(v=>v.gdop),counts:p.analysis.map(v=>v.views),angles:p.analysis.map(v=>v.view_spread_deg)},
      clearance:p.clearance_m,
      route:{axis:p.camera_heading_deg,distance:p.distance_m,time:p.time_s,photos:p.cams.length,
        speed:p.speed_m_s,gsd:p.gsd_m,interval:p.photo_interval_s,rounded:p.rounded_turns},
      midpoints:p.gcp_pair_midpoints,midpointPassage:p.midpoint_passage,
      diagnostics:result.diagnostics};
  }
  root.PythonPlanner={solve,cancel:stop,adapt};
})(globalThis);
