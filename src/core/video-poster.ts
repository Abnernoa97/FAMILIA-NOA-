export const VIDEO_POSTER_SUFFIX='.poster.jpg'

export function videoPosterPath(path:string){
  return path?`${path}${VIDEO_POSTER_SUFFIX}`:''
}

export function isVideoStoragePath(path:string){
  return /\.(mp4|webm|mov|m4v)$/i.test(path||'')
}

export function createVideoPoster(file:File,maxEdge=640,quality=.76,timeoutMs=8000):Promise<Blob|null>{
  if(typeof document==='undefined'||typeof URL==='undefined')return Promise.resolve(null)

  return new Promise(resolve=>{
    const src=URL.createObjectURL(file)
    const video=document.createElement('video')
    let done=false
    let timer:number|undefined
    let frameRequest:number|undefined
    let seekStarted=false

    const cleanup=()=>{
      if(timer!==undefined)window.clearTimeout(timer)
      const enhanced=video as HTMLVideoElement&{cancelVideoFrameCallback?:(id:number)=>void}
      if(frameRequest!==undefined&&enhanced.cancelVideoFrameCallback){
        try{enhanced.cancelVideoFrameCallback(frameRequest)}catch{}
      }
      try{video.pause()}catch{}
      video.onloadedmetadata=null
      video.onloadeddata=null
      video.onseeked=null
      video.onerror=null
      video.removeAttribute('src')
      try{video.load()}catch{}
      URL.revokeObjectURL(src)
    }

    const finish=(blob:Blob|null)=>{
      if(done)return
      done=true
      cleanup()
      resolve(blob?.size?blob:null)
    }

    const draw=()=>{
      if(done||video.readyState<2)return
      const width=Number(video.videoWidth)||0
      const height=Number(video.videoHeight)||0
      if(!width||!height)return
      const scale=Math.min(1,maxEdge/Math.max(width,height))
      const canvas=document.createElement('canvas')
      canvas.width=Math.max(1,Math.round(width*scale))
      canvas.height=Math.max(1,Math.round(height*scale))
      const ctx=canvas.getContext('2d',{alpha:false})
      if(!ctx){finish(null);return}
      try{ctx.drawImage(video,0,0,canvas.width,canvas.height)}catch{finish(null);return}
      try{canvas.toBlob(blob=>finish(blob),'image/jpeg',quality)}catch{finish(null)}
    }

    const requestFrame=()=>{
      if(done)return
      const enhanced=video as HTMLVideoElement&{requestVideoFrameCallback?:(callback:()=>void)=>number}
      if(enhanced.requestVideoFrameCallback){
        try{frameRequest=enhanced.requestVideoFrameCallback(draw);return}catch{}
      }
      window.setTimeout(()=>window.requestAnimationFrame(draw),30)
    }

    const seek=()=>{
      if(done)return
      const duration=Number(video.duration)||0
      if(!seekStarted&&Number.isFinite(duration)&&duration>.12){
        seekStarted=true
        const target=Math.min(Math.max(.2,duration*.06),Math.max(.01,duration-.03))
        try{video.currentTime=target;return}catch{}
      }
      requestFrame()
    }

    timer=window.setTimeout(()=>finish(null),timeoutMs)
    video.muted=true
    video.defaultMuted=true
    video.playsInline=true
    video.preload='auto'
    video.onloadedmetadata=()=>{
      try{
        const play=video.play()
        void play.then(()=>window.setTimeout(()=>{
          try{video.pause()}catch{}
          seek()
        },50)).catch(seek)
      }catch{seek()}
    }
    video.onloadeddata=seek
    video.onseeked=requestFrame
    video.onerror=()=>finish(null)
    video.src=src
    try{video.load()}catch{finish(null)}
  })
}
