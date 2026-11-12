/* Focused UI: one joint flight/GCP search, with optional map refinements. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),sites=window.SURVEY_SITES||[];
  const form=$('plannerForm'),canvas=$('mapCanvas'),ctx=canvas.getContext('2d');
  let viewMode='3d',orbitFrame=0;
  const terrainView=new TerrainView(canvas,()=>{
    if(!orbitFrame)orbitFrame=requestAnimationFrame(()=>{orbitFrame=0;draw();});
  });
  terrainView.setEnabled(true);
  const defaults={minViews:4,minAngle:10,maxGeometry:10,blurPixels:.5,minSpeed:.3};
  let site=null,image=null,plan=null,boundary=null,exclusions=[],draft=[],transform=null,running=false,searchReport=null;
  const number=id=>$(id).value.trim()===''?NaN:Number($(id).value);
  const dimensions=()=>({width:site?.width??number('siteWidth'),height:site?.height??number('siteHeight')});
  const ground=()=>site?.groundReference??0;
  const heading=axis=>typeof axis==='number'?axis:axis==='east-west'?90:0;
  function terrainAt(x,y){
    const {width,height}=dimensions();
    if(x<0||y<0||x>width||y>height)return null;
    if(!site)return 0;
    const n=site.gridSize,col=Math.round(x/width*(n-1)),row=Math.round(y/height*(n-1));
    return site.elevations[row*n+col];
  }
  function surfaceAt(x,y){
    const grid=site?.surfaceGrid;if(!grid)return terrainAt(x,y);
    const {width,height}=dimensions();if(x<0||y<0||x>width||y>height)return null;
    const n=grid.gridSize;return grid.elevations[Math.round(y/height*(n-1))*n+Math.round(x/width*(n-1))];
  }
  function placementAllowed(p){
    if(!site?.gcpPlacement)return true;
    const n=site.gridSize;return site.gcpPlacement.allowed[Math.round(p[1]/site.height*(n-1))*n+Math.round(p[0]/site.width*(n-1))];
  }
  function surfacePoints(){
    const {width,height}=dimensions(),n=site?.gridSize||26,points=[];
    for(let row=0;row<n;row++)for(let col=0;col<n;col++){
      const p=[col/(n-1)*width,row/(n-1)*height];
      const z=terrainAt(...p);if(z!==null&&CapturePlanning.inside(p,boundary))points.push([...p,z]);
    }
    return points;
  }
  function readSettings(){
    const state={...dimensions(),altitude:number('minAltitude'),fOverlap:number('minForward'),sOverlap:number('minSide'),
      sensorWidth:13.2,sensorHeight:8.8,focalLength:8.8,cameraProfile:$('cameraProfile').value,cameraOrientation:'shortAlong',
      numGcps:number('numGcps'),minSpacing:number('minSpacing'),boundary};
    const limits={minAltitude:number('minAltitude'),maxAltitude:number('maxAltitude'),minClearance:number('minClearance'),
      minForward:number('minForward'),maxForward:Math.min(90,number('minForward')+5),
      minSide:number('minSide'),maxSide:Math.min(85,number('minSide')+5),
      maxGdop:defaults.maxGeometry,maxPhotos:number('maxPhotos'),priority:$('priority').value,pathMode:'straight',
      searchHeadings:true,compareOrientations:false,acquisition:true,maxGsd:number('maxGsd')/100,
      maxSpeed:number('maxSpeed'),minSpeed:defaults.minSpeed,exposure:1/number('shutterDenominator'),blurPixels:defaults.blurPixels};
    return {state,limits};
  }
  function setStatus(text,error=false){$('optimizationStatus').textContent=text;$('optimizationStatus').classList.toggle('error',error);}
  function badge(text,kind=''){$('planBadge').textContent=text;$('planBadge').className='plan-badge '+kind;}
  function invalidate(message='Requirements changed. Find a new plan.'){
    plan=null;searchReport=null;badge('Not optimized');setStatus(message);renderResults();draw();
  }
  function selectSite(){
    site=sites.find(s=>s.id===$('surveySelect').value)||null;boundary=null;exclusions=[];draft=[];image=null;
    $('mapTool').value='view';updateMapTool();$('mapToolStatus').textContent='';
    $('customDimensions').hidden=!!site;['siteWidth','siteHeight'].forEach(id=>$(id).disabled=!!site);
    $('mapTitle').textContent=site?.name||'Custom survey area';
    $('avoidTrees').disabled=!site?.gcpPlacement;
    $('placementHint').textContent=site?.gcpPlacement
      ?`DSM/DTM screening excludes raised cover over ${site.gcpPlacement.maxRaisedHeightM} m and keeps a ${site.gcpPlacement.bufferM} m buffer. GDOP always uses DSM visibility when surface data is available. Review targets in the field.`
      :'Automatic vegetation screening needs DSM and DTM data. Use manual exclusions for custom areas.';
    updateSiteInfo();invalidate('Ready when you are.');
    if(site){const next=new Image();image=next;next.onload=()=>{if(image===next)draw();};next.onerror=()=>{if(image===next){image=null;draw();}};next.src=site.image;}
  }
  function updateSiteInfo(){
    const {width,height}=dimensions();
    const elevations=site?site.elevations.filter(Number.isFinite):[0];
    $('terrainInfo').textContent=site
      ?`DTM ground elevations ${Math.min(...elevations).toFixed(1)} to ${Math.max(...elevations).toFixed(1)} m · ${site.verticalDatum} · ${site.gridSize} × ${site.gridSize} sampled grid. Gaps indicate missing terrain.`
      :'Custom area uses flat ground at 0 m.';
    $('surveyInfo').textContent=Number.isFinite(width)&&Number.isFinite(height)?`${width.toFixed(0)} × ${height.toFixed(0)} m${site?' · terrain loaded':''}`:'Enter the site dimensions.';
  }
  async function optimize(event){
    event.preventDefault();if(running)return;
    if(!form.checkValidity()){form.reportValidity();return;}
    if(draft.length){setStatus('Finish or cancel your boundary drawing before optimizing.',true);return;}
    const controls=[...form.querySelectorAll('input,select,button')],disabled=controls.map(c=>c.disabled);
    running=true;controls.forEach(c=>c.disabled=true);$('exportFlight').disabled=true;$('exportGcps').disabled=true;
    $('optimizeMission').firstElementChild.textContent='Finding your plan…';badge('Searching','busy');setStatus('Starting Python geometric route search…');$('cancelSearch').hidden=false;$('cancelSearch').disabled=false;
    const progress=$('searchProgress');progress.hidden=false;progress.removeAttribute('value');
    await new Promise(r=>setTimeout(r,30));
    try{
      const {state,limits}=readSettings(),points=surfacePoints();
      if(!points.length)throw Error('No usable terrain falls inside this boundary. Reset the boundary or choose a larger area.');
      const request={state,limits,points,ground:ground(),exclusions,
        gcpMode:$('gcpMode').value,minGcps:number('minGcps'),
        maxGcpDistance:$('gcpMode').value==='optimize'&&$('maxGcpDistance').value.trim()?number('maxGcpDistance'):null,
        turnRadius:number('turnRadius'),searchBudget:number('searchBudget'),
        checkTerrain:$('terrainSight').checked,
        avoidRaisedCover:$('avoidTrees').checked,
        placementGrid:site?.gcpPlacement?{gridSize:site.gridSize,allowed:site.gcpPlacement.allowed}:null,
        surfaceGrid:site?.surfaceGrid||null,
        terrainGrid:site?{gridSize:site.gridSize,elevations:site.elevations}:null};
      const result=await PythonPlanner.solve(request,message=>{
        if(message.type==='status')setStatus(message.message);
        else setStatus(`Checking geometric route ${message.evaluated_routes} at ${message.altitude_m} m…`);
      });
      if(!result.plan){
        badge(plan?'Previous plan retained':'No plan found');
        setStatus(`No plan met all requirements in this search.${plan?' Your previous plan is retained.':''} Try a larger pixel size, a wider height range, or smaller GCP spacing. Open-ground and visibility limits can also reduce available targets.${$('terrainSight').checked?' Terrain visibility also rejects paths through missing terrain data.':''}`,true);
      }else{
        plan=PythonPlanner.adapt(result,state);searchReport=result.diagnostics;badge('Plan ready','ready');
        setStatus(`Plan found. Coverage checked; ${plan.gcps.points.length} GCPs placed.`);
      }
      renderResults();draw();
    }catch(error){setStatus(error.message,true);badge(plan?'Previous plan retained':'Check settings');}
    finally{
      running=false;controls.forEach((c,i)=>c.disabled=disabled[i]);progress.hidden=true;$('cancelSearch').hidden=true;
      $('optimizeMission').firstElementChild.textContent='Find best plan';$('exportFlight').disabled=!plan;$('exportGcps').disabled=!plan;
    }
  }
  function renderResults(){
    $('exportFlight').disabled=!plan;$('exportGcps').disabled=!plan;$('planDetails').hidden=!plan;
    $('mapEmpty').hidden=!!plan||draft.length>0;
    if(!plan){
      ['resultTime','resultPhotos','resultHeight','resultGcps'].forEach(id=>$(id).textContent='—');
      $('resultPhotoDetail').textContent='Planned capture positions';$('resultGcpDetail').textContent='Selected by GDOP';
      $('planSummary').textContent='Set your requirements and select Find best plan to compare routes.';$('gcpRows').replaceChildren();$('planMetrics').replaceChildren();return;
    }
    const r=plan.route,s=plan.state,g=plan.gcps;
    $('resultTime').innerHTML=`${(r.time/60).toFixed(1)} <em>min</em>`;$('resultPhotos').textContent=r.photos.toLocaleString();
    $('resultHeight').innerHTML=`${s.altitude.toFixed(0)} <em>m</em>`;$('resultGcps').textContent=g.points.length;
    $('resultPhotoDetail').textContent=`${(r.gsd*100).toFixed(2)} cm/pixel`;$('resultGcpDetail').textContent=`At least ${s.minSpacing} m apart`;
    $('planSummary').textContent=`${r.distance.toFixed(0)} m geometric route · ${r.rounded?'rounded turns':'angular turns'} · ${r.speed.toFixed(2)} m/s · fixed camera heading ${heading(r.axis)}°. Geometric coverage checked at ${plan.points.length} ground samples.`;
    const bounds=searchReport.survey_bounds_m;
    const metrics=[['Survey sample extent',`${(bounds[2]-bounds[0]).toFixed(0)} × ${(bounds[3]-bounds[1]).toFixed(0)} m`],['Route alternatives refined',searchReport.refinement_checks.filter(v=>v.checks>0).length],['Minimum terrain clearance',plan.clearance.toFixed(1)+' m'],['Maximum distance to a GCP',g.maxDistance.toFixed(1)+' m'],['Mean GCP GDOP',g.meanGdop.toFixed(3)],['GCP surface visibility',searchReport.gcp_surface_visibility?'DSM checked':'Ground geometry only'],['Minimum GCP photo views',Math.min(...g.viewCounts)],['Minimum usable views',Math.min(...plan.analysis.counts)],['Minimum viewing spread',Math.min(...plan.analysis.angles).toFixed(1)+'°'],['Geometric routes checked',searchReport.evaluated_routes],['Midpoint tours attempted',searchReport.midpoint_routes_attempted],['Initial grid distance',searchReport.shortest_grid_seed_m?.toFixed(0)+' m'],['Search limit',searchReport.evaluation_budget_per_altitude+' checks per height']];
    $('planMetrics').replaceChildren(...metrics.map(([key,value])=>{const d=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;d.append(dt,dd);return d;}));
    $('coordinateInfo').textContent=site?`${site.crs} · ${site.verticalDatum} heights. Suggested locations; survey these coordinates in the field.`:'Local coordinates in metres from the southwest corner. Suggested locations, not surveyed control.';
    $('gcpRows').replaceChildren(...g.points.map((p,i)=>{const tr=document.createElement('tr');[i+1,p[0]+(site?.west||0),p[1]+(site?.south||0),p[2]].forEach((v,j)=>{const td=document.createElement('td');td.textContent=j===0?String(v):v.toFixed(3);tr.append(td);});return tr;}));
  }
  function setViewMode(mode){
    if(mode==='3d'&&$('mapTool').value!=='view'){
      draft=[];$('mapTool').value='view';updateMapTool();renderResults();
    }
    viewMode=mode;terrainView.setEnabled(mode==='3d');
    $('view3d').setAttribute('aria-pressed',String(mode==='3d'));
    $('view2d').setAttribute('aria-pressed',String(mode==='2d'));
    $('resetView').disabled=mode==='2d';$('surfaceStatus').hidden=mode==='2d';
    canvas.parentElement.querySelector('.north-marker').hidden=mode==='3d';
    $('viewInstructions').textContent=mode==='3d'
      ?'Drag to orbit · Scroll or pinch to zoom · Shift-drag or two fingers to pan'
      :'Top-down map · Draw boundaries and GCP exclusions using Advanced settings';
    canvas.setAttribute('aria-label',mode==='3d'
      ?'3D terrain, flight path and GCPs. Drag or use arrow keys to orbit. Scroll or use plus and minus to zoom. Zero resets.'
      :'Top-down survey boundary, flight path and numbered GCP locations');
    draw();
  }
  function draw(){
    const heatRange=GdopHeatmap.range(plan?.heatmap);
    $('gdopLegend').hidden=!$('showGdop').checked;
    $('gdopLegend').textContent=heatRange
      ?`GDOP ${heatRange.min.toFixed(2)} (green, lower) to ${heatRange.max.toFixed(2)} (red, higher), logarithmic scale. Gray = blocked, unknown, or singular observation geometry. Scores use the current route.`
      :'Run Find best plan to calculate the GDOP heatmap.';
    const originalMesh=$('surfaceModel').value==='mesh'&&site?.sceneMesh;
    $('surfaceModel').disabled=viewMode==='2d'||!site?.sceneMesh;
    $('verticalScale').disabled=viewMode==='2d'||!!originalMesh;
    if(originalMesh){$('verticalScale').value='1';terrainView.exaggeration=1;}
    terrainView.model=$('surfaceModel').value;
    if(viewMode==='3d'){
      transform=null;
      const {width,height}=dimensions();
      if(Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0)
        terrainView.render({site,width,height,image,plan,boundary,exclusions,terrainAt,surfaceAt,placementAllowed,
          showGdop:$('showGdop').checked,showPlacement:$('showPlacement').checked,
          showCoverage:$('showCoverage').checked,showMidpoints:$('showMidpoints').checked});
      else{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);terrainView.surfaceRenderer.canvas.hidden=true;}
      $('surfaceStatus').textContent=terrainView.status;
      return;
    }
    const box=canvas.getBoundingClientRect(),w=box.width,h=box.height,dpr=window.devicePixelRatio||1;
    if(!w||!h)return;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const {width,height}=dimensions();if(!(width>0&&height>0&&Number.isFinite(width)&&Number.isFinite(height))){transform=null;return;}
    const margin=30,scale=Math.max(.001,Math.min((w-2*margin)/width,(h-2*margin)/height)),x=(w-width*scale)/2,y=(h-height*scale)/2;
    transform={x,y,scale,height};const px=p=>[x+p[0]*scale,y+(height-p[1])*scale];
    if(image?.complete&&image.naturalWidth){ctx.drawImage(image,x,y,width*scale,height*scale);ctx.fillStyle='#0d233324';ctx.fillRect(x,y,width*scale,height*scale);}
    else{
      ctx.strokeStyle='#6689a119';ctx.lineWidth=1;const step=Math.max(10,Math.ceil(Math.max(width,height)/12/10)*10);
      for(let i=0;i<=width;i+=step){ctx.beginPath();ctx.moveTo(...px([i,0]));ctx.lineTo(...px([i,height]));ctx.stroke();}
      for(let i=0;i<=height;i+=step){ctx.beginPath();ctx.moveTo(...px([0,i]));ctx.lineTo(...px([width,i]));ctx.stroke();}
    }
    function line(points,color,dash=[],closed=false){if(!points.length)return;ctx.beginPath();ctx.setLineDash(dash);points.forEach((p,i)=>{if(i)ctx.lineTo(...px(p));else ctx.moveTo(...px(p));});if(closed)ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([]);}
    line([[0,0],[width,0],[width,height],[0,height]],'#7997ad80',[],true);
    if(boundary)line(boundary,'#b8f4df',[],true);
    if($('showPlacement').checked||($('showGdop').checked&&plan)){
      const points=plan?.points||surfacePoints();
      const size=Math.max(2,scale*Math.min(width,height)/(site?.gridSize-1||25)*.9);
      points.forEach((p,i)=>{
        if($('showGdop').checked&&plan)ctx.fillStyle=GdopHeatmap.color(plan.heatmap?.[i],heatRange);
        else{if(placementAllowed(p))return;ctx.fillStyle='rgba(242,132,109,.45)';}
        const [a,b]=px(p);ctx.fillRect(a-size/2,b-size/2,size,size);
        if($('showPlacement').checked&&$('showGdop').checked&&!placementAllowed(p)){
          ctx.strokeStyle='#ed866a';ctx.lineWidth=.8;ctx.strokeRect(a-size/2,b-size/2,size,size);
        }
      });
    }
    if(plan&&$('showCoverage').checked){
      const size=Math.max(2,scale*Math.max(width,height)/(site?.gridSize||26)*.8);
      plan.points.forEach((p,i)=>{const gap=plan.analysis.counts[i]<defaults.minViews||plan.analysis.angles[i]<defaults.minAngle;if($('showGdop').checked&&!gap)return;ctx.fillStyle=gap?'#ff8f80a0':'#6cda9c38';const [a,b]=px(p);ctx.fillRect(a-size/2,b-size/2,size,size);});
    }
    if(plan){
      // Path only: individual photo dots obscure the route at survey scale.
      line(plan.path.map(p=>p.position),'#081b33aa');ctx.lineWidth=1.3;line(plan.path.map(p=>p.position),'#8bc0ffcf');
      const start=px(plan.cams[0]);ctx.fillStyle='#b9dbff';ctx.beginPath();ctx.arc(...start,4,0,2*Math.PI);ctx.fill();
    }
    exclusions.forEach(e=>{const [a,b]=px([e.x,e.y]);ctx.beginPath();ctx.arc(a,b,e.radius*scale,0,Math.PI*2);ctx.fillStyle='#e77c6b30';ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='#f59888';ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);});
    if(plan&&$('showMidpoints').checked)plan.midpoints.forEach(p=>{
      const [a,b]=px(p);ctx.strokeStyle='#81f7e4';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(a,b,4,0,Math.PI*2);ctx.stroke();
    });
    if(plan)plan.gcps.points.forEach((p,i)=>{
      const [a,b]=px(p);ctx.shadowColor='#07182570';ctx.shadowBlur=6;ctx.fillStyle='#f4c768';ctx.strokeStyle='#fff0bb';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(a,b,11,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle='#3b341f';ctx.font='600 11px Segoe UI, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(i+1,a,b+.5);
    });
    if(draft.length){line(draft,'#b8f4df',[5,4],draft.length>2);draft.forEach(p=>{ctx.fillStyle='#d9fff1';ctx.beginPath();ctx.arc(...px(p),4,0,Math.PI*2);ctx.fill();});}
    // Metre scale, rounded down to a useful length.
    const ideal=Math.min(width/4,100/scale),power=10**Math.floor(Math.log10(ideal)),length=[5,2,1].map(n=>n*power).find(n=>n<=ideal)||power;
    ctx.strokeStyle='#d3e1ed';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(20,h-20);ctx.lineTo(20+length*scale,h-20);ctx.stroke();ctx.font='10px Segoe UI, sans-serif';ctx.fillStyle='#d3e1ed';ctx.textAlign='left';ctx.fillText(length+' m',20,h-30);
  }
  function updateMapTool(){
    const mode=$('mapTool').value;if(mode!=='view'&&viewMode!=='2d')setViewMode('2d');$('boundaryActions').hidden=mode!=='boundary';$('excludeOptions').hidden=mode!=='exclude';
    canvas.classList.toggle('editing',mode!=='view');canvas.parentElement.classList.toggle('editing',mode!=='view');
    $('mapToolHint').textContent=mode==='boundary'?'Click at least three corners on the map, then Use boundary. Transit can cross outside this imaging boundary.':mode==='exclude'?'Click the map to keep GCPs away from water, unstable ground or inaccessible areas. Exclusions do not change the flight path.':'Refine the survey area or avoid unsuitable GCP locations.';
  }
  function exportCsv(rows,name){const url=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download=(site?.id||'custom')+'-'+name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('exportGcps').addEventListener('click',()=>{
    if(!plan)return;const rows=['id,easting_m,northing_m,elevation_m,visible_geometry_score,crs,vertical_datum'];
    plan.gcps.points.forEach((p,i)=>rows.push(['GCP'+(i+1),(p[0]+(site?.west||0)).toFixed(3),(p[1]+(site?.south||0)).toFixed(3),p[2].toFixed(3),plan.gcps.values[i].toFixed(6),site?.crs||'local',site?.verticalDatum||'local'].join(',')));exportCsv(rows,'gcps');
  });
  $('exportFlight').addEventListener('click',()=>{
    if(!plan)return;const rows=['waypoint_id,capture_photo,easting_m,northing_m,camera_elevation_m,crs,vertical_datum,elapsed_estimate_s,footprint_heading_deg,tilt_from_nadir_deg,speed_mps,photo_interval_s'];let elapsed=0;
    plan.path.forEach((p,i)=>{const c=p.position;if(i){const prev=plan.path[i-1].position;elapsed+=Math.hypot(c[0]-prev[0],c[1]-prev[1])/plan.route.speed;}
      rows.push([i+1,p.capture,(c[0]+(site?.west||0)).toFixed(3),(c[1]+(site?.south||0)).toFixed(3),c[2].toFixed(3),site?.crs||'local',site?.verticalDatum||'local',elapsed.toFixed(3),heading(plan.route.axis),0,plan.route.speed.toFixed(3),plan.route.interval].join(','));});exportCsv(rows,'flight');
  });
  $('view3d').addEventListener('click',()=>setViewMode('3d'));
  $('view2d').addEventListener('click',()=>setViewMode('2d'));
  $('resetView').addEventListener('click',()=>{terrainView.reset();draw();});
  $('surfaceModel').addEventListener('change',draw);
  $('verticalScale').addEventListener('change',()=>{terrainView.exaggeration=number('verticalScale');draw();});
  canvas.addEventListener('dblclick',()=>{if(viewMode==='3d'){terrainView.reset();draw();}});
  $('cancelSearch').addEventListener('click',()=>PythonPlanner.cancel());
  $('showMidpoints').addEventListener('change',draw);
  $('showGdop').addEventListener('change',draw);
  $('showPlacement').addEventListener('change',draw);
  function updateCountMode(){
    const fixed=$('gcpMode').value==='fixed';
    $('countRange').hidden=fixed;$('minGcps').disabled=fixed;
    $('gcpCountLabel').textContent=fixed?'GCP count':'Maximum GCPs';
  }
  $('gcpMode').addEventListener('change',updateCountMode);updateCountMode();
  form.addEventListener('submit',optimize);
  form.addEventListener('invalid',event=>{if(event.target.closest('.advanced'))$('advancedSettings').open=true;},true);
  form.querySelectorAll('input,select').forEach(input=>input.addEventListener('input',()=>{
    if(running||['surveySelect','mapTool','excludeRadius'].includes(input.id))return;
    if(['siteWidth','siteHeight'].includes(input.id)){boundary=null;exclusions=[];draft=[];updateSiteInfo();}
    invalidate();
  }));
  $('surveySelect').addEventListener('change',selectSite);
  $('showCoverage').addEventListener('change',()=>{$('coverageKey').hidden=!$('showCoverage').checked;draw();});
  $('mapTool').addEventListener('change',()=>{draft=[];updateMapTool();renderResults();draw();});
  canvas.addEventListener('click',event=>{
    if(running||!transform)return;const mode=$('mapTool').value;if(mode==='view')return;
    const rect=canvas.getBoundingClientRect(),{x,y,scale,height}=transform,p=[(event.clientX-rect.left-x)/scale,height-(event.clientY-rect.top-y)/scale],d=dimensions();
    if(p[0]<0||p[1]<0||p[0]>d.width||p[1]>d.height)return;
    if(mode==='boundary'){draft.push(p);$('mapToolStatus').textContent=`${draft.length} boundary corners selected.`;$('mapEmpty').hidden=true;draw();}
    if(mode==='exclude'){
      const radius=number('excludeRadius');if(!Number.isFinite(radius)||radius<1||radius>100){$('mapToolStatus').textContent='Enter an exclusion radius from 1 to 100 m.';return;}
      exclusions.push({x:p[0],y:p[1],radius});$('mapToolStatus').textContent=`${exclusions.length} GCP exclusion areas.`;invalidate('GCP exclusions changed. Find a new plan.');
    }
  });
  $('finishBoundary').addEventListener('click',()=>{
    try{
      const {width,height}=dimensions(),next=CapturePlanning.polygon(JSON.stringify(draft),width,height);
      const old=boundary;boundary=next;if(surfacePoints().length<3){boundary=old;throw Error('Select a larger boundary with at least three terrain samples.');}
      draft=[];$('mapTool').value='view';updateMapTool();$('mapToolStatus').textContent='Custom survey boundary applied.';invalidate('Survey boundary changed. Find a new plan.');
    }catch(error){$('mapToolStatus').textContent=error.message;}
  });
  $('cancelBoundary').addEventListener('click',()=>{draft=[];$('mapTool').value='view';updateMapTool();$('mapToolStatus').textContent='Boundary drawing canceled.';renderResults();draw();});
  $('clearBoundary').addEventListener('click',()=>{boundary=null;draft=[];$('mapTool').value='view';updateMapTool();$('mapToolStatus').textContent='Using the full survey extent.';invalidate('Survey boundary reset. Find a new plan.');});
  $('clearExclusions').addEventListener('click',()=>{exclusions=[];$('mapToolStatus').textContent='GCP exclusions cleared.';invalidate('GCP exclusions cleared. Find a new plan.');});
  const resize=new ResizeObserver(draw);resize.observe(canvas.parentElement);
  sites.forEach(s=>{const option=document.createElement('option');option.value=s.id;option.textContent=s.name;$('surveySelect').append(option);});
  $('surveySelect').value=sites[0]?.id||'';selectSite();setViewMode('3d');
})();
