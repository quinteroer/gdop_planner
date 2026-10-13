/* Discrete constrained search. Also usable from Node for independent tests. */
(function (root) {
  'use strict';
  const steps = (lo, hi, step) => {
    const values = [lo];
    for (let v = lo + step; v < hi; v += step) values.push(v);
    if (hi > lo) values.push(hi);
    return values;
  };
  function route(s, axis, ground, highest, style = 'straight', turnRadius = 5, turnBuffer = 20) {
    // Conservative square footprint at the highest sampled terrain elevation.
    const foot = (ground + s.altitude - highest) * s.sensorWidth / s.focalLength;
    if (!(foot > 0)) return null;
    const along = axis === 'north-south' ? s.height : s.width;
    const across = axis === 'north-south' ? s.width : s.height;
    const rows = Math.ceil(across / (foot * (1 - s.sOverlap / 100))) + 1;
    const perRow = Math.ceil(along / (foot * (1 - s.fOverlap / 100))) + 1;
    const gap = across / (rows - 1);
    if (style === 'curved' && (2 * turnRadius > gap + 1e-9 || turnRadius > turnBuffer)) return null;
    const extra = style === 'curved' ? (rows - 1) * (Math.PI - 2) * turnRadius : 0;
    return {axis, style, turnRadius:style === 'curved' ? turnRadius : 0, rows, perRow,
      photos: rows * perRow, distance: rows * along + across + extra};
  }
  function cameras(s, r, ground) {
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
  async function solve(s, limits, terrain, evaluate, progress) {
    const nums = ['minAltitude','maxAltitude','minClearance','minForward','maxForward','minSide','maxSide','maxGdop','maxPhotos'];
    if (nums.some(k => !Number.isFinite(limits[k]))) throw Error('Enter valid numbers for all optimization limits.');
    const pathMode = limits.pathMode || 'straight';
    if (!['straight','curved','auto'].includes(pathMode)) throw Error('Choose a valid flight path style.');
    if (pathMode !== 'straight' && (!Number.isFinite(limits.turnRadius) || limits.turnRadius <= 0 || limits.turnRadius > 100 || !Number.isFinite(limits.turnBuffer) || limits.turnBuffer < 0 || limits.turnBuffer > 100))
      throw Error('Enter a turn radius above 0 and at most 100 m, and a turn buffer from 0 to 100 m.');
    if (limits.minAltitude < 20 || limits.maxAltitude > 200 || limits.minAltitude > limits.maxAltitude ||
        limits.minClearance <= 0 || limits.minForward < 40 || limits.maxForward > 90 || limits.minForward > limits.maxForward ||
        limits.minSide < 30 || limits.maxSide > 85 || limits.minSide > limits.maxSide || limits.maxGdop <= 0 || limits.maxPhotos < 3 || limits.maxPhotos > 5000)
      throw Error('Check limit ranges: height 20–200 m, forward overlap 40–90%, side overlap 30–85%, positive clearance/GDOP, and 3–5000 photos.');
    const options = [];
    for (const altitude of steps(limits.minAltitude, limits.maxAltitude, 5)) {
      if (terrain.ground + altitude - terrain.highest < limits.minClearance) continue;
      for (const fOverlap of steps(limits.minForward, limits.maxForward, 5)) {
        for (const sOverlap of steps(limits.minSide, limits.maxSide, 5)) {
          const state = {...s, altitude, fOverlap, sOverlap};
          for (const axis of ['north-south','east-west']) {
            for (const style of pathMode === 'auto' ? ['straight','curved'] : [pathMode]) {
              const r = route(state, axis, terrain.ground, terrain.highest, style, limits.turnRadius, limits.turnBuffer);
              if (r && r.photos <= limits.maxPhotos) options.push({state, route:r});
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
        : limits.priority === 'distance' ? a.route.distance-b.route.distance : a.score-b.score;
      return primary || a.route.distance-b.route.distance || a.state.altitude-b.state.altitude || a.route.photos-b.route.photos;
    });
    let tested = 0;
    for (const o of options) {
      if (tested % 8 === 0) {
        progress?.(tested, options.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const cams = cameras(o.state, o.route, terrain.ground);
      const result = evaluate(o.state, cams, limits.maxGdop);
      tested++;
      if (result) return {plan:{...o, cams, path:trajectory(o.state,o.route,terrain.ground), ...result}, tested, total:options.length};
    }
    return {plan:null, tested, total:options.length};
  }
  const api = {solve, route, cameras, trajectory};
  if (typeof module !== 'undefined') module.exports = api;
  else root.FlightOptimizer = api;
})(typeof window !== 'undefined' ? window : globalThis);
