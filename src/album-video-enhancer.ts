import { supabase } from './supabase'
import { getIdentity, getMemberId } from './core/identity'
import { enterView } from './core/navigation'
import { openMediaViewer } from './core/media-viewer'
import { mediaUrl, primeMedia, signMedia, forgetMedia } from './core/private-media'
import { prepareVideo, isSupportedVideo, CHAT_VIDEO_MAX_BYTES, mediaLimitMb } from './core/media-pipeline'
import { uploadPrivateMedia } from './core/resumable-storage'
import { createVideoPoster, videoPosterPath } from './core/video-poster'

const BUCKET='family-photos'
type AlbumVideo={id:string;uploader_id:string;storage_path:string;poster_path:string|null;mime_type:string;file_size:number;created_at:string}

let activeAlbumId=''
let videosChannel:ReturnType<typeof supabase.channel>|null=null
let uploadBusy=false
let scanQueued=false

const esc=(value:string)=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char))
const plural=(n:number,singular:string,pluralValue:string)=>`${n} ${n===1?singular:pluralValue}`

function injectStyles(){
  if(document.getElementById('familia-album-video-css'))return
  const style=document.createElement('style')
  style.id='familia-album-video-css'
  style.textContent=`
    .album-video-section{margin-top:28px;padding-top:20px;border-top:1px solid var(--line,#e7e2d8)}
    .album-video-head{display:flex;align-items:end;justify-content:space-between;margin:0 0 11px}.album-video-head h2{margin:0;font:500 24px var(--display-font,Georgia,serif)}.album-video-head span{font:700 10px system-ui;color:var(--muted,#777);letter-spacing:.08em;text-transform:uppercase}
    .album-video-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.album-video-card{position:relative;aspect-ratio:9/12;border:0;border-radius:16px;overflow:hidden;background:#171716;color:#fff;padding:0;cursor:pointer}.album-video-card img{width:100%;height:100%;object-fit:cover;display:block}.album-video-fallback{position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(145deg,#242421,#111);font:700 12px system-ui;color:#ddd}.album-video-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:48px;height:48px;border-radius:50%;display:grid;place-items:center;padding-left:3px;background:rgba(0,0,0,.62);font-size:21px;backdrop-filter:blur(8px);box-shadow:0 5px 20px #0004}.album-video-delete{position:absolute;right:8px;top:8px;z-index:3;width:34px;height:34px;border:0;border-radius:50%;background:rgba(0,0,0,.68);color:#fff;font-size:18px;display:grid;place-items:center;cursor:pointer;backdrop-filter:blur(8px)}
    .album-video-empty{padding:28px 16px;text-align:center;border:1px dashed var(--line,#d8d1c5);border-radius:18px;color:var(--muted,#777);font-size:12px;line-height:1.45}
    .album-video-upload{height:46px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:15px;padding:0 16px;background:#ece8df;color:var(--ink,#171716);font:700 13px system-ui;cursor:pointer}.album-video-upload:active{transform:scale(.98)}
    @media(max-width:430px){.album-video-grid{gap:5px}.album-video-card{border-radius:13px}.album-video-upload{height:44px;padding:0 14px}}
  `
  document.head.appendChild(style)
}

function statusNode(){return document.querySelector<HTMLElement>('#memberAlbumStatus,#albumStatus')}
function setStatus(text:string,error=false){
  const node=statusNode();if(!node)return
  node.textContent=text
  node.classList.toggle('error',error)
}

async function registerVideo(memberId:string,path:string,posterPath:string|null,mimeType:string,fileSize:number){
  const {error}=await supabase.rpc('register_family_album_video',{
    p_member_id:memberId,
    p_storage_path:path,
    p_poster_path:posterPath,
    p_mime_type:mimeType,
    p_file_size:fileSize
  })
  if(error)throw error
}

