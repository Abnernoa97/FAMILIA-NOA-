import { supabase } from './supabase'
import { mediaUrl, primeMedia, signMedia, forgetMedia } from './core/private-media'
import { clearIdentity, getIdentity } from './core/identity'
import { optimizeAvatar, optimizePhoto } from './core/media-pipeline'
import { openMediaViewer } from './core/media-viewer'
import { uploadPrivateMedia } from './core/resumable-storage'

const BUCKET='family-photos'
const AVATAR_MAX_BYTES=8*1024*1024
const COVER_MAX_BYTES=10*1024*1024

type MemberRow={id:string;name:string;active:boolean}
type ProfileRow={member_id:string;avatar_path:string|null;bio:string;theme:string;updated_at?:string;cover_path:string|null}
type PhotoRow={storage_path:string;created_at:string}

const css=`
.profile-menu{position:fixed;inset:0;z-index:1000;background:rgba(12,11,10,.5);display:flex;justify-content:flex-end;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}
.profile-drawer{width:min(100vw,460px);height:100dvh;background:var(--surface,#fff);color:var(--ink,#171716);overflow:auto;box-shadow:-20px 0 60px rgba(0,0,0,.18);padding:0 20px calc(26px + env(safe-area-inset-bottom));box-sizing:border-box}
.profile-topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:18px 0 12px;background:color-mix(in srgb,var(--surface,#fff) 94%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.profile-topbar strong{font:500 24px var(--display-font,Georgia,serif)}
.profile-close,.profile-back{width:42px;height:42px;border:0;border-radius:50%;background:rgba(0,0,0,.055);font-size:28px;line-height:1;color:inherit;display:grid;place-items:center;cursor:pointer}
.profile-hero{position:relative;margin:4px 0 18px}.profile-cover-preview{height:178px;border-radius:26px;background:linear-gradient(135deg,#e7e0d4,#f6f2ea);background-size:cover;background-position:center;overflow:hidden;position:relative}.profile-cover-preview::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 48%,rgba(0,0,0,.28));pointer-events:none}.profile-cover-button{position:absolute;right:12px;bottom:12px;z-index:2;border:0;border-radius:999px;padding:9px 13px;background:rgba(20,20,18,.76);color:#fff;font:700 12px system-ui;cursor:pointer;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.profile-identity{position:relative;margin-top:-49px;padding:0 12px;text-align:center}.profile-avatar-wrap{position:relative;width:104px;height:104px;margin:auto}.profile-avatar,.profile-avatar-fallback{width:104px;height:104px;border-radius:50%;border:4px solid var(--surface,#fff);box-sizing:border-box;box-shadow:0 8px 24px rgba(0,0,0,.14)}.profile-avatar{object-fit:cover;background:#ddd;display:block}.profile-avatar-fallback{background:#171716;color:#fff;display:grid;place-items:center;font:500 39px var(--display-font,Georgia,serif)}.profile-avatar-edit{position:absolute;right:0;bottom:3px;width:34px;height:34px;border:2px solid var(--surface,#fff);border-radius:50%;background:#171716;color:#fff;display:grid;place-items:center;font-size:15px;cursor:pointer}.profile-name{font:500 30px var(--display-font,Georgia,serif);margin:12px 0 4px}.profile-bio{font-size:14px;line-height:1.5;opacity:.68;margin:0 auto;max-width:340px;white-space:pre-wrap;min-height:21px}
.profile-card{margin:14px 0;padding:16px;border:1px solid rgba(0,0,0,.08);border-radius:22px;background:rgba(0,0,0,.022)}.profile-card-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.profile-card-title b{font-size:14px}.profile-card-title span{font-size:11px;opacity:.55}.profile-field{margin:0 0 14px}.profile-field:last-child{margin-bottom:0}.profile-field label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.13em;margin-bottom:7px;opacity:.58;font-weight:800}.profile-field textarea{width:100%;min-height:92px;border:1px solid rgba(0,0,0,.12);border-radius:15px;padding:12px 13px;font:14px/1.45 system-ui,sans-serif;box-sizing:border-box;background:var(--surface,#fff);color:inherit;resize:none;outline:none}.profile-field textarea:focus{border-color:rgba(0,0,0,.32)}.profile-char-count{text-align:right;font-size:10px;opacity:.48;margin-top:5px}
.profile-actions{display:grid;gap:9px}.profile-button{min-height:46px;border:0;border-radius:15px;padding:0 15px;font:700 13px system-ui;cursor:pointer;background:var(--ink,#171716);color:var(--surface,#fff)}.profile-button.secondary{background:rgba(0,0,0,.065);color:inherit}.profile-button.ghost{background:transparent;color:inherit;border:1px solid rgba(0,0,0,.1)}.profile-button:disabled{opacity:.5;cursor:wait}.theme-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.theme-row button.active{box-shadow:inset 0 0 0 2px currentColor}.profile-status{min-height:18px;margin:8px 2px 0;font-size:11px;color:#667064}.profile-status.error{color:#a04c43}
.profiles-section{margin-top:22px;border-top:1px solid rgba(0,0,0,.08);padding-top:18px}.profiles-section-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:11px}.profiles-section h3{font:500 22px var(--display-font,Georgia,serif);margin:0}.profiles-section-head span{font-size:10px;opacity:.5}.profile-list{display:grid;gap:8px}.profile-list-item{width:100%;display:flex;align-items:center;gap:11px;border:0;background:rgba(0,0,0,.04);color:inherit;border-radius:17px;padding:9px 11px;text-align:left;cursor:pointer}.profile-list-item.mine{background:rgba(76,54,127,.09)}.profile-list-avatar,.profile-list-avatar img{width:46px;height:46px;flex:0 0 46px;border-radius:50%;object-fit:cover}.profile-list-avatar{display:grid;place-items:center;background:#171716;color:#fff;font-weight:800}.profile-list-copy{min-width:0;flex:1}.profile-list-copy strong{display:block;font-size:14px}.profile-list-copy span{display:block;font-size:11px;opacity:.55;margin-top:2px}.profile-list-arrow{font-size:20px;opacity:.4}
.profile-switch{margin-top:18px;padding-top:16px;border-top:1px solid rgba(0,0,0,.08)}
.profile-detail{position:fixed;inset:0;z-index:1100;background:var(--surface,#fff);color:var(--ink,#171716);overflow:auto;padding:0 18px calc(28px + env(safe-area-inset-bottom));box-sizing:border-box}.profile-detail-top{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:11px;padding:17px 0 12px;background:color-mix(in srgb,var(--surface,#fff) 94%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}.profile-detail-top div{min-width:0}.profile-detail-top .eyebrow{margin:0;font-size:9px}.profile-detail-top b{display:block;font-size:14px;margin-top:2px}.profile-detail-cover{width:100%;height:190px;border-radius:25px;object-fit:cover;background:linear-gradient(135deg,#e4ded2,#f5f1e8);display:block}.profile-detail-identity{text-align:center;margin-top:-50px;position:relative}.profile-detail-identity .profile-avatar,.profile-detail-identity .profile-avatar-fallback{margin:auto}.profile-detail-name{font:500 31px var(--display-font,Georgia,serif);margin:12px 0 4px}.profile-detail-bio{font-size:14px;line-height:1.5;opacity:.68;margin:0 auto;max-width:360px;white-space:pre-wrap}.profile-stats{display:grid;grid-template-columns:1fr;gap:9px;margin:21px 0}.profile-stat{border-radius:18px;background:rgba(0,0,0,.045);padding:15px}.profile-stat b{display:block;font-size:25px}.profile-stat span{font-size:11px;opacity:.6}.profile-gallery-title{font:500 22px var(--display-font,Georgia,serif);margin:24px 0 10px}.profile-gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.profile-gallery-item{border:0;padding:0;background:#ece8df;border-radius:9px;overflow:hidden;aspect-ratio:1;cursor:pointer}.profile-gallery-item img{width:100%;height:100%;object-fit:cover;display:block}.profile-empty{grid-column:1/-1;padding:26px 12px;text-align:center;border:1px dashed rgba(0,0,0,.12);border-radius:16px;font-size:12px;opacity:.6}
.dark-mode .profile-drawer,.dark-mode .profile-detail{background:#181818;color:#f5f5f2}.dark-mode .profile-avatar,.dark-mode .profile-avatar-fallback,.dark-mode .profile-avatar-edit{border-color:#181818}.dark-mode .profile-card,.dark-mode .profile-list-item,.dark-mode .profile-stat{background:#242422;border-color:#333}.dark-mode .profile-list-item.mine{background:#2d273b}.dark-mode .profile-field textarea{background:#1e1e1d;border-color:#3a3a38}.dark-mode .profile-button.secondary{background:#2a2a28}.dark-mode .profile-button.ghost{border-color:#3a3a38}.dark-mode .profile-topbar,.dark-mode .profile-detail-top{background:rgba(24,24,24,.94)}
@media(max-width:520px){.profile-drawer{width:100vw}.profile-menu{background:var(--surface,#fff)}.profile-detail{padding-left:14px;padding-right:14px}.profile-cover-preview{height:165px}.profile-detail-cover{height:178px}}
`

