/* Relative log scale for the current route's eligible-GCP GDOP values. */
(function(root){
  'use strict';
  function range(values){
    const finite=(values||[]).filter(v=>Number.isFinite(v)&&v>0);
    return finite.length?{min:Math.min(...finite),max:Math.max(...finite)}:null;
  }
  function color(value,scale){
    if(!scale||!Number.isFinite(value)||value<=0)return 'rgba(155,163,171,.32)';
    const t=scale.max>scale.min?Math.log(value/scale.min)/Math.log(scale.max/scale.min):0;
    return `hsla(${140*(1-Math.max(0,Math.min(1,t)))},85%,48%,.55)`;
  }
  const api={range,color};
  if(typeof module!=='undefined')module.exports=api;else root.GdopHeatmap=api;
})(globalThis);