async function uploadVideos(files:FileList|File[]){
  if(uploadBusy)return
  const selected=Array.from(files)
  if(!selected.length)return
  const identity=getIdentity()
  const memberId=identity?.memberId||getMemberId()
  if(!memberId){setStatus('No se pudo identificar tu perfil.',true);return}
  uploadBusy=true
  let saved=0
  const failed:string[]=[]
  try{
    for(let index=0;index<selected.length;index++){
      const file=selected[index]
      let mainPath=''
      let posterPath=''
      try{
        if(!isSupportedVideo(file))throw new Error('VIDEO_NOT_SUPPORTED')
        if(file.size>CHAT_VIDEO_MAX_BYTES)throw new Error('VIDEO_SOURCE_TOO_LARGE')
        const prepared=prepareVideo(file)
        mainPath=`${memberId}/videos/${crypto.randomUUID()}.${prepared.ext}`
        setStatus(`Preparando video ${index+1} de ${selected.length}…`)
        const poster=await createVideoPoster(file,720,.78,9000)
        if(poster)posterPath=videoPosterPath(mainPath)

        await uploadPrivateMedia(mainPath,prepared.blob,{
          contentType:prepared.type,
          cacheControl:'31536000',
          onProgress:(uploaded,total)=>{
            if(!total)return
            const pct=Math.min(100,Math.max(0,Math.round(uploaded/total*100)))
            setStatus(`Subiendo video ${index+1} de ${selected.length} · ${pct}%`)
          }
        })
        if(poster&&posterPath){
          await uploadPrivateMedia(posterPath,poster,{contentType:'image/jpeg',cacheControl:'31536000'})
        }
        setStatus(`Guardando video ${index+1} de ${selected.length}…`)
        await registerVideo(memberId,mainPath,posterPath||null,prepared.type,prepared.blob.size)
        await Promise.allSettled([signMedia(mainPath),posterPath?signMedia(posterPath):Promise.resolve('')])
        saved++
      }catch(error){
        console.error('Family album video upload failed',error)
        const cleanup=[mainPath,posterPath].filter(Boolean)
        if(cleanup.length){try{await supabase.storage.from(BUCKET).remove(cleanup)}catch{}}
        cleanup.forEach(forgetMedia)
        failed.push(file.name||`video ${index+1}`)
      }
    }
  }finally{
    uploadBusy=false
  }
  if(saved){
    invalidateCurrent()
    await scanNow()
  }
  if(failed.length){
    setStatus(saved?`${saved} video${saved===1?'':'s'} guardado${saved===1?'':'s'}. ${failed.length} no se pudo${failed.length===1?'':'ieron'} subir.`:`No se pudieron subir ${failed.length===1?'el video':'los videos'}. Máximo ${mediaLimitMb(CHAT_VIDEO_MAX_BYTES)} MB por video.`,true)
  }else if(saved){
    setStatus(saved===1?'Video agregado a tu álbum.':`${saved} videos agregados a tu álbum.`)
  }
}

async function loadVideos(memberId?:string){
  let query=supabase.from('family_album_videos').select('id,uploader_id,storage_path,poster_path,mime_type,file_size,created_at').order('created_at',{ascending:false})
  if(memberId)query=query.eq('uploader_id',memberId)
  const {data,error}=await query
  if(error)throw error
  return (data||[]) as AlbumVideo[]
}

async function resolveAlbumId(){
  if(activeAlbumId)return activeAlbumId
  const title=document.querySelector<HTMLElement>('.album-title-row h1')?.textContent?.trim()||''
  const name=title.replace(/^Álbum de\s+/i,'').trim()
  if(!name)return''
  const {data}=await supabase.from('family_members').select('id,name').eq('active',true)
  const match=(data||[]).find((row:any)=>String(row.name)===name)
  activeAlbumId=String(match?.id||'')
  return activeAlbumId
}

function videoCard(video:AlbumVideo,index:number,own:boolean){
  const poster=video.poster_path?mediaUrl(video.poster_path):''
  return `<button type="button" class="album-video-card" data-album-video-index="${index}" data-album-video-id="${esc(video.id)}" aria-label="Abrir video">${poster?`<img src="${esc(poster)}" alt="Vista previa del video" loading="lazy" decoding="async">`:'<span class="album-video-fallback">VIDEO</span>'}<span class="album-video-play" aria-hidden="true">▶</span>${own?`<span class="album-video-delete" data-delete-album-video="${esc(video.id)}" role="button" aria-label="Eliminar video">×</span>`:''}</button>`
}