function inject(){
  if(document.querySelector('#profile-css'))return
  const style=document.createElement('style')
  style.id='profile-css'
  style.textContent=css
  document.head.appendChild(style)
}

function current(){return getIdentity()}
function memberIdOf(value:any){return String(value?.memberId||value?.id||'')}
function esc(value:string){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char))}
function avatarUrl(path:string|null|undefined){return path?mediaUrl(path):''}
function setBusy(button:HTMLButtonElement,busy:boolean,text:string){button.disabled=busy;button.textContent=text}

async function getProfile(id:string):Promise<ProfileRow>{
  const {data,error}=await supabase.from('family_profiles').select('member_id,avatar_path,bio,theme,updated_at,cover_path').eq('member_id',id).maybeSingle()
  if(error)throw error
  const profile=(data||{member_id:id,avatar_path:null,bio:'',theme:'light',cover_path:null}) as ProfileRow
  await primeMedia([profile.avatar_path,profile.cover_path])
  return profile
}

function applyTheme(theme:string){
  const resolved=theme==='dark'?'dark':'light'
  document.documentElement.classList.toggle('dark-mode',resolved==='dark')
  document.documentElement.classList.toggle('light-mode',resolved==='light')
  localStorage.setItem('familia-noa-theme',resolved)
}

async function saveProfile(id:string,bio:string,theme:string){
  const {error}=await supabase.from('family_profiles').upsert({
    member_id:id,
    bio:bio.slice(0,280),
    theme:theme==='dark'?'dark':'light',
    updated_at:new Date().toISOString()
  })
  if(error)throw error
  applyTheme(theme)
}

