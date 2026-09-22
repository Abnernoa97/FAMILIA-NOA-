import { supabase } from './supabase'
import { getIdentity, getMemberId } from './core/identity'
import { openMediaViewer } from './core/media-viewer'
import { enterView, backView, currentView } from './core/navigation'
import { mediaUrl, primeMedia, signMedia } from './core/private-media'
import { optimizePhoto, CHAT_IMAGE_MAX_BYTES, mediaLimitMb } from './core/media-pipeline'
import { uploadPrivateMedia } from './core/resumable-storage'

const BUCKET='family-photos'
const MAX_BYTES=CHAT_IMAGE_MAX_BYTES
const MAX_DIMENSION=1600
const PHOTO_QUALITY=.76
let activeAlbumId:string|null=null
let rendering=false
let rerenderQueued=false
let viewerPhotos:any[]=[]
let membersCache:any[]=[]
let membersLoaded=false
let photosChannel: ReturnType<typeof supabase.channel> | null = null

const esc=(v:string)=>v.replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot',"'":'&#039;'}[c]||c))
const photoUrl=(path:string)=>mediaUrl(path)

function styles(){
 if(document.getElementById('familia-albums-style'))return
 const s=document.createElement('style');s.id='familia-albums-style';s.textContent=`
 .albums-page{min-height:100dvh;padding:22px 18px 110px;max-width:760px;margin:0 auto}
 .albums-head{display:flex;align-items:center;gap:14px;margin-bottom:24px}.albums-head button{width:44px;height:44px;border:1px solid var(--line,#e7e2d8);background:var(--surface,#fff);border-radius:50%;font-size:26px;line-height:1;color:var(--ink,#171716);cursor:pointer}.albums-head .eyebrow{margin:0}.albums-head h1{margin:3px 0 0;font-family:var(--display-font,Georgia,serif);font-size:31px;font-weight:500}
 .albums-intro{color:var(--muted,#777);font-size:14px;line-height:1.5;margin:-10px 0 22px}.album-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
 .album-card{position:relative;display:block;width:100%;overflow:hidden;min-height:205px;border:1px solid var(--line,#e7e2d8);border-radius:25px;background:var(--surface,#fff);padding:0;text-align:left;cursor:pointer;box-shadow:0 8px 30px rgba(20,18,14,.05);transition:transform .2s}.album-card:active{transform:scale(.985)}
 .album-cover{height:155px;background:linear-gradient(135deg,#e9e3d8,#f8f6f1);overflow:hidden;display:flex;align-items:center;justify-content:center}.album-cover img{width:100%;height:100%;object-fit:cover;display:block}.album-empty{font-family:var(--display-font,Georgia,serif);font-size:32px;opacity:.45}
 .album-info{padding:12px 14px 14px}.album-info b{display:block;font-family:var(--display-font,Georgia,serif);font-size:18px;font-weight:500}.album-info span{display:block;color:var(--muted,#777);font-size:11px;margin-top:3px}.album-badge{position:absolute;right:11px;top:11px;padding:6px 9px;border-radius:999px;background:rgba(20,20,18,.72);color:#fff;font-size:10px;font-weight:700;backdrop-filter:blur(8px)}
 .album-actions{display:flex;gap:10px;margin:0 0 22px}.album-upload-label{display:inline-block;border:0;border-radius:15px;padding:13px 16px;background:var(--ink,#171716);color:#fff;font-weight:700;cursor:pointer;text-align:center}.album-file{display:none}.album-status{min-height:20px;font-size:12px;color:var(--muted,#777);margin:0 0 12px}.album-status.error{color:#a44b43}
 .album-title-row{margin-bottom:18px}.album-title-row h1{margin:0;font-size:30px;font-family:var(--display-font,Georgia,serif);font-weight:500}.album-count{color:var(--muted,#777);font-size:12px;margin:4px 0 0}.album-photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.album-photo{aspect-ratio:1;border-radius:12px;overflow:hidden;background:#eeeae2;cursor:pointer}.album-photo img{width:100%;height:100%;object-fit:cover;display:block}
 .album-empty-state{padding:48px 20px;text-align:center;border:1px dashed var(--line,#ddd6ca);border-radius:22px;color:var(--muted,#777)}.album-empty-state b{display:block;font-family:var(--display-font,Georgia,serif);font-size:22px;color:var(--ink,#171716);margin-bottom:7px}
 @media(max-width:430px){.album-grid{gap:10px}.album-card{min-height:185px}.album-cover{height:138px}.album-info{padding:10px 11px 12px}.album-info b{font-size:16px}.albums-page{padding-left:14px;padding-right:14px}.album-photo-grid{gap:4px}}
 `;document.head.appendChild(s)
}

async function loadMembers(force=false){
 if(membersLoaded&&!force)return {members:membersCache,error:null}
 const {data,error}=await supabase.from('family_members').select('id,name,active').eq('active',true).order('created_at')
 membersCache=(data||[]) as any[]
 membersLoaded=true
 return {members:membersCache,error}
}

