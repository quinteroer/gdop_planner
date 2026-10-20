/* Consistent 1024-pixel preview metrics; thresholds must be calibrated per camera. */
(function(root){
  'use strict';
  function metrics(data,width,height){
    const gray=new Float64Array(width*height);let dark=0,bright=0;
    for(let i=0;i<gray.length;i++){
      gray[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];
      if(gray[i]<=5)dark++;if(gray[i]>=250)bright++;
    }
    let sum=0,squared=0,n=0;
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=y*width+x,v=4*gray[i]-gray[i-1]-gray[i+1]-gray[i-width]-gray[i+width];
      sum+=v;squared+=v*v;n++;
    }
    return {sharpness:n?Math.max(0,squared/n-(sum/n)**2):0,dark_percent:100*dark/gray.length,bright_percent:100*bright/gray.length};
  }
  async function inspect(file){
    const bitmap=await createImageBitmap(file);
    try {
      const factor=Math.min(1,1024/Math.max(bitmap.width,bitmap.height)),width=Math.max(3,Math.round(bitmap.width*factor)),height=Math.max(3,Math.round(bitmap.height*factor));
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);
      return {filename:file.name,width:bitmap.width,height:bitmap.height,...metrics(ctx.getImageData(0,0,width,height).data,width,height)};
    }finally{bitmap.close();}
  }
  const api={metrics,inspect};if(typeof module!=='undefined')module.exports=api;else root.PhotoQuality=api;
})(typeof window!=='undefined'?window:globalThis);