async function deleteVideo(video:AlbumVideo){
  if(!window.confirm('¿Eliminar este video del álbum familiar?'))return
  setStatus('Eliminando video…')
  try{
    const {data,error}=await supabase.rpc('delete_family_album_videos',{p_video_ids:[video.id]})
    if(error)throw error
    const rows=(data||[]) as Array<{storage_path:string;poster_path:string|null}>
    const paths=rows.flatMap(row=>[row.storage_path,row.poster_path].filter(Boolean) as string[])
    if(paths.length){
      const {error:storageError}=await supabase.storage.from(BUCKET).remove(paths)
      if(storageError)console.warn('Album video storage cleanup deferred',storageError)
      paths.forEach(forgetMedia)
    }
    invalidateCurrent()
    await scanNow()
    setStatus('Video eliminado.')
  }catch(error){
    console.error('Family album video delete failed',error)
    setStatus('No se pudo eliminar el video. Inténtalo de nuevo.',true)
  }
}

async function renderVideoSection(){
  const root=document.querySelector<HTMLElement>('[data-photo-page]')
  const albumTitle=root?.querySelector('.album-title-row')
  if(!root||!albumTitle||root.querySelector('#albumVideoSection'))return
  const memberId=await resolveAlbumId()
  if(!memberId)return
  const videos=await loadVideos(memberId)
  const mediaPaths=videos.flatMap(video=>[video.poster_path].filter(Boolean) as string[])
  if(mediaPaths.length)await primeMedia(mediaPaths)
  const own=memberId===(getIdentity()?.memberId||getMemberId())

  const section=document.createElement('section')
  section.id='albumVideoSection'
  section.className='album-video-section'
  section.innerHTML=`<div class="album-video-head"><h2>Videos</h2><span>${plural(videos.length,'video','videos')}</span></div>${videos.length?`<div class="album-video-grid">${videos.map((video,index)=>videoCard(video,index,own)).join('')}</div>`:'<div class="album-video-empty">Aún no hay videos guardados en este álbum.</div>'}`
  const photoGrid=root.querySelector('.album-photo-grid')
  const emptyState=root.querySelector('.album-empty-state')
  const selectionBar=root.querySelector('.album-selection-bar')
  const anchor=selectionBar||emptyState||photoGrid
  if(anchor)anchor.insertAdjacentElement('afterend',section)
  else root.appendChild(section)

  const count=root.querySelector<HTMLElement>('.album-count')
  if(count){
    const photoCount=root.querySelectorAll('.album-photo').length
    const text=`${plural(photoCount,'foto','fotos')} · ${plural(videos.length,'video','videos')}`
    if(count.textContent!==text)count.textContent=text
  }

  section.querySelectorAll<HTMLElement>('[data-album-video-index]').forEach(card=>card.addEventListener('click',event=>{
    const deleteTarget=(event.target as Element|null)?.closest('[data-delete-album-video]')
    const index=Number(card.dataset.albumVideoIndex||0)
    const selected=videos[index]
    if(!selected)return
    if(deleteTarget){event.preventDefault();event.stopPropagation();void deleteVideo(selected);return}
    event.preventDefault()
    void(async()=>{
      const items=await Promise.all(videos.map(async video=>({
        src:await signMedia(video.storage_path),
        poster:video.poster_path?await signMedia(video.poster_path).catch(()=> ''):'',
        alt:'Video del álbum familiar',
        type:'video' as const
      })))
      if(!items.length)return
      enterView('media')
      openMediaViewer(items,index)
    })().catch(error=>console.error('Album video viewer failed',error))
  }))
}