async function uploadAvatar(id:string,file:File){
  if(!file.type.startsWith('image/'))throw new Error('Selecciona una imagen.')
  if(file.size>AVATAR_MAX_BYTES)throw new Error('La foto debe pesar menos de 8 MB.')
  const prepared=await optimizeAvatar(file,320,.8).catch(()=>{throw new Error('No se pudo preparar esta foto. Prueba con JPG, PNG o WebP.')})
  const {data:previous,error:previousError}=await supabase.from('family_profiles').select('avatar_path').eq('member_id',id).maybeSingle()
  if(previousError)throw previousError
  const path=`profile-avatars/${id}-${Date.now()}.${prepared.ext}`
  await uploadPrivateMedia(path,prepared.blob,{contentType:prepared.type,cacheControl:'31536000'})
  const {data:old,error:oldError}=await supabase.from('family_profiles').select('bio,theme,cover_path').eq('member_id',id).maybeSingle()
  if(oldError){await supabase.storage.from(BUCKET).remove([path]);throw oldError}
  const {error:dbError}=await supabase.from('family_profiles').upsert({member_id:id,avatar_path:path,bio:old?.bio||'',theme:old?.theme||'light',cover_path:old?.cover_path||null,updated_at:new Date().toISOString()})
  if(dbError){await supabase.storage.from(BUCKET).remove([path]);forgetMedia(path);throw dbError}
  if(previous?.avatar_path&&previous.avatar_path!==path){
    const {error:removeError}=await supabase.storage.from(BUCKET).remove([previous.avatar_path])
    if(!removeError)forgetMedia(previous.avatar_path)
  }
  await signMedia(path)
  return path
}

