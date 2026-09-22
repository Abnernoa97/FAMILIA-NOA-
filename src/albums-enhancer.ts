import { supabase } from './supabase'
import { getIdentity, getMemberId } from './core/identity'
import { openMediaViewer } from './core/media-viewer'
import { enterView, backView, currentView } from './core/navigation'
import { mediaUrl, primeMedia, signMedia, forgetMedia } from './core/private-media'
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
let selectionMode=false
let deletingSelection=false
const selectedPhotoIds=new Set<string>()

const esc=(v:string)=>v.replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]||c))
const photoUrl=(path:string)=>mediaUrl(path)
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

function styles(){
 if(document.getElementById('familia-albums-style'))return
 const s=document.createElement('style');s.id='familia-albums-style';s.textContent=`
 .albums-page{min-height:100dvh;padding:22px 18px 110px;max-width:760px;margin:0 auto}
 .albums-head{display:flex;align-items:center;gap:14px;margin-bottom:24px}.albums-head button{width:44px;height:44px;border:1px solid var(--line,#e7e2d8);background:var(--surface,#fff);border-radius:50%;font-size:26px;line-height:1;color:var(--ink,#171716);cursor:pointer}.albums-head .eyebrow{margin:0}.albums-head h1{margin:3px 0 0;font-family:var(--display-font,Georgia,serif);font-size:31px;font-weight:500}
 .albums-intro{color:var(--muted,#777);font-size:14px;line-height:1.5;margin:-10px 0 22px}.album-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
 .album-card{position:relative;display:block;width:100%;overflow:hidden;min-height:205px;border:1px solid var(--line,#e7e2d8);border-radius:25px;background:var(--surface,#fff);padding:0;text-align:left;cursor:pointer;box-shadow:0 8px 30px rgba(20,18,14,.05);transition:transform .2s}.album-card:active{transform:scale(.985)}
 .album-cover{height:155px;background:linear-gradient(135deg,#e9e3d8,#f8f6f1);overflow:hidden;display:flex;align-items:center;justify-content:center}.album-cover img{width:100%;height:100%;object-fit:cover;display:block}.album-empty{font-family:var(--display-font,Georgia,serif);font-size:32px;opacity:.45}
 .album-info{padding:12px 14px 14px}.album-info b{display:block;font-family:var(--display-font,Georgia,serif);font-size:18px;font-weight:500}.album-info span{display:block;color:var(--muted,#777);font-size:11px;margin-top:3px}.album-badge{position:absolute;right:11px;top:11px;padding:6px 9px;border-radius:999px;background:rgba(20,20,18,.72);color:#fff;font-size:10px;font-weight:700;backdrop-filter:blur(8px)}
 .album-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:0 0 22px}.album-upload-label,.album-secondary{height:46px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:15px;padding:0 16px;font:700 13px system-ui,sans-serif;cursor:pointer;text-align:center}.album-upload-label{background:var(--ink,#171716);color:#fff}.album-secondary{background:#ece8df;color:var(--ink,#171716)}.album-secondary:active,.album-upload-label:active{transform:scale(.98)}.album-file{display:none}.album-status{min-height:20px;font-size:12px;color:var(--muted,#777);margin:0 0 12px}.album-status.error{color:#a44b43}
 .album-title-row{margin-bottom:18px}.album-title-row h1{margin:0;font-size:30px;font-family:var(--display-font,Georgia,serif);font-weight:500}.album-count{color:var(--muted,#777);font-size:12px;margin:4px 0 0}.album-photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.album-photo{position:relative;display:block;width:100%;aspect-ratio:1;border:0;padding:0;border-radius:12px;overflow:hidden;background:#eeeae2;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}.album-photo:active{transform:scale(.985)}.album-photo img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}.album-photo.is-selected{box-shadow:inset 0 0 0 3px var(--ink,#171716)}.album-photo.is-selected img{filter:brightness(.72)}.album-select-mark{position:absolute;right:8px;top:8px;z-index:2;width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.92);border:1px solid rgba(23,23,22,.18);color:#171716;font:800 14px system-ui;box-shadow:0 2px 10px #0002}.album-photo.is-selected .album-select-mark{background:#171716;color:#fff;border-color:#171716}
 .album-selection-bar{position:fixed;z-index:60;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(calc(100% - 24px),700px);min-height:58px;display:flex;align-items:center;gap:12px;padding:8px 9px 8px 16px;border:1px solid rgba(210,205,195,.9);border-radius:29px;background:rgba(255,253,249,.97);box-shadow:0 14px 42px rgba(35,31,25,.18);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.album-selection-bar span{flex:1;font-size:13px;color:#5d5952}.album-selection-bar b{color:#171716}.album-delete{height:42px;padding:0 17px;border:0;border-radius:21px;background:#171716;color:#fff;font:700 13px system-ui;cursor:pointer}.album-delete:disabled{opacity:.38;cursor:default}
 .album-confirm{position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-end;justify-content:center;background:rgba(17,17,16,.48);backdrop-filter:blur(5px)}.album-confirm-card{width:min(100%,760px);padding:25px 22px calc(22px + env(safe-area-inset-bottom));border-radius:28px 28px 0 0;background:#f8f5ee;color:#171716;box-shadow:0 -12px 42px #0002}.album-confirm-card h3{margin:0 0 8px;font:500 29px var(--display-font,Georgia,serif)}.album-confirm-card p{margin:0;color:#6b675f;font-size:14px;line-height:1.5}.album-confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:20px}.album-confirm-actions button{height:48px;border:0;border-radius:15px;background:#e9e5dd;color:#171716;font-weight:700}.album-confirm-actions .danger{background:#171716;color:#fff}
 .album-empty-state{padding:48px 20px;text-align:center;border:1px dashed var(--line,#ddd6ca);border-radius:22px;color:var(--muted,#777)}.album-empty-state b{display:block;font-family:var(--display-font,Georgia,serif);font-size:22px;color:var(--ink,#171716);margin-bottom:7px}
 @media(max-width:430px){.album-grid{gap:10px}.album-card{min-height:185px}.album-cover{height:138px}.album-info{padding:10px 11px 12px}.album-info b{font-size:16px}.albums-page{padding-left:14px;padding-right:14px}.album-photo-grid{gap:4px}.album-actions{gap:7px}.album-upload-label,.album-secondary{height:44px;padding:0 14px}}
 `;document.head.appendChild(s)
}

