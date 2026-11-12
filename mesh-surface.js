/* Depth-tested rendering of the original I3S mesh's positions and textures. */
(function(root){
  'use strict';
  class MeshSurface{
    constructor(overlay,onChange){
      this.canvas=document.createElement('canvas');this.canvas.id='meshCanvas';
      this.canvas.className='mesh-surface';this.canvas.hidden=true;
      overlay.before(this.canvas);this.onChange=onChange;this.cache=new Map();
      this.gl=this.canvas.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:true});
      if(!this.gl)return;
      const gl=this.gl;
      const shader=(type,source)=>{
        const value=gl.createShader(type);gl.shaderSource(value,source);gl.compileShader(value);
        if(!gl.getShaderParameter(value,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(value));
        return value;
      };
      const vertex=shader(gl.VERTEX_SHADER,`
        attribute vec3 position;attribute vec2 uv;
        uniform vec3 center,right,up,toward;
        uniform vec2 scale,pan,depthRange;uniform float distance;
        varying vec2 texcoord;
        void main(){
          vec3 point=position-center;
          float depth=distance-dot(point,toward);
          gl_Position=vec4(dot(point,right)*scale.x+pan.x*depth,
            dot(point,up)*scale.y+pan.y*depth,
            depthRange.x*depth-depthRange.y,depth);
          texcoord=uv;
        }`);
      const fragment=shader(gl.FRAGMENT_SHADER,`
        precision mediump float;varying vec2 texcoord;uniform sampler2D image;
        void main(){gl_FragColor=texture2D(image,texcoord);}`);
      this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
      this.position=gl.getAttribLocation(this.program,'position');this.uv=gl.getAttribLocation(this.program,'uv');
      this.uniforms=Object.fromEntries(['center','right','up','toward','scale','pan','depthRange','distance','image'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
      gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
      this.canvas.addEventListener('webglcontextlost',event=>{
        event.preventDefault();this.gl=null;this.canvas.hidden=true;this.onChange();
      });
    }
    state(url){
      if(!this.gl)return {error:'The original mesh needs WebGL. Ground elevation view shown.'};
      if(!this.cache.has(url)){
        const record={loading:true,parts:[]};this.cache.set(url,record);
        this.load(url,record).then(()=>{record.loading=false;this.onChange();})
          .catch(error=>{record.error=error.message;record.loading=false;this.onChange();});
      }
      return this.cache.get(url);
    }
    async load(url,record){
      const response=await fetch(url);
      if(!response.ok)throw Error(`Scene mesh unavailable (${response.status}). Ground view shown.`);
      const manifest=await response.json();
      if(manifest.version!==1||manifest.crs!=='EPSG:32618')throw Error('Unsupported scene mesh coordinates.');
      record.manifest=manifest;
      const base=new URL(url,location.href),gl=this.gl;
      await Promise.all(manifest.parts.map(async part=>{
        const response=await fetch(new URL(part.geometry,base));
        if(!response.ok)throw Error('Could not load a scene mesh tile.');
        const vertices=await response.arrayBuffer();
        if(vertices.byteLength!==part.vertices*20)throw Error('Scene mesh vertex buffer has an unexpected size.');
        const image=new Image();image.src=new URL(part.texture,base).href;await image.decode();
        const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
        const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
        // Preserve the I3S UV convention; changing V mirrors the supplied atlas.
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        record.parts.push({buffer,texture,count:part.vertices});
      }));
    }
    render(record,camera){
      const gl=this.gl,{w,h,dpr,center,yaw,pitch,distance,focal,pan}=camera;
      this.canvas.hidden=false;this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);
      gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(21/255,41/255,56/255,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);
      const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
      const u=this.uniforms,near=Math.max(.01,distance*.001),far=distance*4;
      gl.uniform3fv(u.center,center);gl.uniform3fv(u.right,[-sy,cy,0]);
      gl.uniform3fv(u.up,[-cy*sp,-sy*sp,cp]);gl.uniform3fv(u.toward,[cy*cp,sy*cp,sp]);
      gl.uniform2fv(u.scale,[2*focal/w,2*focal/h]);gl.uniform2fv(u.pan,[2*pan[0]/w,-2*pan[1]/h]);
      gl.uniform2fv(u.depthRange,[(far+near)/(far-near),2*far*near/(far-near)]);gl.uniform1f(u.distance,distance);gl.uniform1i(u.image,0);
      gl.activeTexture(gl.TEXTURE0);gl.enableVertexAttribArray(this.position);gl.enableVertexAttribArray(this.uv);
      for(const part of record.parts){
        gl.bindBuffer(gl.ARRAY_BUFFER,part.buffer);gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,20,0);gl.vertexAttribPointer(this.uv,2,gl.FLOAT,false,20,12);
        gl.bindTexture(gl.TEXTURE_2D,part.texture);gl.drawArrays(gl.TRIANGLES,0,part.count);
      }
    }
  }
  root.MeshSurface=MeshSurface;
})(globalThis);