async function uploadCover(id:string,file:File){
  if(!file.type.startsWith('image/'))throw new Error('Selecciona una imagen.')
  if(file.size>COVER_MAX_BYTES)throw new Error('La portada debe pesar menos de 10 MB.')
  const prepared=await optimizePhoto(file,1600,.78).catch(()=>{throw new Error('No se pudo preparar esta portada. Prueba con JPG, PNG o WebP.')})
  const {data:previous,error:previousError}=await supabase.from('family_profiles').select('cover_path').eq('member_id',id).maybeSingle()
  if(previousError)throw previousError
  const path=`profile-covers/${id}-${Date.now()}.${prepared.ext}`
  await uploadPrivateMedia(path,prepared.blob,{contentType:prepared.type,cacheControl:'31536000'})
  const {data:old,error:oldError}=await supabase.from('family_profiles').select('avatar_path,bio,theme').eq('member_id',id).maybeSingle()
  if(oldError){await supabase.storage.from(BUCKET).remove([path]);throw oldError}
  const {error:dbError}=await supabase.from('family_profiles').upsert({member_id:id,avatar_path:old?.avatar_path||null,bio:old?.bio||'',theme:old?.theme||'light',cover_path:path,updated_at:new Date().toISOString()})
  if(dbError){await supabase.storage.from(BUCKET).remove([path]);forgetMedia(path);throw dbError}
  if(previous?.cover_path&&previous.cover_path!==path){
    const {error:removeError}=await supabase.storage.from(BUCKET).remove([previous.cover_path])
    if(!removeError)forgetMedia(previous.cover_path)
  }
  await signMedia(path)
  return path
}

function updateHomeAvatar(path:string|null|undefined){
  const button=document.querySelector<HTMLButtonElement>('#change')
  if(!button)return
  const url=avatarUrl(path)
  const identity=current()
  button.innerHTML=url?`<img src="${esc(url)}" alt="Foto de ${esc(identity?.name||'perfil')}">`:esc(identity?.name?.charAt(0)||'F')
  button.setAttribute('aria-label','Abrir perfil')
}

async function hydrateHomeAvatar(){
  const identity=current()
  if(!identity?.memberId||!document.querySelector('#change'))return
  try{
    const profile=await getProfile(identity.memberId)
    updateHomeAvatar(profile.avatar_path)
  }catch(error){
    console.error('Profile avatar hydration failed',error)
  }
}

function setProfileStatus(root:Element,message:string,error=false){
  const status=root.querySelector<HTMLElement>('#profileStatus')
  if(!status)return
  status.textContent=message
  status.classList.toggle('error',error)
}

async function switchProfile(button:HTMLButtonElement){
  setBusy(button,true,'Saliendo…')
  try{await supabase.auth.signOut({scope:'local'})}catch{}
  clearIdentity()
  window.location.reload()
}