function injectUploadButton(container:Element,id:string){
  if(container.querySelector(`#${CSS.escape(id)}Button`))return
  const memberId=getIdentity()?.memberId||getMemberId()
  if(!memberId)return
  const label=document.createElement('label')
  label.className='album-video-upload'
  label.id=`${id}Button`
  label.setAttribute('for',id)
  label.textContent='＋ Agregar video'
  const input=document.createElement('input')
  input.className='album-file'
  input.id=id
  input.type='file'
  input.accept='video/mp4,video/webm,video/quicktime,video/x-m4v,video/*'
  input.multiple=true
  input.addEventListener('change',()=>{
    if(input.files?.length)void uploadVideos(input.files)
    input.value=''
  })
  container.append(label,input)
}

async function enhanceAlbum(){
  const root=document.querySelector<HTMLElement>('[data-photo-page]')
  if(!root?.querySelector('.album-title-row'))return
  const memberId=await resolveAlbumId()
  if(!memberId)return
  const own=memberId===(getIdentity()?.memberId||getMemberId())
  const actions=root.querySelector('.album-actions')
  if(own&&actions&&!root.querySelector('#memberAlbumVideoUploadButton'))injectUploadButton(actions,'memberAlbumVideoUpload')
  await renderVideoSection()
}

async function enhanceList(){
  const root=document.querySelector<HTMLElement>('[data-photo-page]')
  const grid=root?.querySelector<HTMLElement>('.album-grid')
  if(!root||!grid||root.querySelector('.album-title-row'))return
  const intro=root.querySelector<HTMLElement>('.albums-intro')
  const introText='Tus fotos y videos privados viven aquí, organizados por cada miembro de la familia.'
  if(intro&&intro.textContent!==introText)intro.textContent=introText
  const actions=root.querySelector('.album-actions')
  if(actions&&!root.querySelector('#familyAlbumVideoUploadButton'))injectUploadButton(actions,'familyAlbumVideoUpload')
  if(grid.dataset.videoCounted==='1')return
  grid.dataset.videoCounted='1'
  try{
    const videos=await loadVideos()
    const counts=new Map<string,number>()
    videos.forEach(video=>counts.set(video.uploader_id,(counts.get(video.uploader_id)||0)+1))
    root.querySelectorAll<HTMLElement>('[data-album-id]').forEach(card=>{
      const member=card.dataset.albumId||''
      const videoCount=counts.get(member)||0
      const badge=card.querySelector<HTMLElement>('.album-badge')
      const info=card.querySelector<HTMLElement>('.album-info span')
      const photoCount=Number(badge?.dataset.photoCount||badge?.textContent||0)||0
      if(badge&&!badge.dataset.photoCount)badge.dataset.photoCount=String(photoCount)
      if(badge){const total=photoCount+videoCount;const value=String(total);if(badge.textContent!==value)badge.textContent=value}
      if(info&&videoCount){
        const value=`${plural(photoCount,'foto','fotos')} · ${plural(videoCount,'video','videos')}`
        if(info.textContent!==value)info.textContent=value
      }
    })
  }catch(error){
    grid.dataset.videoCounted=''
    console.error('Album video counts failed',error)
  }
}

function invalidateCurrent(){
  const section=document.querySelector('#albumVideoSection');section?.remove()
  const grid=document.querySelector<HTMLElement>('.album-grid');if(grid)delete grid.dataset.videoCounted
}

async function scanNow(){
  if(document.querySelector('[data-photo-page] .album-title-row'))await enhanceAlbum()
  else if(document.querySelector('[data-photo-page] .album-grid'))await enhanceList()
}

function queueScan(){
  if(scanQueued)return
  scanQueued=true
  window.requestAnimationFrame(()=>{
    scanQueued=false
    void scanNow()
  })
}

injectStyles()
document.addEventListener('click',event=>{
  const card=(event.target as Element|null)?.closest<HTMLElement>('[data-album-id]')
  if(card?.dataset.albumId)activeAlbumId=card.dataset.albumId
},true)

videosChannel=supabase.channel('familia-noa-album-videos')
  .on('postgres_changes',{event:'*',schema:'public',table:'family_album_videos'},()=>{invalidateCurrent();queueScan()})
  .subscribe()

const observer=new MutationObserver(queueScan)
observer.observe(document.body,{childList:true,subtree:true})
queueScan()
