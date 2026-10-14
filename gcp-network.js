/* Deterministic network selection. Scores are planning proxies, not RMSE. */
(function(root) {
  'use strict';
  const distance2 = (a,b) => (a[0]-b[0])**2+(a[1]-b[1])**2;
  function optimize(candidates, values, count, spacing, options={}) {
    if (!Number.isInteger(count) || count<1 || !Number.isFinite(spacing) || spacing<0)
      throw Error('Invalid GCP count or spacing.');
    const eligible=candidates.map((p,i)=>i).filter(i=>Number.isFinite(values[i]) && (!options.allowed || options.allowed(candidates[i],i)));
    const empty={points:[],values:[],indices:[],score:Infinity,maxDistance:Infinity,meanDistance:Infinity,starts:0,exchanges:0,method:'Distributed multi-start exchange'};
    if (eligible.length<count) return empty;
    const xs=eligible.map(i=>candidates[i][0]), ys=eligible.map(i=>candidates[i][1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const W=Math.max(maxX-minX,1e-6),H=Math.max(maxY-minY,1e-6),diag=Math.hypot(W,H);
    const region=i=>(candidates[i][0]>=(minX+maxX)/2?1:0)+(candidates[i][1]>=(minY+maxY)/2?2:0);
    const regions=[...new Set(eligible.map(region))];
    const central=i=>Math.abs((candidates[i][0]-minX)/W-.5)<=.2 && Math.abs((candidates[i][1]-minY)/H-.5)<=.2;
    const hasCenter=eligible.some(central);
    const requireRegions=count>=regions.length;
    const requireCenter=count>=regions.length+1 && hasCenter;
    const demands=options.demands?.length ? options.demands : eligible.map(i=>candidates[i]);
    // Deterministic spatial subsample for search; final metrics use all demands.
    const sampled=demands.filter((_,i)=>i%Math.max(1,Math.ceil(demands.length/144))===0);
    const lowZ=Math.min(...eligible.map(i=>candidates[i][2]||0)),highZ=Math.max(...eligible.map(i=>candidates[i][2]||0));
    const validSet=set=>set.length===count && (!requireRegions || regions.every(r=>set.some(i=>region(i)===r))) && (!requireCenter || set.some(central));
    const separated=(i,set,skip=-1)=>set.every((j,k)=>k===skip || distance2(candidates[i],candidates[j])+1e-9>=spacing*spacing);
    function metrics(set,points=sampled) {
      let maxDistance=0,sum=0;
      for (const p of points) { const d=Math.sqrt(Math.min(...set.map(i=>distance2(p,candidates[i]))));sum+=d;maxDistance=Math.max(maxDistance,d); }
      const meanDistance=sum/points.length;
      const geometry=set.reduce((v,i)=>v+values[i]/(1+values[i]),0)/set.length;
      const coveredZ=Math.max(...set.map(i=>candidates[i][2]||0))-Math.min(...set.map(i=>candidates[i][2]||0));
      const elevation=highZ-lowZ>1e-6 ? 1-coveredZ/(highZ-lowZ) : 0;
      const missing=regions.filter(r=>!set.some(i=>region(i)===r)).length+(requireCenter&&!set.some(central)?1:0);
      return {score:maxDistance/diag+.5*meanDistance/diag+.05*geometry+.1*elevation+missing,
        maxDistance,meanDistance,regionCount:regions.filter(r=>set.some(i=>region(i)===r)).length,hasCenter:set.some(central)};
    }
    const sorted=eligible.slice().sort((a,b)=>values[a]-values[b] || a-b);
    const greedy=[];for (const i of sorted) if (greedy.length<count && separated(i,greedy)) greedy.push(i);
    const seeds=[];
    if(validSet(greedy)) seeds.push(greedy);
    const anchors=[[.5,.5],[.1,.1],[.9,.9],[.1,.9],[.9,.1],[.5,.1]];
    for (const anchor of anchors) {
      const target=[minX+anchor[0]*W,minY+anchor[1]*H];
      const first=eligible.reduce((a,b)=>distance2(candidates[a],target)<distance2(candidates[b],target)?a:b);
      const set=[first];
      while(set.length<count) {
        let best=-1,bestGain=-Infinity;
        for(const i of eligible) {
          if(set.includes(i)||!separated(i,set))continue;
          let gain=Math.min(...set.map(j=>distance2(candidates[i],candidates[j])))/(diag*diag);
          if(requireRegions && !set.some(j=>region(j)===region(i)))gain+=2;
          if(requireCenter && !set.some(central) && central(i))gain+=2;
          gain-=.01*values[i]/(1+values[i]);
          if(gain>bestGain){best=i;bestGain=gain;}
        }
        if(best<0)break;set.push(best);
      }
      if(validSet(set))seeds.push(set);
    }
    if(!seeds.length)return empty;
    // Pool combines spatial representatives, geometric quality and all seed points.
    const pool=new Set(seeds.flat());
    for(let i=0;i<eligible.length;i+=Math.max(1,Math.ceil(eligible.length/100)))pool.add(eligible[i]);
    sorted.slice(0,24).forEach(i=>pool.add(i));
    let best=null, exchanges=0;
    for(const seed of seeds) {
      let set=seed.slice(),m=metrics(set);
      for(let pass=0;pass<6;pass++) {
        let swap=null, score=m.score;
        for(let k=0;k<set.length;k++)for(const i of pool) {
          if(set.includes(i)||!separated(i,set,k))continue;
          const next=set.slice();next[k]=i;if(!validSet(next))continue;
          const nm=metrics(next);if(nm.score<score-1e-9){score=nm.score;swap={set:next,m:nm};}
        }
        if(!swap)break;set=swap.set;m=swap.m;exchanges++;
      }
      // A bounded two-for-two pass can escape one-swap local traps.
      const pairPool=[...pool].filter(i=>!set.includes(i)).slice(0,12);
      let paired=null;
      for(let a=0;a<set.length;a++)for(let b=a+1;b<set.length;b++)
        for(let u=0;u<pairPool.length;u++)for(let v=u+1;v<pairPool.length;v++) {
          const next=set.slice();next[a]=pairPool[u];next[b]=pairPool[v];
          if(!validSet(next)||!next.every((i,k)=>separated(i,next,k)))continue;
          const nm=metrics(next);if(nm.score<(paired?.m.score??m.score)-1e-9)paired={set:next,m:nm};
        }
      if(paired){set=paired.set;m=paired.m;exchanges++;}
      const exact=metrics(set,demands);
      if(!best||exact.score<best.metrics.score)best={set,metrics:exact};
    }
    // Retain each original seed as well: sampled exchanges cannot worsen the full objective.
    for(const set of seeds){const exact=metrics(set,demands);if(exact.score<best.metrics.score)best={set,metrics:exact};}
    return {...best.metrics,indices:best.set,points:best.set.map(i=>candidates[i]),values:best.set.map(i=>values[i]),
      starts:seeds.length,exchanges,method:'Distributed multi-start exchange',
      greedyScore:validSet(greedy)?metrics(greedy,demands).score:null};
  }
  const api={optimize};if(typeof module!=='undefined')module.exports=api;else root.GcpNetwork=api;
})(typeof window!=='undefined'?window:globalThis);