async function openSettings(){
  const identity=current()
  if(!identity?.memberId||document.querySelector('.profile-menu'))return
  const profile=await getProfile(identity.memberId)
  if(document.querySelector('.profile-menu'))return
  const photo=avatarUrl(profile.avatar_path)
  const cover=avatarUrl(profile.cover_path)
  const overlay=document.createElement('div')
  overlay.className='profile-menu'
  overlay.innerHTML=`<aside class="profile-drawer" role="dialog" aria-modal="true" aria-label="Tu perfil"><div class="profile-topbar"><strong>Perfil</strong><button class="profile-close" type="button" aria-label="Cerrar">×</button></div><section class="profile-hero"><div class="profile-cover-preview" id="coverPreview"><button class="profile-cover-button" id="coverButton" type="button">${cover?'Cambiar portada':'Agregar portada'}</button></div><div class="profile-identity"><div class="profile-avatar-wrap"><img class="profile-avatar" id="myAvatar" ${photo?`src="${esc(photo)}"`:''} alt="${esc(identity.name)}" style="${photo?'':'display:none'}"><div class="profile-avatar-fallback" id="avatarFallback" style="${photo?'display:none':''}">${esc(identity.name.charAt(0))}</div><button type="button" class="profile-avatar-edit" id="avatarButton" aria-label="Cambiar foto">＋</button></div><div class="profile-name">${esc(identity.name)}</div><p class="profile-bio" id="bioPreview">${esc(profile.bio||'Tu espacio dentro de FAMILIA NOA.')}</p></div></section><input id="avatarFile" type="file" accept="image/*" hidden><input id="coverFile" type="file" accept="image/*" hidden><section class="profile-card"><div class="profile-card-title"><b>Tu información</b><span>Solo tú puedes editarla</span></div><div class="profile-field"><label for="bio">Frase / biografía</label><textarea id="bio" maxlength="280" placeholder="Escribe algo que quieras compartir con la familia…">${esc(profile.bio||'')}</textarea><div class="profile-char-count"><span id="bioCount">${(profile.bio||'').length}</span>/280</div></div><div class="profile-field"><label>Experiencia</label><div class="theme-row"><button type="button" class="profile-button secondary ${profile.theme!=='dark'?'active':''}" id="lightTheme">☀️ Claro</button><button type="button" class="profile-button secondary ${profile.theme==='dark'?'active':''}" id="darkTheme">🌙 Oscuro</button></div></div><div class="profile-actions"><button type="button" class="profile-button" id="saveProfile">Guardar cambios</button></div><div class="profile-status" id="profileStatus"></div></section><section class="profiles-section"><div class="profiles-section-head"><h3>Familia</h3><span>Perfiles activos</span></div><div class="profile-list" id="profileList"><div class="profile-status">Cargando perfiles…</div></div></section><div class="profile-switch"><button type="button" class="profile-button ghost" id="switchProfile">Cambiar perfil</button></div></aside>`
  document.body.appendChild(overlay)
  if(cover)(overlay.querySelector<HTMLElement>('#coverPreview')!).style.backgroundImage=`url("${cover}")`

  const close=()=>overlay.remove()
  overlay.querySelector('.profile-close')!.addEventListener('click',close)
  overlay.addEventListener('click',event=>{if(event.target===overlay)close()})

  const bio=overlay.querySelector<HTMLTextAreaElement>('#bio')!
  bio.addEventListener('input',()=>{overlay.querySelector('#bioCount')!.textContent=String(bio.value.length)})

  let theme=profile.theme==='dark'?'dark':'light'
  const lightButton=overlay.querySelector<HTMLButtonElement>('#lightTheme')!
  const darkButton=overlay.querySelector<HTMLButtonElement>('#darkTheme')!
  lightButton.addEventListener('click',()=>{theme='light';lightButton.classList.add('active');darkButton.classList.remove('active')})
  darkButton.addEventListener('click',()=>{theme='dark';darkButton.classList.add('active');lightButton.classList.remove('active')})

  overlay.querySelector('#avatarButton')!.addEventListener('click',()=>overlay.querySelector<HTMLInputElement>('#avatarFile')!.click())
  overlay.querySelector('#coverButton')!.addEventListener('click',()=>overlay.querySelector<HTMLInputElement>('#coverFile')!.click())

  overlay.querySelector('#avatarFile')!.addEventListener('change',async event=>{
    const input=event.target as HTMLInputElement
    const file=input.files?.[0]
    input.value=''
    if(!file)return
    const button=overlay.querySelector<HTMLButtonElement>('#avatarButton')!
    setBusy(button,true,'…')
    setProfileStatus(overlay,'Preparando foto…')
    try{
      const path=await uploadAvatar(identity.memberId,file)
      const url=avatarUrl(path)
      const img=overlay.querySelector<HTMLImageElement>('#myAvatar')!
      img.src=url
      img.style.display='block'
      ;(overlay.querySelector('#avatarFallback') as HTMLElement).style.display='none'
      updateHomeAvatar(path)
      setProfileStatus(overlay,'Foto de perfil actualizada.')
      await renderProfileList(overlay.querySelector('#profileList')!)
    }catch(error){
      console.error('Profile avatar upload failed',error)
      setProfileStatus(overlay,error instanceof Error?error.message:'No se pudo subir la foto.',true)
    }finally{
      setBusy(button,false,'＋')
    }
  })

  overlay.querySelector('#coverFile')!.addEventListener('change',async event=>{
    const input=event.target as HTMLInputElement
    const file=input.files?.[0]
    input.value=''
    if(!file)return
    const button=overlay.querySelector<HTMLButtonElement>('#coverButton')!
    setBusy(button,true,'Preparando…')
    setProfileStatus(overlay,'Preparando portada…')
    try{
      const path=await uploadCover(identity.memberId,file)
      const url=avatarUrl(path)
      ;(overlay.querySelector<HTMLElement>('#coverPreview')!).style.backgroundImage=`url("${url}")`
      setProfileStatus(overlay,'Portada actualizada.')
      button.textContent='Cambiar portada'
    }catch(error){
      console.error('Profile cover upload failed',error)
      setProfileStatus(overlay,error instanceof Error?error.message:'No se pudo subir la portada.',true)
    }finally{
      button.disabled=false
      if(button.textContent==='Preparando…')button.textContent=profile.cover_path?'Cambiar portada':'Agregar portada'
    }
  })

  overlay.querySelector('#saveProfile')!.addEventListener('click',async()=>{
    const button=overlay.querySelector<HTMLButtonElement>('#saveProfile')!
    if(button.disabled)return
    setBusy(button,true,'Guardando…')
    setProfileStatus(overlay,'')
    try{
      await saveProfile(identity.memberId,bio.value,theme)
      overlay.querySelector('#bioPreview')!.textContent=bio.value.trim()||'Tu espacio dentro de FAMILIA NOA.'
      setProfileStatus(overlay,'Perfil guardado.')
    }catch(error){
      console.error('Profile save failed',error)
      setProfileStatus(overlay,error instanceof Error?error.message:'No se pudo guardar el perfil.',true)
    }finally{
      setBusy(button,false,'Guardar cambios')
    }
  })

  overlay.querySelector('#switchProfile')!.addEventListener('click',()=>void switchProfile(overlay.querySelector<HTMLButtonElement>('#switchProfile')!))
  await renderProfileList(overlay.querySelector('#profileList')!)
}