async function loadAlbumPhotos(uploaderId:string){
 const {data,error}=await supabase.from('photos').select('id,uploader_id,storage_path,created_at,mime_type,file_size,width,height').eq('uploader_id',uploaderId).order('created_at',{ascending:false})
 return {photos:(data||[]) as any[],error}
}

async function loadAlbumSummary(){
 const {data,error}=await supabase.from('photos').select('id,uploader_id,storage_path,created_at').order('created_at',{ascending:false})
 return {photos:(data||[]) as any[],error}
}

async function registerPhoto(memberId:string,path:string,mimeType:string,fileSize:number,width:number,height:number){
 const {error}=await supabase.rpc('register_family_photo',{
  p_member_id:memberId,
  p_storage_path:path,
  p_mime_type:mimeType,
  p_file_size:fileSize,
  p_width:width,
  p_height:height,
  p_created_at:new Date().toISOString()
 })
 if(error)throw error
}

async function upload(files:FileList|File[],status:HTMLElement){
 const selected=Array.from(files);if(!selected.length)return
 const identity=getIdentity();const meId=identity?.memberId||getMemberId();if(!meId){status.textContent='No se pudo identificar tu perfil.';status.classList.add('error');return}
 const {data:me,error:memberError}=await supabase.from('family_members').select('id,name,active').eq('id',meId).eq('active',true).maybeSingle();if(memberError||!me){status.textContent='Tu perfil ya no está disponible.';status.classList.add('error');return}
 status.classList.remove('error')
 let completed=0
 const failed:string[]=[]
 for(let i=0;i<selected.length;i++){
  const file=selected[i]
  let uploadedPath=''
  try{
   if(!file.type.startsWith('image/'))throw new Error('Solo se pueden subir fotos.')
   if(file.size>MAX_BYTES)throw new Error(`${file.name||'La foto'} supera ${mediaLimitMb(MAX_BYTES)} MB.`)
   status.textContent=`Preparando foto ${i+1} de ${selected.length}…`
   const prepared=await optimizePhoto(file,MAX_DIMENSION,PHOTO_QUALITY)
   const path=`${meId}/${crypto.randomUUID()}.${prepared.ext}`;uploadedPath=path
   await uploadPrivateMedia(path,prepared.blob,{
    contentType:prepared.type,
    cacheControl:'31536000',
    onProgress:(uploaded,total)=>{
     if(!total)return
     const pct=Math.min(100,Math.max(0,Math.round(uploaded/total*100)))
     status.textContent=`Subiendo foto ${i+1} de ${selected.length} · ${pct}%`
    }
   })
   status.textContent=`Guardando foto ${i+1} de ${selected.length}…`
   await registerPhoto(meId,path,prepared.type,prepared.blob.size,prepared.width,prepared.height)
   await signMedia(path)
   completed++
  }catch(e:any){
   console.error('Family album upload failed',e)
   if(uploadedPath){try{await supabase.storage.from(BUCKET).remove([uploadedPath])}catch{}}
   failed.push(file.name||`foto ${i+1}`)
  }
 }
 if(completed)await renderCurrent()
 if(failed.length){
  status.classList.add('error')
  status.textContent=completed?`${completed} foto${completed===1?'':'s'} guardada${completed===1?'':'s'}. ${failed.length} no se pudo${failed.length===1?'':'ieron'} subir.`:`No se pudieron subir ${failed.length===1?'la foto':'las fotos'}.`
 }else{
  status.classList.remove('error')
  status.textContent=completed===1?'Foto agregada a tu álbum.':`${completed} fotos agregadas a tu álbum.`
 }
}

function card(member:any,photos:any[]){
 const mine=photos.filter(p=>p.uploader_id===member.id),cover=mine[0]
 return `<button type="button" class="album-card" data-album-id="${esc(member.id)}"><div class="album-cover">${cover?`<img src="${esc(photoUrl(cover.storage_path))}" alt="Álbum de ${esc(member.name)}" loading="lazy" decoding="async">`:'<span class="album-empty">♡</span>'}</div><span class="album-badge">${mine.length}</span><div class="album-info"><b>Álbum de ${esc(member.name)}</b><span>${mine.length?`${mine.length} foto${mine.length===1?'':'s'}`:'Sin fotos todavía'}</span></div></button>`
}

