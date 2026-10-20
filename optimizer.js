/* Discrete constrained search. Also usable from Node for independent tests. */
(function (root) {
  'use strict';
  const steps = (lo, hi, step) => {
    const values = [lo];
    for (let v = lo + step; v < hi; v += step) values.push(v);
    if (hi > lo) values.push(hi);
    return values;
  };
  function footprint(height,s) {
    if (!(height>0)) return {across:0,along:0};
    if (s.cameraProfile==='mini48' || s.cameraProfile==='mini12') {
      const diagonal=2*height*Math.tan(82.1*Math.PI/360);
      const width=diagonal*.8,heightM=diagonal*.6;
      const pixels=s.cameraProfile==='mini48'?8064:4032;
      return {across:s.cameraOrientation==='longAlong'?heightM:width,
        along:s.cameraOrientation==='longAlong'?width:heightM,gsd:width/pixels,
        interval:s.cameraProfile==='mini48'?5:2};
    }
    const across=height*s.sensorWidth/s.focalLength;
    return {across,along:height*(s.sensorHeight || s.sensorWidth)/s.focalLength,
      gsd:null,interval:s.captureInterval || 2};
  }
  function viewing(p,c,s,axis='north-south') {
    const f=footprint(c[2]-(p[2]||0),s);
    const dx=Math.abs(p[0]-c[0]),dy=Math.abs(p[1]-c[1]);
    if(typeof axis==='number') {
      const a=axis*Math.PI/180,x=p[0]-c[0],y=p[1]-c[1];
      return Math.abs(x*Math.cos(a)-y*Math.sin(a))<=f.across/2+1e-9 && Math.abs(x*Math.sin(a)+y*Math.cos(a))<=f.along/2+1e-9;
    }
    return axis==='north-south' ? dx<=f.across/2+1e-9 && dy<=f.along/2+1e-9
      : dx<=f.along/2+1e-9 && dy<=f.across/2+1e-9;
  }
  function route(s, axis, ground, highest, style = 'straight', turnRadius = 5, turnBuffer = 20) {
    if(typeof axis==='number'||s.boundary)return clippedRoute(s,axis,ground,highest,style);
    // Conservative square footprint at the highest sampled terrain elevation.
    const foot = footprint(ground+s.altitude-highest,s);
    if (!(foot.across>0 && foot.along>0)) return null;
    const along = axis === 'north-south' ? s.height : s.width;
    const across = axis === 'north-south' ? s.width : s.height;
    const rows = Math.ceil(across / (foot.across * (1 - s.sOverlap / 100))) + 1;
    const perRow = Math.ceil(along / (foot.along * (1 - s.fOverlap / 100))) + 1;
    const gap = across / (rows - 1);
    if (style === 'curved' && (2 * turnRadius > gap + 1e-9 || turnRadius > turnBuffer)) return null;
    const extra = style === 'curved' ? (rows - 1) * (Math.PI - 2) * turnRadius : 0;
    return {axis, style, turnRadius:style === 'curved' ? turnRadius : 0, rows, perRow,
      photos: rows * perRow, photoSpacing:along/(perRow-1), distance: rows * along + across + extra};
  }
  function cameras(s, r, ground) {
    if(r.positions)return r.positions;
    const cams = [];
    for (let i = 0; i < r.rows; i++) {
      for (let j = 0; j < r.perRow; j++) {
        const across = i / (r.rows - 1);
        const along = (i % 2 ? r.perRow - 1 - j : j) / (r.perRow - 1);
        cams.push(r.axis === 'north-south'
          ? [across * s.width, along * s.height, ground + s.altitude]
          : [along * s.width, across * s.height, ground + s.altitude]);
      }
    }
    return cams;
  }
  function trajectory(s, r, ground) {
    if(r.positions)return r.positions.map(position=>({position,capture:true}));
    const cams = cameras(s,r,ground);
    const points = [];
    const across = r.axis === 'north-south' ? s.width : s.height;
    const along = r.axis === 'north-south' ? s.height : s.width;
    const map = (u,v) => r.axis === 'north-south' ? [u,v,ground+s.altitude] : [v,u,ground+s.altitude];
    for (let i=0;i<r.rows;i++) {
      for (let j=0;j<r.perRow;j++) points.push({position:cams[i*r.perRow+j],capture:true});
      if (r.style !== 'curved' || i === r.rows-1) continue;
      const radius = r.turnRadius, u0 = i/(r.rows-1)*across, u1 = (i+1)/(r.rows-1)*across;
      const end = i%2 === 0 ? along : 0, sign = i%2 === 0 ? 1 : -1;
      // Two tangent quarter circles connected by a straight segment outside the survey.
      for (let k=1;k<=16;k++) {
        const a = k/16*Math.PI/2;
        points.push({position:map(u0+radius-radius*Math.cos(a),end+sign*radius*Math.sin(a)),capture:false});
      }
      points.push({position:map(u1-radius,end+sign*radius),capture:false});
      for (let k=1;k<16;k++) {
        const a = k/16*Math.PI/2;
        points.push({position:map(u1-radius+radius*Math.sin(a),end+sign*radius*Math.cos(a)),capture:false});
      }
    }
    return points;
  }
  function clippedRoute(s,axis,ground,highest,style) {
    if(style!=='straight')return null; // No unsupported curved connectors for clipped segments.
    const heading=typeof axis==='number'?axis:axis==='east-west'?90:0,a=heading*Math.PI/180;
    const poly=s.boundary||[[0,0],[s.width,0],[s.width,s.height],[0,s.height]];
    const local=poly.map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)]);
    const lo=Math.min(...local.map(p=>p[0])),hi=Math.max(...local.map(p=>p[0]));
    const f=footprint(ground+s.altitude-highest,s);if(!(f.across>0&&f.along>0))return null;
    const rows=Math.ceil((hi-lo)/(f.across*(1-s.sOverlap/100)))+1;
    if(rows>5000)return null;
    const positions=[];let spacing=Infinity,segments=0;
    for(let i=0;i<rows;i++) {
      // Move boundary-coincident scanlines just inside to avoid duplicate vertex hits.
      const scan=lo+(hi-lo)*(i+.5)/rows,hits=[];
      for(let j=0;j<local.length;j++) {
        const p=local[j],q=local[(j+1)%local.length];
        if((p[0]<=scan&&q[0]>scan)||(q[0]<=scan&&p[0]>scan))hits.push(p[1]+(scan-p[0])*(q[1]-p[1])/(q[0]-p[0]));
      }
      hits.sort((x,y)=>x-y);const line=[];
      for(let j=0;j+1<hits.length;j+=2) {
        const length=hits[j+1]-hits[j],n=Math.max(2,Math.ceil(length/(f.along*(1-s.fOverlap/100)))+1);
        spacing=Math.min(spacing,length/(n-1));segments++;
        if(positions.length+line.length+n>5000)return null;
        for(let k=0;k<n;k++) {
          const v=hits[j]+length*k/(n-1);
          line.push([scan*Math.cos(a)+v*Math.sin(a),-scan*Math.sin(a)+v*Math.cos(a),ground+s.altitude]);
        }
      }
      if(i%2)line.reverse();positions.push(...line);
    }
    if(positions.length<3||!Number.isFinite(spacing)||spacing<=0)return null;
    const distance=positions.slice(1).reduce((v,p,i)=>v+Math.hypot(p[0]-positions[i][0],p[1]-positions[i][1]),0);
    return {axis:heading,style:'straight',turnRadius:0,rows,perRow:null,segments,positions,photos:positions.length,photoSpacing:spacing,distance};
  }
  async function solve(s, limits, terrain, evaluate, progress) {
    const nums = ['minAltitude','maxAltitude','minClearance','minForward','maxForward','minSide','maxSide','maxGdop','maxPhotos'];
    if (nums.some(k => !Number.isFinite(limits[k]))) throw Error('Enter valid numbers for all optimization limits.');
    const pathMode = limits.pathMode || 'straight';
    if (!['straight','curved','auto'].includes(pathMode)) throw Error('Choose a valid flight path style.');
    if (pathMode !== 'straight' && (!Number.isFinite(limits.turnRadius) || limits.turnRadius <= 0 || limits.turnRadius > 100 || !Number.isFinite(limits.turnBuffer) || limits.turnBuffer < 0 || limits.turnBuffer > 100))
      throw Error('Enter a turn radius above 0 and at most 100 m, and a turn buffer from 0 to 100 m.');
    if (!Number.isFinite(s.width)||s.width<=0||!Number.isFinite(s.height)||s.height<=0||!Number.isFinite(s.sensorWidth)||s.sensorWidth<=0||!Number.isFinite(s.focalLength)||s.focalLength<=0)
      throw Error('Enter valid site and camera dimensions.');
    if (limits.acquisition && (!Number.isFinite(limits.maxGsd)||limits.maxGsd<=0||!Number.isFinite(limits.maxSpeed)||limits.maxSpeed<=0||!Number.isFinite(limits.minSpeed)||limits.minSpeed<=0||limits.minSpeed>limits.maxSpeed||!Number.isFinite(limits.exposure)||limits.exposure<=0||!Number.isFinite(limits.blurPixels)||limits.blurPixels<=0))
      throw Error('Check GSD, speed range, exposure and blur limits.');
    if (limits.acquisition && !['mini48','mini12'].includes(s.cameraProfile))throw Error('Choose a Mini 4 Pro profile for GSD and capture timing checks.');
    if (!s.cameraProfile?.startsWith('mini') && s.sensorHeight !== undefined && (!Number.isFinite(s.sensorHeight) || s.sensorHeight <= 0))throw Error('Enter a positive sensor height.');
    if (limits.minAltitude < 10 || limits.maxAltitude > 200 || limits.minAltitude > limits.maxAltitude ||
        limits.minClearance <= 0 || limits.minForward < 40 || limits.maxForward > 90 || limits.minForward > limits.maxForward ||
        limits.minSide < 30 || limits.maxSide > 85 || limits.minSide > limits.maxSide || limits.maxGdop <= 0 || limits.maxPhotos < 3 || limits.maxPhotos > 5000)
      throw Error('Check limit ranges: height 10–200 m, forward overlap 40–90%, side overlap 30–85%, positive clearance/geometry score, and 3–5000 photos.');
    const options = [];
    for (const altitude of steps(limits.minAltitude, limits.maxAltitude, 5)) {
      if (terrain.ground + altitude - terrain.highest < limits.minClearance) continue;
      for (const fOverlap of steps(limits.minForward, limits.maxForward, 5)) {
        for (const sOverlap of steps(limits.minSide, limits.maxSide, 5)) {
          const orientations=s.cameraProfile?.startsWith('mini') && limits.compareOrientations ? ['shortAlong','longAlong'] : [s.cameraOrientation || 'shortAlong'];
          for(const cameraOrientation of orientations) {
          const state = {...s, altitude, fOverlap, sOverlap,cameraOrientation};
          for (const axis of limits.searchHeadings ? ['north-south','east-west',...steps(0,165,15)] : ['north-south','east-west']) {
            for (const style of pathMode === 'auto' ? ['straight','curved'] : [pathMode]) {
              const r = route(state, axis, terrain.ground, terrain.highest, style, limits.turnRadius, limits.turnBuffer);
              if (r && r.photos <= limits.maxPhotos) {
                // Timing applies across row transitions and disjoint clipped segments too.
                const trace=trajectory(state,r,terrain.ground);let travel=0,minCaptureGap=Infinity,seen=false;
                for(let i=0;i<trace.length;i++){
                  if(i)travel+=Math.hypot(trace[i].position[0]-trace[i-1].position[0],trace[i].position[1]-trace[i-1].position[1]);
                  if(trace[i].capture){if(seen)minCaptureGap=Math.min(minCaptureGap,travel);seen=true;travel=0;}
                }
                r.photoSpacing=Math.min(r.photoSpacing,minCaptureGap);
                const highestFoot=footprint(terrain.ground+altitude-terrain.highest,state);
                const lowestFoot=footprint(terrain.ground+altitude-(terrain.lowest??terrain.highest),state);
                r.gsd=lowestFoot.gsd;
                if(limits.acquisition && r.gsd>limits.maxGsd)continue;
                r.interval=highestFoot.interval;
                r.speed=limits.acquisition ? Math.min(limits.maxSpeed,r.photoSpacing/r.interval,
                  limits.blurPixels*highestFoot.gsd/limits.exposure) : (limits.maxSpeed || 3);
                if(limits.acquisition && r.speed+1e-9<limits.minSpeed)continue;
                r.blurPixels=limits.acquisition?r.speed*limits.exposure/highestFoot.gsd:null;
                r.time=r.distance/r.speed;
                options.push({state, route:r});
              }
            }
          }
          }
        }
      }
    }
    if (!options.length) return {plan:null, tested:0, total:0};
    const minDistance = Math.min(...options.map(o=>o.route.distance));
    options.forEach(o => o.score = o.route.distance / minDistance + o.state.altitude / limits.minAltitude);
    options.sort((a,b) => {
      const primary = limits.priority === 'height' ? a.state.altitude-b.state.altitude
        : limits.priority === 'distance' ? a.route.distance-b.route.distance
        : limits.priority === 'time' ? a.route.time-b.route.time : a.score-b.score;
      return primary || a.route.distance-b.route.distance || a.state.altitude-b.state.altitude || a.route.photos-b.route.photos;
    });
    let tested = 0;
    for (const o of options) {
      if (tested % 8 === 0) {
        progress?.(tested, options.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const cams = cameras(o.state, o.route, terrain.ground);
      const result = await evaluate(o.state, cams, limits.maxGdop,o.route);
      tested++;
      if (result) return {plan:{...o, cams, path:trajectory(o.state,o.route,terrain.ground), ...result}, tested, total:options.length};
    }
    return {plan:null, tested, total:options.length};
  }
  const api = {solve, route, cameras, trajectory,footprint,viewing};
  if (typeof module !== 'undefined') module.exports = api;
  else root.FlightOptimizer = api;
})(typeof window !== 'undefined' ? window : globalThis);