async function renderProfileList(element:Element){
  const identity=current()
  const {data:members,error:memberError}=await supabase.from('family_members').select('id,name,active').eq('active',true).order('created_at')
  if(memberError){element.innerHTML='<div class="profile-status error">No se pudieron cargar los perfiles.</div>';return}
  const rows=[...((members||[]) as MemberRow[])].sort((a,b)=>a.id===identity?.memberId?-1:b.id===identity?.memberId?1:0)
  const ids=rows.map(member=>member.id)
  const {data:profiles,error:profileError}=ids.length?await supabase.from('family_profiles').select('member_id,avatar_path').in('member_id',ids):{data:[],error:null}
  if(profileError){element.innerHTML='<div class="profile-status error">No se pudieron cargar los perfiles.</div>';return}
  await primeMedia((profiles||[]).map((profile:any)=>profile.avatar_path))
  const profileMap=new Map((profiles||[]).map((profile:any)=>[profile.member_id,profile]))
  element.innerHTML=rows.map(member=>{
    const profile:any=profileMap.get(member.id)
    const avatar=avatarUrl(profile?.avatar_path)
    const mine=member.id===identity?.memberId
    return `<button type="button" class="profile-list-item${mine?' mine':''}" data-profile-id="${esc(member.id)}"><span class="profile-list-avatar">${avatar?`<img src="${esc(avatar)}" alt="Foto de ${esc(member.name)}">`:esc(member.name.charAt(0))}</span><span class="profile-list-copy"><strong>${esc(member.name)}${mine?' · tú':''}</strong><span>${mine?'Tu perfil':'Ver perfil'}</span></span><span class="profile-list-arrow">›</span></button>`
  }).join('')
  element.querySelectorAll<HTMLButtonElement>('[data-profile-id]').forEach(button=>button.addEventListener('click',()=>{
    const member=rows.find(row=>row.id===button.dataset.profileId)
    if(member)void openProfile(member.id,member.name)
  }))
}