async function renderList(){
 const root=document.querySelector<HTMLElement>('[data-photo-page]');if(!root)return
 const membersResult=await loadMembers();const members=membersResult.members
 const photosResult=await loadAlbumSummary();const photos=photosResult.photos
 await primeMedia(photos.map(p=>p.storage_path))
 const available=photos.filter(p=>!!photoUrl(p.storage_path))
 if(membersResult.error||photosResult.error){root.className='albums-page';root.innerHTML='<div class="album-empty-state"><b>No se pudieron cargar los álbumes</b><span>Inténtalo de nuevo.</span></div>';return}
 root.className='albums-page'
 root.innerHTML=`<header class="albums-head"><button type="button" id="albumsBack" aria-label="Volver">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Álbumes</h1></div></header><p class="albums-intro">Cada foto que compartes en la app se guarda automáticamente en tu álbum personal.</p><div class="album-actions"><label class="album-upload-label" for="familyAlbumUpload">＋ Subir fotos</label><input class="album-file" id="familyAlbumUpload" type="file" accept="image/*" multiple></div><div class="album-status" id="albumStatus"></div><section class="album-grid">${members.map(m=>card(m,available)).join('')}</section>`
 root.querySelector('#albumsBack')?.addEventListener('click',()=>backView())
 root.querySelector('#familyAlbumUpload')?.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.files)void upload(input.files,root.querySelector('#albumStatus')!);input.value=''})
 root.querySelectorAll<HTMLElement>('[data-album-id]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const id=el.dataset.albumId;if(id){activeAlbumId=id;enterView('album');void renderAlbum(id)}}))
}

async function renderAlbum(id:string){
 const root=document.querySelector<HTMLElement>('[data-photo-page]');if(!root)return
 const [membersResult,photosResult]=await Promise.all([loadMembers(),loadAlbumPhotos(id)])
 if(membersResult.error||photosResult.error){root.innerHTML='<div class="album-empty-state"><b>No se pudieron cargar las fotos</b><span>Inténtalo de nuevo.</span></div>';return}
 const member=membersResult.members.find(m=>m.id===id);if(!member)return
 await primeMedia(photosResult.photos.map(p=>p.storage_path))
 activeAlbumId=id
 const mine=photosResult.photos.filter(p=>!!photoUrl(p.storage_path));viewerPhotos=mine
 const meId=getMemberId()
 root.className='albums-page'
 root.innerHTML=`<header class="albums-head"><button type="button" id="albumBack" aria-label="Volver a álbumes">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Fotos</h1></div></header><div class="album-title-row"><h1>Álbum de ${esc(member.name)}</h1><p class="album-count">${mine.length} foto${mine.length===1?'':'s'}</p></div>${member.id===meId?`<div class="album-actions"><label class="album-upload-label" for="memberAlbumUpload">＋ Agregar fotos</label><input class="album-file" id="memberAlbumUpload" type="file" accept="image/*" multiple></div><div class="album-status" id="memberAlbumStatus"></div>`:''}<section class="album-photo-grid">${mine.map((p,i)=>`<div class="album-photo" data-photo-index="${i}"><img src="${esc(photoUrl(p.storage_path))}" alt="Foto de ${esc(member.name)}" loading="lazy" decoding="async"></div>`).join('')}</section>${mine.length?'':'<div class="album-empty-state"><b>Aún no hay fotos</b><span>Cuando esta persona comparta una foto en la app, aparecerá aquí automáticamente.</span></div>'}`
 root.querySelector('#albumBack')?.addEventListener('click',()=>backView())
 root.querySelector('#memberAlbumUpload')?.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.files)void upload(input.files,root.querySelector('#memberAlbumStatus')!);input.value=''})
 root.querySelectorAll<HTMLElement>('[data-photo-index]').forEach(el=>el.addEventListener('click',()=>{
  const requested=viewerPhotos[Number(el.dataset.photoIndex)]
  if(!requested)return
  void(async()=>{
   await primeMedia(viewerPhotos.map(p=>p.storage_path))
   const available=viewerPhotos.map(p=>({photo:p,src:photoUrl(p.storage_path)})).filter(item=>!!item.src)
   const start=Math.max(0,available.findIndex(item=>item.photo.storage_path===requested.storage_path))
   if(!available.length)return
   enterView('media')
   openMediaViewer(available.map(item=>({src:item.src,alt:`Foto de ${member.name}`})),start)
  })()
 }))
}

async function renderCurrent(){
 const root=document.querySelector<HTMLElement>('[data-photo-page]');if(!root)return
 if(rendering){rerenderQueued=true;return}
 rendering=true
 try{
  if(currentView()==='album'&&activeAlbumId)await renderAlbum(activeAlbumId)
  else await renderList()
 }finally{
  rendering=false
  if(rerenderQueued){rerenderQueued=false;void renderCurrent()}
 }
}

function startPhotosRealtime(){
 if(photosChannel)return
 photosChannel=supabase.channel('familia-noa-photo-library')
  .on('postgres_changes',{event:'*',schema:'public',table:'photos'},()=>{if(document.querySelector('[data-photo-page]'))void renderCurrent()})
  .subscribe()
}

styles();startPhotosRealtime()
const observer=new MutationObserver(()=>{const root=document.querySelector<HTMLElement>('[data-photo-page]');if(root&&!root.classList.contains('albums-page'))void renderCurrent()})
observer.observe(document.body,{subtree:true,childList:true})
