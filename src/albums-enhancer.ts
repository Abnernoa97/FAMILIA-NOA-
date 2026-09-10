import { supabase } from './supabase'

const BUCKET = 'family-photos'
const MAX_PHOTOS = 10
const MAX_BYTES = 15 * 1024 * 1024
const MAX_DIMENSION = 1600
const MEMBER_KEY = 'familia-noa-member'

const esc = (v: string) => v.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]!))
const memberName = () => localStorage.getItem(MEMBER_KEY) || ''

function injectStyles(){
  if(document.getElementById('familia-albums-style')) return
  const style=document.createElement('style')
  style.id='familia-albums-style'
  style.textContent=`
  .albums-page{min-height:100dvh;padding:22px 18px 110px;max-width:760px;margin:0 auto}
  .albums-head{display:flex;align-items:center;gap:14px;margin-bottom:24px}
  .albums-head button,.album-back{width:44px;height:44px;border:1px solid var(--line,#e7e2d8);background:var(--surface,#fff);border-radius:50%;font-size:26px;line-height:1;color:var(--ink,#171716);cursor:pointer}
  .albums-head .eyebrow{margin:0}.albums-head h1{margin:3px 0 0;font-family:var(--display-font,Georgia,serif);font-size:31px;font-weight:500}
  .albums-intro{color:var(--muted,#777);font-size:14px;line-height:1.5;margin:-10px 0 22px}
  .album-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .album-card{position:relative;overflow:hidden;min-height:205px;border:1px solid var(--line,#e7e2d8);border-radius:25px;background:var(--surface,#fff);padding:0;text-align:left;cursor:pointer;box-shadow:0 8px 30px rgba(20,18,14,.05);transition:transform .2s,box-shadow .2s}
  .album-card:active{transform:scale(.985)}
  .album-cover{height:155px;background:linear-gradient(135deg,#e9e3d8,#f8f6f1);overflow:hidden;display:flex;align-items:center;justify-content:center}
  .album-cover img{width:100%;height:100%;object-fit:cover;display:block}
  .album-empty{font-family:var(--display-font,Georgia,serif);font-size:32px;opacity:.45}
  .album-info{padding:12px 14px 14px}.album-info b{display:block;font-family:var(--display-font,Georgia,serif);font-size:18px;font-weight:500}.album-info span{display:block;color:var(--muted,#777);font-size:11px;margin-top:3px}
  .album-badge{position:absolute;right:11px;top:11px;padding:6px 9px;border-radius:999px;background:rgba(20,20,18,.72);color:#fff;font-size:10px;font-weight:700;backdrop-filter:blur(8px)}
  .album-actions{display:flex;gap:10px;margin:0 0 22px}.album-actions button,.album-upload-label{border:0;border-radius:15px;padding:13px 16px;background:var(--ink,#171716);color:#fff;font-weight:700;cursor:pointer;text-align:center}.album-upload-label{display:inline-block}.album-actions .secondary{background:#eeeae2;color:var(--ink,#171716)}
  .album-status{min-height:20px;font-size:12px;color:var(--muted,#777);margin:0 0 12px}.album-status.error{color:#a44b43}
  .photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.photo-grid-item{aspect-ratio:1;border-radius:12px;overflow:hidden;background:#eeeae2}.photo-grid-item img{width:100%;height:100%;object-fit:cover;display:block;cursor:pointer}
  .album-title-row{display:flex;align-items:center;gap:12px;margin-bottom:18px}.album-title-row h1{margin:0;font-size:30px;font-family:var(--display-font,Georgia,serif);font-weight:500}.album-count{color:var(--muted,#777);font-size:12px;margin:2px 0 0}
  .album-empty-state{padding:48px 20px;text-align:center;border:1px dashed var(--line,#ddd6ca);border-radius:22px;color:var(--muted,#777)}.album-empty-state b{display:block;font-family:var(--display-font,Georgia,serif);font-size:22px;color:var(--ink,#171716);margin-bottom:7px}
  .album-file{display:none}
  @media(max-width:430px){.album-grid{gap:10px}.album-card{min-height:185px}.album-cover{height:138px}.album-info{padding:10px 11px 12px}.album-info b{font-size:16px}.albums-page{padding-left:14px;padding-right:14px}.photo-grid{gap:4px}}
  `
  document.head.appendChild(style)
}

async function getCurrentMember(){
  const name=memberName()
  if(!name) return null
  const {data}=await supabase.from('family_members').select('id,name').eq('name',name).eq('active',true).maybeSingle()
  return data as {id:string;name:string}|null
}

async function loadAlbumData(){
  const [{data:members},{data:photos}]=await Promise.all([
    supabase.from('family_members').select('id,name,active').eq('active',true).order('created_at'),
    supabase.from('photos').select('id,uploader_id,storage_path,created_at,mime_type,file_size,width,height').order('created_at',{ascending:false}).limit(200)
  ])
  return {members:(members||[]) as any[],photos:(photos||[]) as any[]}
}

function photoUrl(path:string){return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}

async function compress(file:File){
  if(!file.type.startsWith('image/')) throw new Error('Solo se pueden subir fotos.')
  if(file.size>MAX_BYTES) throw new Error(`${file.name} supera 15 MB.`)
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'} as any)
  const scale=Math.min(1,MAX_DIMENSION/Math.max(bitmap.width,bitmap.height))
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale))
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();throw new Error('No se pudo preparar la foto.')}
  ctx.drawImage(bitmap,0,0,width,height);bitmap.close()
  const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/jpeg',.72))
  if(!blob) throw new Error(`No se pudo comprimir ${file.name}.`)
  return {blob,width,height}
}