async function openProfile(id:string,name:string){
  if(document.querySelector('.profile-detail'))return
  const [profileResult,countResult,photoResult]=await Promise.all([
    getProfile(id),
    supabase.from('photos').select('id',{count:'exact',head:true}).eq('uploader_id',id),
    supabase.from('photos').select('storage_path,created_at').eq('uploader_id',id).order('created_at',{ascending:false}).limit(18)
  ])
  if(countResult.error)console.error('Profile photo count failed',countResult.error)
  if(photoResult.error)console.error('Profile gallery load failed',photoResult.error)
  const photos=(photoResult.data||[]) as PhotoRow[]
  await primeMedia(photos.map(photo=>photo.storage_path))
  const available=photos.map(photo=>({photo,src:avatarUrl(photo.storage_path)})).filter(item=>!!item.src)
  const cover=avatarUrl(profileResult.cover_path)
  const avatar=avatarUrl(profileResult.avatar_path)
  const detail=document.createElement('div')
  detail.className='profile-detail'
  detail.innerHTML=`<div class="profile-detail-top"><button class="profile-back" type="button" aria-label="Volver">‹</button><div><div class="eyebrow">FAMILIA NOA</div><b>${esc(name)}</b></div></div>${cover?`<img class="profile-detail-cover" src="${esc(cover)}" alt="Portada de ${esc(name)}">`:'<div class="profile-detail-cover"></div>'}<section class="profile-detail-identity"><img class="profile-avatar" ${avatar?`src="${esc(avatar)}"`:''} alt="${esc(name)}" style="${avatar?'':'display:none'}"><div class="profile-avatar-fallback" style="${avatar?'display:none':''}">${esc(name.charAt(0))}</div><div class="profile-detail-name">${esc(name)}</div><p class="profile-detail-bio">${esc(profileResult.bio||'Esta persona todavía no ha escrito su frase.')}</p></section><div class="profile-stats"><div class="profile-stat"><b>${countResult.count||0}</b><span>Fotos compartidas</span></div></div><h3 class="profile-gallery-title">Momentos</h3><div class="profile-gallery">${available.length?available.map((item,index)=>`<button type="button" class="profile-gallery-item" data-gallery-index="${index}" aria-label="Abrir foto de ${esc(name)}"><img src="${esc(item.src)}" alt="Foto de ${esc(name)}" loading="lazy" decoding="async"></button>`).join(''):'<div class="profile-empty">Aún no ha compartido fotos.</div>'}</div>`
  document.body.appendChild(detail)
  detail.querySelector('.profile-back')!.addEventListener('click',()=>detail.remove())
  detail.querySelectorAll<HTMLButtonElement>('[data-gallery-index]').forEach(button=>button.addEventListener('click',()=>{
    const index=Number(button.dataset.galleryIndex||0)
    openMediaViewer(available.map(item=>({src:item.src,alt:`Foto de ${name}`})),index)
  }))
}

inject()

document.addEventListener('click',event=>{
  const target=event.target as Element|null
  if(!target?.closest('#change'))return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  void openSettings().catch(error=>console.error('Profile drawer failed to open',error))
},true)

let lastHomeAvatar:Element|null=null
const homeObserver=new MutationObserver(()=>{
  const button=document.querySelector('#change')
  if(button&&button!==lastHomeAvatar){
    lastHomeAvatar=button
    void hydrateHomeAvatar()
  }
})
homeObserver.observe(document.body,{childList:true,subtree:true})
void hydrateHomeAvatar()