function resetSelection(){
 selectionMode=false
 deletingSelection=false
 selectedPhotoIds.clear()
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

function setVisibleStatus(message:string,error=false){
 const status=document.querySelector<HTMLElement>('#memberAlbumStatus,#albumStatus')
 if(!status)return
 status.textContent=message
 status.classList.toggle('error',error)
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
 const finalMessage=failed.length
  ?(completed?`${completed} foto${completed===1?'':'s'} guardada${completed===1?'':'s'}. ${failed.length} no se pudo${failed.length===1?'':'ieron'} subir.`:`No se pudieron subir ${failed.length===1?'la foto':'las fotos'}.`)
  :(completed===1?'Foto agregada a tu álbum.':`${completed} fotos agregadas a tu álbum.`)
 if(completed)await renderCurrent()
 setVisibleStatus(finalMessage,failed.length>0)
}

function card(member:any,photos:any[]){
 const mine=photos.filter(p=>p.uploader_id===member.id),cover=mine[0]
 return `<button type="button" class="album-card" data-album-id="${esc(member.id)}"><div class="album-cover">${cover?`<img src="${esc(photoUrl(cover.storage_path))}" alt="Álbum de ${esc(member.name)}" loading="lazy" decoding="async">`:'<span class="album-empty">♡</span>'}</div><span class="album-badge">${mine.length}</span><div class="album-info"><b>Álbum de ${esc(member.name)}</b><span>${mine.length?`${mine.length} foto${mine.length===1?'':'s'}`:'Sin fotos todavía'}</span></div></button>`
}

function updateSelectionUi(root:HTMLElement){
 const count=selectedPhotoIds.size
 const countEl=root.querySelector<HTMLElement>('[data-selection-count]')
 if(countEl)countEl.innerHTML=`<b>${count}</b> seleccionada${count===1?'':'s'}`
 const deleteButton=root.querySelector<HTMLButtonElement>('#deleteSelected')
 if(deleteButton)deleteButton.disabled=count===0||deletingSelection
 root.querySelectorAll<HTMLElement>('[data-photo-id]').forEach(el=>{
  const selected=selectedPhotoIds.has(el.dataset.photoId||'')
  el.classList.toggle('is-selected',selected)
  el.setAttribute('aria-pressed',String(selected))
  const mark=el.querySelector<HTMLElement>('.album-select-mark')
  if(mark)mark.textContent=selected?'✓':''
 })
}

function confirmDelete(count:number){
 return new Promise<boolean>(resolve=>{
  const overlay=document.createElement('div')
  overlay.className='album-confirm'
  overlay.innerHTML=`<div class="album-confirm-card" role="dialog" aria-modal="true" aria-labelledby="albumDeleteTitle"><h3 id="albumDeleteTitle">Eliminar ${count===1?'foto':`${count} fotos`}</h3><p>${count===1?'Esta foto se eliminará':'Estas fotos se eliminarán'} de tu álbum y del almacenamiento familiar. Esta acción no se puede deshacer.</p><div class="album-confirm-actions"><button type="button" data-cancel>Cancelar</button><button type="button" class="danger" data-confirm>Eliminar</button></div></div>`
  document.body.appendChild(overlay)
  let settled=false
  const finish=(value:boolean)=>{if(settled)return;settled=true;overlay.remove();resolve(value)}
  overlay.querySelector('[data-cancel]')?.addEventListener('click',()=>finish(false))
  overlay.querySelector('[data-confirm]')?.addEventListener('click',()=>finish(true))
  overlay.addEventListener('click',event=>{if(event.target===overlay)finish(false)})
 })
}

async function deletePhotoRows(ids:string[],uploaderId:string){
 let lastError:any=null
 for(let attempt=0;attempt<3;attempt++){
  const {error}=await supabase.from('photos').delete().in('id',ids).eq('uploader_id',uploaderId)
  if(!error)return
  lastError=error
  await wait(350*(attempt+1))
 }
 throw lastError||new Error('No se pudo limpiar el registro de las fotos.')
}

async function deleteSelectedPhotos(memberId:string,mine:any[],root:HTMLElement){
 if(deletingSelection||!selectedPhotoIds.size)return
 const chosen=mine.filter(photo=>selectedPhotoIds.has(photo.id))
 if(!chosen.length)return
 if(!(await confirmDelete(chosen.length)))return
 deletingSelection=true
 updateSelectionUi(root)
 setVisibleStatus(`Eliminando ${chosen.length===1?'foto':`${chosen.length} fotos`}…`)
 const removed:any[]=[]
 const failed:any[]=[]
 for(const photo of chosen){
  try{
   const {error}=await supabase.storage.from(BUCKET).remove([photo.storage_path])
   if(error)throw error
   forgetMedia(photo.storage_path)
   removed.push(photo)
  }catch(error){
   console.error('Family photo object delete failed',error)
   failed.push(photo)
  }
 }
 if(removed.length){
  try{
   await deletePhotoRows(removed.map(photo=>photo.id),memberId)
  }catch(error){
   console.error('Family photo row delete failed after storage delete',error)
   failed.push(...removed)
  }
 }
 selectedPhotoIds.clear()
 failed.forEach(photo=>selectedPhotoIds.add(photo.id))
 deletingSelection=false
 if(!failed.length)selectionMode=false
 await renderAlbum(memberId)
 if(failed.length)setVisibleStatus(`${failed.length} foto${failed.length===1?'':'s'} no se pudo${failed.length===1?'':'ieron'} eliminar. Inténtalo de nuevo.`,true)
 else setVisibleStatus(removed.length===1?'Foto eliminada.':`${removed.length} fotos eliminadas.`)
}

async function renderList(){
 const root=document.querySelector<HTMLElement>('[data-photo-page]');if(!root)return
 activeAlbumId=null
 resetSelection()
 const membersResult=await loadMembers();const members=membersResult.members
 const photosResult=await loadAlbumSummary();const photos=photosResult.photos
 await primeMedia(photos.map(p=>p.storage_path))
 const available=photos.filter(p=>!!photoUrl(p.storage_path))
 if(membersResult.error||photosResult.error){root.className='albums-page';root.innerHTML='<div class="album-empty-state"><b>No se pudieron cargar los álbumes</b><span>Inténtalo de nuevo.</span></div>';return}
 root.className='albums-page'
 root.innerHTML=`<header class="albums-head"><button type="button" id="albumsBack" aria-label="Volver">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Álbumes</h1></div></header><p class="albums-intro">Cada foto que compartes en la app se guarda automáticamente en tu álbum personal.</p><div class="album-actions"><label class="album-upload-label" for="familyAlbumUpload">＋ Subir fotos</label><input class="album-file" id="familyAlbumUpload" type="file" accept="image/*" multiple></div><div class="album-status" id="albumStatus"></div><section class="album-grid">${members.map(m=>card(m,available)).join('')}</section>`
 root.querySelector('#albumsBack')?.addEventListener('click',()=>backView())
 root.querySelector('#familyAlbumUpload')?.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.files)void upload(input.files,root.querySelector('#albumStatus')!);input.value=''})
 root.querySelectorAll<HTMLElement>('[data-album-id]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const id=el.dataset.albumId;if(id){resetSelection();activeAlbumId=id;enterView('album');void renderAlbum(id)}}))
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
 const ownAlbum=member.id===meId
 if(!ownAlbum)resetSelection()
 for(const selectedId of [...selectedPhotoIds])if(!mine.some(photo=>photo.id===selectedId))selectedPhotoIds.delete(selectedId)
 const selectedCount=selectedPhotoIds.size
 root.className='albums-page'
 root.innerHTML=`<header class="albums-head"><button type="button" id="albumBack" aria-label="Volver a álbumes">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Fotos</h1></div></header><div class="album-title-row"><h1>Álbum de ${esc(member.name)}</h1><p class="album-count">${mine.length} foto${mine.length===1?'':'s'}</p></div>${ownAlbum?`<div class="album-actions">${selectionMode?`<button type="button" class="album-secondary" id="cancelSelection">Cancelar selección</button>`:`<label class="album-upload-label" for="memberAlbumUpload">＋ Agregar fotos</label><input class="album-file" id="memberAlbumUpload" type="file" accept="image/*" multiple><button type="button" class="album-secondary" id="selectPhotos" ${mine.length?'':'disabled'}>Seleccionar</button>`}</div><div class="album-status" id="memberAlbumStatus"></div>`:''}<section class="album-photo-grid">${mine.map((p,i)=>`<button type="button" class="album-photo${selectionMode&&selectedPhotoIds.has(p.id)?' is-selected':''}" data-photo-index="${i}" data-photo-id="${esc(p.id)}" aria-label="${selectionMode?'Seleccionar foto':`Abrir foto de ${esc(member.name)}`}" ${selectionMode?`aria-pressed="${selectedPhotoIds.has(p.id)}"`:''}><img src="${esc(photoUrl(p.storage_path))}" alt="Foto de ${esc(member.name)}" loading="lazy" decoding="async">${selectionMode?`<span class="album-select-mark" aria-hidden="true">${selectedPhotoIds.has(p.id)?'✓':''}</span>`:''}</button>`).join('')}</section>${mine.length?'':'<div class="album-empty-state"><b>Aún no hay fotos</b><span>Cuando esta persona comparta una foto en la app, aparecerá aquí automáticamente.</span></div>'}${ownAlbum&&selectionMode?`<div class="album-selection-bar"><span data-selection-count><b>${selectedCount}</b> seleccionada${selectedCount===1?'':'s'}</span><button type="button" class="album-delete" id="deleteSelected" ${selectedCount?'':'disabled'}>Eliminar</button></div>`:''}`
 root.querySelector('#albumBack')?.addEventListener('click',()=>{resetSelection();backView()})
 root.querySelector('#memberAlbumUpload')?.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.files)void upload(input.files,root.querySelector('#memberAlbumStatus')!);input.value=''})
 root.querySelector('#selectPhotos')?.addEventListener('click',()=>{selectionMode=true;selectedPhotoIds.clear();void renderAlbum(id)})
 root.querySelector('#cancelSelection')?.addEventListener('click',()=>{resetSelection();void renderAlbum(id)})
 root.querySelector('#deleteSelected')?.addEventListener('click',()=>void deleteSelectedPhotos(id,mine,root))
 root.querySelectorAll<HTMLElement>('[data-photo-index]').forEach(el=>el.addEventListener('click',()=>{
  const photoId=el.dataset.photoId||''
  if(selectionMode&&ownAlbum){
   if(selectedPhotoIds.has(photoId))selectedPhotoIds.delete(photoId)
   else selectedPhotoIds.add(photoId)
   updateSelectionUi(root)
   return
  }
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