async function upload(files:FileList|File[],status:HTMLElement){
  const current=await getCurrentMember();if(!current){status.textContent='No se pudo identificar tu perfil.';status.classList.add('error');return}
  const selected=Array.from(files);if(!selected.length)return
  const {count}=await supabase.from('photos').select('id',{count:'exact',head:true}).eq('uploader_id',current.id)
  const existing=count||0,remaining=MAX_PHOTOS-existing
  if(remaining<=0){status.textContent='Tu álbum ya tiene 10 fotos. El administrador puede liberar espacio borrando fotos.';return}
  if(selected.length>remaining){status.textContent=`Tu álbum tiene ${existing} fotos. Solo puedes agregar ${remaining} más.`;status.classList.add('error');return}
  status.classList.remove('error');status.textContent='Preparando fotos…'
  for(let i=0;i<selected.length;i++){
    const file=selected[i]
    try{
      status.textContent=`Comprimiendo foto ${i+1} de ${selected.length}…`
      const result=await compress(file)
      const path=`${current.id}/${crypto.randomUUID()}.jpg`
      const {error:uploadError}=await supabase.storage.from(BUCKET).upload(path,result.blob,{contentType:'image/jpeg',upsert:false,cacheControl:'31536000'})
      if(uploadError) throw uploadError
      const {error:rowError}=await supabase.from('photos').insert({uploader_id:current.id,storage_path:path,caption:null,mime_type:'image/jpeg',file_size:result.blob.size,width:result.width,height:result.height})
      if(rowError){await supabase.storage.from(BUCKET).remove([path]);throw rowError}
    }catch(e:any){status.textContent=e?.message||'No se pudo subir una de las fotos.';status.classList.add('error');return}
  }
  status.textContent=selected.length===1?'Foto agregada a tu álbum.':`${selected.length} fotos agregadas a tu álbum.`
  await renderAlbums()
}

function albumCard(member:any,photos:any[]){
  const mine=photos.filter(p=>p.uploader_id===member.id),cover=mine[0]
  return `<button class="album-card" data-album="${member.id}"><div class="album-cover">${cover?`<img src="${esc(photoUrl(cover.storage_path))}" alt="Álbum de ${esc(member.name)}">`:'<span class="album-empty">♡</span>'}</div><span class="album-badge">${mine.length}/10</span><div class="album-info"><b>Álbum de ${esc(member.name)}</b><span>${mine.length?`${mine.length} foto${mine.length===1?'':'s'}`:'Sin fotos todavía'}</span></div></button>`
}

async function renderAlbums(){
  injectStyles()
  const root=document.querySelector<HTMLElement>('[data-photo-page]')
  if(!root)return
  const {members,photos}=await loadAlbumData()
  root.className='albums-page';root.innerHTML=`<header class="albums-head"><button id="albumsBack" aria-label="Volver">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Álbumes</h1></div></header><p class="albums-intro">Cada foto va automáticamente al álbum de quien la comparte.</p><div class="album-actions"><label class="album-upload-label" for="familyAlbumUpload">＋ Subir fotos</label><input class="album-file" id="familyAlbumUpload" type="file" accept="image/*" multiple></div><div class="album-status" id="albumStatus"></div><section class="album-grid">${members.map(m=>albumCard(m,photos)).join('')}</section>`
  document.querySelector('#albumsBack')?.addEventListener('click',()=>{
    const homeButton=document.querySelector('#app .nav button.active') as HTMLElement|null
    ;(homeButton||document.querySelector('#app .top'))?.dispatchEvent(new Event('click'))
    location.reload()
  })
  document.querySelector('#familyAlbumUpload')?.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.files)upload(input.files,document.querySelector('#albumStatus')!);input.value=''})
  document.querySelectorAll<HTMLElement>('[data-album]').forEach(card=>card.addEventListener('click',()=>renderAlbum(card.dataset.album!,members,photos)))
}

function renderAlbum(id:string,members:any[],photos:any[]){
  const member=members.find(m=>m.id===id);if(!member)return
  const mine=photos.filter(p=>p.uploader_id===id)
  const root=document.querySelector<HTMLElement>('[data-photo-page]');if(!root)return
  root.className='albums-page';root.innerHTML=`<header class="albums-head"><button id="albumBack" aria-label="Volver a álbumes">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Fotos</h1></div></header><div class="album-title-row"><div><h1>Álbum de ${esc(member.name)}</h1><p class="album-count">${mine.length} de 10 fotos</p></div></div>${member.name===memberName()?`<div class="album-actions"><label class="album-upload-label" for="memberAlbumUpload">＋ Agregar fotos</label><input class="album-file" id="memberAlbumUpload" type="file" accept="image/*" multiple></div><div class="album-status" id="memberAlbumStatus"></div>`:''}<section class="photo-grid">${mine.map(p=>`<div class="photo-grid-item"><img src="${esc(photoUrl(p.storage_path))}" alt="Foto de ${esc(member.name)}" loading="lazy"></div>`).join('')}</section>${mine.length?'':'<div class="album-empty-state"><b>Aún no hay fotos</b><span>Cuando ${esc(member.name)} comparta una, aparecerá aquí automáticamente.</span></div>'}`
  document.querySelector('#albumBack')?.addEventListener('click',renderAlbums)
  document.querySelector('#memberAlbumUpload')?.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.files)upload(input.files,document.querySelector('#memberAlbumStatus')!);input.value=''})
}

let enhanced=false
const observer=new MutationObserver(()=>{
  const page=document.querySelector<HTMLElement>('[data-photo-page]')
  if(page&&!enhanced){enhanced=true;renderAlbums().finally(()=>{setTimeout(()=>{enhanced=false},0)})}
  if(!page) enhanced=false
})
observer.observe(document.body,{subtree:true,childList:true})
injectStyles()
