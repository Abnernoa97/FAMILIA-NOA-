import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { mediaUrl, primeMedia, signMedia, forgetMedia } from './core/private-media'
import { optimizePhoto, prepareVideo, prepareAudio, CHAT_VIDEO_MAX_BYTES, CHAT_AUDIO_MAX_BYTES, mediaLimitMb } from './core/media-pipeline'
import { uploadPrivateMedia } from './core/resumable-storage'

const BUCKET='family-photos'
const VIEW_KEY='familiaNoaView'
const REMINDER_KEY='familia-noa-presume-reminders'
const REACTIONS=['❤️','😂','🥹','🔥','👏'] as const

type Member={id:string;name:string}
type Profile={member_id:string;avatar_path:string|null}
type Post={id:string;member_id:string;media_type:'image'|'video'|'text'|'audio';media_path:string|null;body:string;prompt_slot:'morning'|'afternoon'|null;prompt_date:string|null;expires_at:string;created_at:string}
type Reaction={post_id:string;member_id:string;emoji:string}
type Comment={id:string;post_id:string;member_id:string;body:string;voice_path:string|null;created_at:string}
type SocialData={members:Member[];profiles:Map<string,Profile>;posts:Post[];reactions:Reaction[];comments:Comment[];memories:Post[]}

let overlay:HTMLElement|null=null
let storyOverlay:HTMLElement|null=null
let channel:ReturnType<typeof supabase.channel>|null=null
let reloadTimer:number|null=null
let reminderTimer:number|null=null
let reminderFollowups:number[]=[]
let data:SocialData={members:[],profiles:new Map(),posts:[],reactions:[],comments:[],memories:[]}

const css=`
#ok.presumecard{position:relative;overflow:hidden}.presume-home-dot{position:absolute;right:12px;top:12px;width:9px;height:9px;border-radius:50%;background:#ef6c68;box-shadow:0 0 0 5px rgba(239,108,104,.13)}
.presume-screen{position:fixed;inset:0;z-index:1200;background:#f6f3ed;color:#171716;overflow:auto;overscroll-behavior:contain;padding:0 14px calc(38px + env(safe-area-inset-bottom));box-sizing:border-box}.presume-inner{width:100%;max-width:760px;margin:0 auto}.presume-head{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:max(14px,env(safe-area-inset-top)) 0 10px;background:rgba(246,243,237,.94);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.presume-back,.presume-iconbtn{border:0;background:#e9e4da;color:#171716;border-radius:50%;width:42px;height:42px;display:grid;place-items:center;font-size:27px;cursor:pointer}.presume-brand{text-align:center}.presume-brand b{display:block;font:600 22px Georgia,serif;letter-spacing:.04em}.presume-brand span{display:block;font:800 8px system-ui;letter-spacing:.18em;color:#8d877d;margin-top:2px}.presume-head-spacer{width:42px}
.pres-stories{display:flex;gap:11px;overflow:auto;padding:8px 1px 15px;scrollbar-width:none}.pres-stories::-webkit-scrollbar{display:none}.pres-story{border:0;background:transparent;min-width:66px;padding:0;color:inherit;cursor:pointer}.pres-story-ring{width:58px;height:58px;border-radius:50%;padding:3px;background:#d8d1c5;margin:auto;box-sizing:border-box}.pres-story.has-story .pres-story-ring{background:linear-gradient(135deg,#ff8c72,#a56bd1,#f2c36b)}.pres-story-ring-inner{width:100%;height:100%;border-radius:50%;background:#f6f3ed;padding:2px;box-sizing:border-box}.pres-story-avatar,.pres-story-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}.pres-story-avatar{display:grid;place-items:center;background:#171716;color:#fff;font:800 18px system-ui}.pres-story small{display:block;max-width:66px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:700 10px system-ui;margin-top:6px}
.pres-challenge{border-radius:27px;background:#171716;color:#fff;padding:22px 18px;margin-bottom:14px;position:relative;overflow:hidden}.pres-challenge::after{content:'📸';position:absolute;right:10px;bottom:-18px;font-size:84px;opacity:.12;transform:rotate(-9deg)}.pres-challenge .eyebrow{color:#bdb7ae;margin:0 0 7px}.pres-challenge h2{font:500 29px/1.05 Georgia,serif;margin:0 70px 9px 0}.pres-challenge p{font:13px/1.45 system-ui;margin:0 45px 17px 0;color:#d8d3cc}.pres-challenge-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:13px}.pres-chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:7px 10px;background:rgba(255,255,255,.1);font:700 10px system-ui}.pres-main{width:100%;min-height:50px;border:0;border-radius:16px;background:#fff;color:#171716;font:800 13px system-ui;cursor:pointer}.pres-main.done{background:#343432;color:#d7d3cc}.pres-reminder{margin-top:9px;width:100%;border:0;background:transparent;color:#bbb5ac;font:700 10px system-ui;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.pres-compose{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:0 0 18px}.pres-compose button{border:1px solid #ded8ce;background:#fff;border-radius:16px;min-height:58px;color:#171716;font:700 10px system-ui;cursor:pointer}.pres-compose i{display:block;font-style:normal;font-size:20px;margin-bottom:3px}
.pres-section-head{display:flex;justify-content:space-between;align-items:end;margin:24px 2px 10px}.pres-section-head h3{font:500 23px Georgia,serif;margin:0}.pres-section-head span{font:700 9px system-ui;letter-spacing:.09em;color:#969087;text-transform:uppercase}.pres-memory-strip{display:flex;gap:10px;overflow:auto;scrollbar-width:none;padding-bottom:4px}.pres-memory-strip::-webkit-scrollbar{display:none}.pres-memory{min-width:210px;max-width:210px;border:0;background:#fff;border-radius:20px;overflow:hidden;text-align:left;padding:0;color:inherit;box-shadow:0 4px 18px rgba(0,0,0,.04)}.pres-memory-media{height:150px;background:#e8e2d8;display:grid;place-items:center;overflow:hidden}.pres-memory-media img,.pres-memory-media video{width:100%;height:100%;object-fit:cover}.pres-memory-copy{padding:10px 12px}.pres-memory-copy b{display:block;font:700 11px system-ui}.pres-memory-copy span{font:11px/1.35 system-ui;color:#777169}
.pres-feed{display:grid;gap:14px}.pres-post{background:#fff;border:1px solid #e4ded4;border-radius:22px;overflow:hidden}.pres-post-head{display:flex;align-items:center;gap:9px;padding:11px 12px}.pres-post-avatar,.pres-post-avatar img{width:37px;height:37px;border-radius:50%;object-fit:cover}.pres-post-avatar{display:grid;place-items:center;background:#171716;color:#fff;font:800 13px system-ui}.pres-post-who{min-width:0;flex:1}.pres-post-who b{display:block;font:700 12px system-ui}.pres-post-who span{display:block;font:10px system-ui;color:#8c867e;margin-top:2px}.pres-post-slot{font:800 8px system-ui;letter-spacing:.09em;color:#aaa39a;text-transform:uppercase}.pres-post-media{position:relative;background:#eee8de;min-height:220px;display:grid;place-items:center;user-select:none;-webkit-user-select:none;touch-action:manipulation}.pres-post-media img,.pres-post-media video{display:block;width:100%;max-height:66vh;object-fit:cover}.pres-post-media video{background:#111;min-height:240px}.pres-post-text{padding:36px 24px;font:500 27px/1.18 Georgia,serif;text-align:center;white-space:pre-wrap;background:linear-gradient(145deg,#f3dbc7,#ddd6f0)}.pres-post-audio{width:calc(100% - 30px);margin:34px 15px}.pres-heart-pop{position:absolute;inset:0;display:grid;place-items:center;font-size:80px;pointer-events:none;animation:presHeart .6s ease forwards}@keyframes presHeart{0%{opacity:0;transform:scale(.3)}35%{opacity:1;transform:scale(1.15)}100%{opacity:0;transform:scale(.9)}}.pres-caption{padding:11px 13px 2px;font:13px/1.42 system-ui;white-space:pre-wrap}.pres-actions{display:flex;align-items:center;gap:8px;padding:9px 11px 11px}.pres-action{border:0;background:#f2eee7;color:#171716;border-radius:999px;padding:8px 11px;font:700 11px system-ui;cursor:pointer}.pres-action.mine{background:#171716;color:#fff}.pres-reaction-bar{display:flex;gap:5px;padding:0 11px 10px}.pres-reaction-bar button{width:38px;height:36px;border:0;border-radius:13px;background:#f3efe8;font-size:19px;cursor:pointer}.pres-reaction-summary{display:flex;gap:5px;flex-wrap:wrap;padding:0 13px 9px}.pres-reaction-summary span{font:700 10px system-ui;background:#f5f1ea;border-radius:999px;padding:5px 7px}.pres-comments{border-top:1px solid #eee8de;padding:10px 12px 12px}.pres-comment{display:flex;gap:8px;margin-bottom:9px}.pres-comment-avatar,.pres-comment-avatar img{width:29px;height:29px;border-radius:50%;object-fit:cover}.pres-comment-avatar{display:grid;place-items:center;background:#282725;color:#fff;font:800 10px system-ui}.pres-comment-body{flex:1;background:#f5f1ea;border-radius:14px;padding:8px 10px}.pres-comment-body b{font:700 10px system-ui;display:block;margin-bottom:2px}.pres-comment-body p{margin:0;font:12px/1.35 system-ui}.pres-comment-body audio{width:100%;height:34px}.pres-comment-form{display:flex;gap:6px;align-items:center;margin-top:8px}.pres-comment-form input{min-width:0;flex:1;border:1px solid #ddd7cc;border-radius:999px;padding:11px 13px;background:#fff;font:12px system-ui}.pres-comment-form button{border:0;border-radius:50%;width:39px;height:39px;background:#171716;color:#fff;font-size:15px}.pres-empty{padding:34px 16px;text-align:center;border:1px dashed #d6d0c5;border-radius:20px;color:#8b857c;font:12px/1.5 system-ui}
.pres-modal{position:fixed;inset:0;z-index:1400;background:rgba(17,17,16,.5);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}.pres-sheet{width:min(100%,620px);max-height:88dvh;overflow:auto;background:#f8f5ef;border-radius:26px 26px 0 0;padding:15px 16px calc(18px + env(safe-area-inset-bottom));box-sizing:border-box}.pres-sheet-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.pres-sheet-head b{font:500 21px Georgia,serif}.pres-sheet-close{border:0;width:38px;height:38px;border-radius:50%;background:#e9e4da;font-size:22px}.pres-preview{border-radius:20px;overflow:hidden;background:#e9e3d9;display:grid;place-items:center;min-height:180px;max-height:52vh}.pres-preview img,.pres-preview video{width:100%;max-height:52vh;object-fit:contain}.pres-sheet textarea{width:100%;min-height:84px;border:1px solid #ddd6cc;border-radius:16px;padding:12px;margin-top:10px;box-sizing:border-box;font:13px/1.4 system-ui;resize:none;background:#fff}.pres-publish{width:100%;min-height:48px;border:0;border-radius:16px;background:#171716;color:#fff;font:800 13px system-ui;margin-top:9px}.pres-publish:disabled{opacity:.55}.pres-record{padding:24px;text-align:center}.pres-record-pulse{width:74px;height:74px;border-radius:50%;margin:0 auto 12px;background:#171716;color:#fff;display:grid;place-items:center;font-size:28px}.pres-record.recording .pres-record-pulse{animation:pulse 1.2s infinite}@keyframes pulse{50%{transform:scale(1.08);box-shadow:0 0 0 12px rgba(23,23,22,.08)}}.pres-record p{font:12px system-ui;color:#77716a}
.pres-story-view{position:fixed;inset:0;z-index:1600;background:#090909;color:#fff;display:grid;grid-template-rows:auto 1fr auto}.pres-story-top{display:flex;align-items:center;gap:9px;padding:max(13px,env(safe-area-inset-top)) 13px 10px}.pres-story-top .pres-post-avatar{background:#fff;color:#111}.pres-story-top b{font:700 12px system-ui;flex:1}.pres-story-close{border:0;background:rgba(255,255,255,.12);color:#fff;width:40px;height:40px;border-radius:50%;font-size:25px}.pres-story-stage{min-height:0;display:grid;place-items:center;position:relative;overflow:hidden}.pres-story-stage img,.pres-story-stage video{max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain}.pres-story-stage .pres-post-text{color:#171716;width:100%;height:100%;box-sizing:border-box;display:grid;place-items:center}.pres-story-stage audio{width:calc(100% - 34px)}.pres-story-caption{padding:12px 18px calc(20px + env(safe-area-inset-bottom));font:13px/1.4 system-ui;text-align:center}.pres-story-nav{position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr}.pres-story-nav button{border:0;background:transparent}.pres-story-progress{display:flex;gap:4px;padding:0 13px}.pres-story-progress i{display:block;flex:1;height:2px;background:#444;border-radius:999px}.pres-story-progress i.active{background:#fff}
@media(max-width:520px){.presume-screen{padding-left:10px;padding-right:10px}.pres-challenge h2{font-size:27px}.pres-compose{gap:5px}.pres-post{border-radius:19px}.pres-post-media{min-height:200px}}
`

function inject(){if(document.getElementById('presume-css'))return;const style=document.createElement('style');style.id='presume-css';style.textContent=css;document.head.appendChild(style)}
function esc(value:string){return String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]||c))}
function identity(){return getIdentity()}
function profileFor(id:string){return data.profiles.get(id)}
function memberFor(id:string){return data.members.find(member=>member.id===id)}
function avatarFor(id:string){return mediaUrl(profileFor(id)?.avatar_path)||''}
function localDateKey(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function slotNow(): 'morning'|'afternoon'{return new Date().getHours()<14?'morning':'afternoon'}
function age(value:string){const ms=Date.now()-new Date(value).getTime();if(ms<60000)return'ahora';const m=Math.floor(ms/60000);if(m<60)return`hace ${m} min`;const h=Math.floor(m/60);if(h<24)return`hace ${h} h`;return`hace ${Math.floor(h/24)} d`}
function promptText(slot=slotNow()){
  const morning=['Presume dónde amaneciste.','Primera foto del día. Sin preparar.','¿Qué tienes enfrente ahora mismo?','Enséñanos cómo empieza tu día.']
  const afternoon=['Enséñanos tu tarde.','Foto sin preparar. Ya.','¿Dónde te agarró la tarde?','Presume qué estás haciendo ahora.']
  const values=slot==='morning'?morning:afternoon
  const d=new Date();return values[(d.getDate()+d.getMonth()+(slot==='afternoon'?2:0))%values.length]
}
function rawView(){return String(history.state?.[VIEW_KEY]||'home')}
function pushView(view:string){if(rawView()===view)return;history.pushState({...(history.state||{}),[VIEW_KEY]:view},'',location.href)}
function currentPending(){const me=identity()?.memberId;if(!me)return false;const day=localDateKey(),slot=slotNow();return !data.posts.some(post=>post.member_id===me&&post.prompt_date===day&&post.prompt_slot===slot)}
function activePosts(){const now=Date.now();return data.posts.filter(post=>new Date(post.expires_at).getTime()>now)}
function postDay(post:Post){return post.prompt_date||localDateKey(new Date(post.created_at))}
function familyStreak(){const days=new Set(data.posts.map(post=>postDay(post)));let count=0;const cursor=new Date();for(let i=0;i<45;i++){const key=localDateKey(cursor);if(days.has(key)){count++;cursor.setDate(cursor.getDate()-1);continue}if(i===0){cursor.setDate(cursor.getDate()-1);continue}break}return count}
function participationToday(){const today=localDateKey();return new Set(data.posts.filter(post=>postDay(post)===today).map(post=>post.member_id)).size}
function currentSlotLabel(){return slotNow()==='morning'?'MAÑANA':'TARDE'}

async function loadData(){
  const since=new Date(Date.now()-35*24*60*60*1000).toISOString()
  const lastYear=new Date();lastYear.setFullYear(lastYear.getFullYear()-1);lastYear.setHours(0,0,0,0)
  const memoryStart=new Date(lastYear);const memoryEnd=new Date(lastYear);memoryEnd.setDate(memoryEnd.getDate()+1)
  const [membersRes,profilesRes,postsRes,memRes]=await Promise.all([
    supabase.from('family_members').select('id,name').eq('active',true).order('created_at'),
    supabase.from('family_profiles').select('member_id,avatar_path'),
    supabase.from('social_posts').select('id,member_id,media_type,media_path,body,prompt_slot,prompt_date,expires_at,created_at').gte('created_at',since).order('created_at',{ascending:false}),
    supabase.from('social_posts').select('id,member_id,media_type,media_path,body,prompt_slot,prompt_date,expires_at,created_at').gte('created_at',memoryStart.toISOString()).lt('created_at',memoryEnd.toISOString()).order('created_at',{ascending:false}).limit(12)
  ])
  if(membersRes.error)throw membersRes.error
  if(profilesRes.error)throw profilesRes.error
  if(postsRes.error)throw postsRes.error
  const members=(membersRes.data||[]) as Member[]
  const profiles=new Map(((profilesRes.data||[]) as Profile[]).map(profile=>[profile.member_id,profile]))
  const posts=(postsRes.data||[]) as Post[]
  const active=posts.filter(post=>new Date(post.expires_at).getTime()>Date.now())
  const ids=active.map(post=>post.id)
  const [reactionRes,commentRes]=ids.length?await Promise.all([
    supabase.from('social_reactions').select('post_id,member_id,emoji').in('post_id',ids),
    supabase.from('social_comments').select('id,post_id,member_id,body,voice_path,created_at').in('post_id',ids).order('created_at')
  ]):[{data:[],error:null},{data:[],error:null}]
  if(reactionRes.error)throw reactionRes.error
  if(commentRes.error)throw commentRes.error
  const memories=((memRes.data||[]) as Post[])
  const mediaPaths=[...posts.map(p=>p.media_path),...memories.map(p=>p.media_path),...((commentRes.data||[]) as Comment[]).map(c=>c.voice_path),...Array.from(profiles.values()).map(p=>p.avatar_path)]
  await primeMedia(mediaPaths)
  data={members,profiles,posts,reactions:(reactionRes.data||[]) as Reaction[],comments:(commentRes.data||[]) as Comment[],memories}
}

function avatarMarkup(id:string,cls='pres-post-avatar'){
  const member=memberFor(id),url=avatarFor(id)
  return `<span class="${cls}">${url?`<img src="${esc(url)}" alt="${esc(member?.name||'Perfil')}">`:esc((member?.name||'?').charAt(0))}</span>`
}
function mediaMarkup(post:Post,context:'feed'|'memory'='feed'){
  const url=mediaUrl(post.media_path)
  if(post.media_type==='image'&&url)return `<img src="${esc(url)}" alt="Momento de ${esc(memberFor(post.member_id)?.name||'familia')}" loading="lazy" decoding="async">`
  if(post.media_type==='video'&&url)return `<video src="${esc(url)}" playsinline controls preload="metadata"></video>`
  if(post.media_type==='audio'&&url)return `<audio class="pres-post-audio" src="${esc(url)}" controls preload="metadata"></audio>`
  if(post.media_type==='text')return `<div class="pres-post-text">${esc(post.body||'♡')}</div>`
  return context==='memory'?'<span>♡</span>':'<div class="pres-post-text">Momento privado</div>'
}
function reactionsFor(postId:string){return data.reactions.filter(r=>r.post_id===postId)}
function commentsFor(postId:string){return data.comments.filter(c=>c.post_id===postId)}
function reactionSummary(postId:string){
  const counts=new Map<string,number>();for(const r of reactionsFor(postId))counts.set(r.emoji,(counts.get(r.emoji)||0)+1)
  return [...counts.entries()].map(([emoji,count])=>`<span>${emoji} ${count}</span>`).join('')
}
function commentMarkup(comment:Comment){
  const member=memberFor(comment.member_id),voice=mediaUrl(comment.voice_path)
  return `<div class="pres-comment">${avatarMarkup(comment.member_id,'pres-comment-avatar')}<div class="pres-comment-body"><b>${esc(member?.name||'Familia')}</b>${comment.body?`<p>${esc(comment.body)}</p>`:''}${voice?`<audio src="${esc(voice)}" controls preload="metadata"></audio>`:''}</div></div>`
}
function postMarkup(post:Post){
  const me=identity()?.memberId,member=memberFor(post.member_id),mine=me===post.member_id
  const myReaction=reactionsFor(post.id).find(r=>r.member_id===me)?.emoji
  const comments=commentsFor(post.id)
  return `<article class="pres-post" data-post="${esc(post.id)}"><div class="pres-post-head">${avatarMarkup(post.member_id)}<div class="pres-post-who"><b>${esc(member?.name||'Familia')}${mine?' · tú':''}</b><span>${age(post.created_at)}</span></div>${post.prompt_slot?`<span class="pres-post-slot">${post.prompt_slot==='morning'?'mañana':'tarde'}</span>`:''}</div><div class="pres-post-media" data-react-target="${esc(post.id)}">${mediaMarkup(post)}</div>${post.body&&post.media_type!=='text'?`<div class="pres-caption">${esc(post.body)}</div>`:''}<div class="pres-actions"><button class="pres-action ${myReaction?'mine':''}" data-reactions="${esc(post.id)}">${myReaction||'♡'} Reaccionar</button><button class="pres-action" data-comments="${esc(post.id)}">💬 ${comments.length||'Comentar'}</button></div>${reactionSummary(post.id)?`<div class="pres-reaction-summary">${reactionSummary(post.id)}</div>`:''}<div class="pres-reaction-bar" data-reaction-bar="${esc(post.id)}" hidden>${REACTIONS.map(e=>`<button data-react="${esc(post.id)}" data-emoji="${e}">${e}</button>`).join('')}</div><div class="pres-comments" data-comments-panel="${esc(post.id)}" hidden>${comments.map(commentMarkup).join('')}<form class="pres-comment-form" data-comment-form="${esc(post.id)}"><input maxlength="500" placeholder="Responder a la familia…"><button type="button" data-voice-comment="${esc(post.id)}" aria-label="Responder con voz">🎙</button><button type="submit" aria-label="Enviar">➤</button></form></div></article>`
}
function storiesMarkup(){
  const active=activePosts(),latest=new Map<string,Post>()
  active.forEach(post=>{if(!latest.has(post.member_id))latest.set(post.member_id,post)})
  const me=identity()?.memberId
  const ordered=[...data.members].sort((a,b)=>a.id===me?-1:b.id===me?1:0)
  return ordered.map(member=>`<button class="pres-story ${latest.has(member.id)?'has-story':''}" data-story-member="${esc(member.id)}"><span class="pres-story-ring"><span class="pres-story-ring-inner">${avatarMarkup(member.id,'pres-story-avatar')}</span></span><small>${esc(member.id===me?'Tú':member.name)}</small></button>`).join('')
}
function memoriesMarkup(){return data.memories.map(post=>`<div class="pres-memory"><div class="pres-memory-media">${mediaMarkup(post,'memory')}</div><div class="pres-memory-copy"><b>Hace 1 año · ${esc(memberFor(post.member_id)?.name||'Familia')}</b><span>${esc(post.body||'Un momento de FAMILIA NOA.')}</span></div></div>`).join('')}

function render(){
  if(!overlay)return
  const pending=currentPending(),participants=participationToday(),streak=familyStreak(),active=activePosts()
  overlay.innerHTML=`<div class="presume-inner"><header class="presume-head"><button class="presume-back" aria-label="Volver">‹</button><div class="presume-brand"><b>PRESUME</b><span>FAMILIA NOA</span></div><div class="presume-head-spacer"></div></header><section class="pres-stories">${storiesMarkup()}</section><section class="pres-challenge"><p class="eyebrow">${currentSlotLabel()} · FOTO DEL MOMENTO</p><h2>${esc(promptText())}</h2><p>${pending?'Sin preparar demasiado. La familia quiere ver tu momento real.':'Ya cumpliste este momento. Puedes seguir compartiendo cuando quieras.'}</p><div class="pres-challenge-meta"><span class="pres-chip">${participants} de ${data.members.length} pasaron por aquí hoy ♡</span>${streak?`<span class="pres-chip">${streak} día${streak===1?'':'s'} compartiendo</span>`:''}</div><button class="pres-main ${pending?'':'done'}" data-camera>${pending?'PRESUME AHORA 📸':'OTRA FOTO 📸'}</button><button class="pres-reminder" data-reminders>${localStorage.getItem(REMINDER_KEY)==='1'?'Recordatorios activados':'Activar recordatorios suaves'}</button></section><div class="pres-compose"><button data-camera><i>📷</i>Foto</button><button data-video><i>🎥</i>Video</button><button data-text><i>✎</i>Texto</button><button data-voice><i>🎙</i>Voz</button></div>${data.memories.length?`<div class="pres-section-head"><h3>Recuerdos</h3><span>Hace 1 año</span></div><section class="pres-memory-strip">${memoriesMarkup()}</section>`:''}<div class="pres-section-head"><h3>Hoy en familia</h3><span>24 horas</span></div><section class="pres-feed">${active.length?active.map(postMarkup).join(''):'<div class="pres-empty">Todavía está tranquilo por aquí.<br>La primera foto cambia todo 📸</div>'}</section><input type="file" accept="image/*" capture="environment" data-camera-input hidden><input type="file" accept="video/*" capture="environment" data-video-input hidden></div>`
  bind()
}

async function open(push=true){
  if(overlay)return
  if(push)pushView('presume')
  overlay=document.createElement('main');overlay.className='presume-screen';document.body.appendChild(overlay)
  overlay.innerHTML='<div class="presume-inner"><div class="pres-empty" style="margin-top:30vh">Preparando PRESUME…</div></div>'
  try{await loadData();render();startRealtime();if(currentPending())navigator.vibrate?.([80,50,80]);scheduleReminder()}
  catch(error){console.error('PRESUME load failed',error);if(overlay)overlay.innerHTML='<div class="presume-inner"><div class="pres-empty" style="margin-top:30vh">No pudimos abrir PRESUME. Inténtalo otra vez.</div></div>'}
}
function close(){storyOverlay?.remove();storyOverlay=null;overlay?.remove();overlay=null;channel?.unsubscribe();channel=null;if(reloadTimer){clearTimeout(reloadTimer);reloadTimer=null}}
function back(){if(rawView()==='presume')history.back();else close()}
function refreshSoon(){if(!overlay)return;if(reloadTimer)clearTimeout(reloadTimer);reloadTimer=window.setTimeout(async()=>{reloadTimer=null;try{await loadData();render()}catch(error){console.error('PRESUME realtime refresh failed',error)}},180)}
function startRealtime(){
  channel?.unsubscribe();channel=supabase.channel('familia-presume-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'social_posts'},refreshSoon)
    .on('postgres_changes',{event:'*',schema:'public',table:'social_reactions'},refreshSoon)
    .on('postgres_changes',{event:'*',schema:'public',table:'social_comments'},refreshSoon)
    .subscribe()
}

function showPublishSheet(file:File,type:'image'|'video'){
  if(!overlay)return
  const url=URL.createObjectURL(file),modal=document.createElement('div');modal.className='pres-modal'
  modal.innerHTML=`<div class="pres-sheet"><div class="pres-sheet-head"><b>Tu momento</b><button class="pres-sheet-close">×</button></div><div class="pres-preview">${type==='image'?`<img src="${url}" alt="Vista previa">`:`<video src="${url}" controls playsinline></video>`}</div><textarea maxlength="500" placeholder="Di algo… o déjalo así."></textarea><button class="pres-publish">Compartir con la familia</button></div>`
  document.body.appendChild(modal)
  const cleanup=()=>{URL.revokeObjectURL(url);modal.remove()};modal.querySelector('.pres-sheet-close')!.addEventListener('click',cleanup)
  modal.querySelector<HTMLButtonElement>('.pres-publish')!.addEventListener('click',async()=>{
    const button=modal.querySelector<HTMLButtonElement>('.pres-publish')!,body=modal.querySelector<HTMLTextAreaElement>('textarea')!.value.trim();button.disabled=true;button.textContent='Compartiendo…'
    try{await publishMedia(file,type,body);cleanup();await loadData();render()}
    catch(error){console.error('PRESUME publish failed',error);button.disabled=false;button.textContent=error instanceof Error?error.message:'No se pudo compartir'}
  })
}
async function publishMedia(file:File,type:'image'|'video',body:string){
  const me=identity()?.memberId;if(!me)throw new Error('Sesión no disponible')
  let blob:Blob,contentType:string,ext:string
  if(type==='image'){
    const prepared=await optimizePhoto(file,1600,.82);blob=prepared.blob;contentType=prepared.type;ext=prepared.ext
  }else{
    if(file.size>CHAT_VIDEO_MAX_BYTES)throw new Error(`Máximo ${mediaLimitMb(CHAT_VIDEO_MAX_BYTES)} MB`)
    const prepared=prepareVideo(file);blob=prepared.blob;contentType=prepared.type;ext=prepared.ext
  }
  const token=crypto.randomUUID(),path=`social/${me}/posts/${token}.${ext}`
  await uploadPrivateMedia(path,blob,{contentType,cacheControl:'31536000'})
  const payload={member_id:me,media_type:type,media_path:path,body:body.slice(0,500),prompt_slot:slotNow(),prompt_date:localDateKey(),expires_at:new Date(Date.now()+24*60*60*1000).toISOString()}
  const {error}=await supabase.from('social_posts').insert(payload)
  if(error){await supabase.storage.from(BUCKET).remove([path]);forgetMedia(path);throw error}
  await signMedia(path)
}
function showTextSheet(){
  const modal=document.createElement('div');modal.className='pres-modal';modal.innerHTML='<div class="pres-sheet"><div class="pres-sheet-head"><b>Di algo ahora</b><button class="pres-sheet-close">×</button></div><textarea maxlength="500" style="min-height:180px" placeholder="¿Qué estás pensando? ¿Dónde estás? ¿Qué te hizo reír?"></textarea><button class="pres-publish">Compartir</button></div>';document.body.appendChild(modal)
  modal.querySelector('.pres-sheet-close')!.addEventListener('click',()=>modal.remove())
  modal.querySelector<HTMLButtonElement>('.pres-publish')!.addEventListener('click',async()=>{const button=modal.querySelector<HTMLButtonElement>('.pres-publish')!,body=modal.querySelector<HTMLTextAreaElement>('textarea')!.value.trim();if(!body)return;button.disabled=true;button.textContent='Compartiendo…';try{const me=identity()?.memberId;if(!me)throw new Error('Sesión no disponible');const {error}=await supabase.from('social_posts').insert({member_id:me,media_type:'text',body:body.slice(0,500),prompt_slot:slotNow(),prompt_date:localDateKey(),expires_at:new Date(Date.now()+24*60*60*1000).toISOString()});if(error)throw error;modal.remove();await loadData();render()}catch(error){button.disabled=false;button.textContent='No se pudo compartir'}})
}

async function startVoicePost(){
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){alert('La grabación de voz no está disponible en este dispositivo.');return}
  const modal=document.createElement('div');modal.className='pres-modal';modal.innerHTML='<div class="pres-sheet"><div class="pres-sheet-head"><b>Nota de voz</b><button class="pres-sheet-close">×</button></div><div class="pres-record recording"><div class="pres-record-pulse">🎙</div><p>Grabando… toca “Terminar” cuando estés listo.</p><button class="pres-publish">Terminar y compartir</button></div></div>';document.body.appendChild(modal)
  let stream:MediaStream|null=null,recorder:MediaRecorder|null=null,chunks:BlobPart[]=[]
  const stopAll=()=>stream?.getTracks().forEach(track=>track.stop())
  const close=()=>{if(recorder?.state==='recording')recorder.stop();stopAll();modal.remove()};modal.querySelector('.pres-sheet-close')!.addEventListener('click',close)
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true});recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.start()
    modal.querySelector<HTMLButtonElement>('.pres-publish')!.addEventListener('click',()=>{if(recorder?.state==='recording')recorder.stop()})
    recorder.onstop=async()=>{stopAll();const blob=new Blob(chunks,{type:recorder?.mimeType||'audio/webm'});if(blob.size>CHAT_AUDIO_MAX_BYTES){modal.querySelector('.pres-record p')!.textContent=`La nota supera ${mediaLimitMb(CHAT_AUDIO_MAX_BYTES)} MB.`;return}const button=modal.querySelector<HTMLButtonElement>('.pres-publish')!;button.disabled=true;button.textContent='Compartiendo…';try{await publishAudioPost(blob);modal.remove();await loadData();render()}catch(error){console.error(error);button.disabled=false;button.textContent='No se pudo compartir'}}
  }catch(error){console.error('Voice permission failed',error);stopAll();modal.querySelector('.pres-record p')!.textContent='No se pudo acceder al micrófono.'}
}
async function publishAudioPost(blob:Blob){const me=identity()?.memberId;if(!me)throw new Error('Sesión no disponible');const file=new File([blob],'presume-voz',{type:blob.type||'audio/webm'}),prepared=prepareAudio(file),path=`social/${me}/posts/${crypto.randomUUID()}.${prepared.ext}`;await uploadPrivateMedia(path,prepared.blob,{contentType:prepared.type,cacheControl:'31536000'});const {error}=await supabase.from('social_posts').insert({member_id:me,media_type:'audio',media_path:path,body:'',prompt_slot:slotNow(),prompt_date:localDateKey(),expires_at:new Date(Date.now()+24*60*60*1000).toISOString()});if(error){await supabase.storage.from(BUCKET).remove([path]);forgetMedia(path);throw error};await signMedia(path)}

async function setReaction(postId:string,emoji:string){const me=identity()?.memberId;if(!me)return;const existing=data.reactions.find(r=>r.post_id===postId&&r.member_id===me);if(existing?.emoji===emoji){const {error}=await supabase.from('social_reactions').delete().eq('post_id',postId).eq('member_id',me);if(error)throw error}else{const {error}=await supabase.from('social_reactions').upsert({post_id:postId,member_id:me,emoji},{onConflict:'post_id,member_id'});if(error)throw error}await loadData();render()}
function heartBurst(target:Element){const burst=document.createElement('div');burst.className='pres-heart-pop';burst.textContent='❤️';target.appendChild(burst);setTimeout(()=>burst.remove(),650)}
async function sendComment(postId:string,body:string){const me=identity()?.memberId;if(!me||!body.trim())return;const {error}=await supabase.from('social_comments').insert({post_id:postId,member_id:me,body:body.trim().slice(0,500)});if(error)throw error;await loadData();render();setTimeout(()=>{const panel=overlay?.querySelector<HTMLElement>(`[data-comments-panel="${CSS.escape(postId)}"]`);if(panel)panel.hidden=false},0)}
async function voiceComment(postId:string,button:HTMLButtonElement){
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return
  if(button.dataset.recording==='1'){button.dispatchEvent(new CustomEvent('stoprecord'));return}
  let stream:MediaStream|null=null
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true});const chunks:BlobPart[]=[],recorder=new MediaRecorder(stream);button.dataset.recording='1';button.textContent='■';button.addEventListener('stoprecord',()=>{if(recorder.state==='recording')recorder.stop()},{once:true});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=async()=>{stream?.getTracks().forEach(track=>track.stop());button.dataset.recording='';button.textContent='🎙';const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});try{const me=identity()?.memberId;if(!me)return;const file=new File([blob],'respuesta',{type:blob.type||'audio/webm'}),prepared=prepareAudio(file);if(prepared.blob.size>CHAT_AUDIO_MAX_BYTES)throw new Error('Audio demasiado largo');const path=`social/${me}/comments/${crypto.randomUUID()}.${prepared.ext}`;await uploadPrivateMedia(path,prepared.blob,{contentType:prepared.type,cacheControl:'31536000'});const {error}=await supabase.from('social_comments').insert({post_id:postId,member_id:me,voice_path:path,body:''});if(error){await supabase.storage.from(BUCKET).remove([path]);forgetMedia(path);throw error};await signMedia(path);await loadData();render();setTimeout(()=>{const panel=overlay?.querySelector<HTMLElement>(`[data-comments-panel="${CSS.escape(postId)}"]`);if(panel)panel.hidden=false},0)}catch(error){console.error('Voice comment failed',error)}};recorder.start()}
  catch(error){stream?.getTracks().forEach(track=>track.stop());console.error('Voice comment permission failed',error)}
}

function openStory(memberId:string,push=true){
  const posts=activePosts().filter(post=>post.member_id===memberId).sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());if(!posts.length)return
  if(push)pushView('presume-story');let index=0
  const root=document.createElement('div');root.className='pres-story-view';storyOverlay=root;document.body.appendChild(root)
  const draw=()=>{const post=posts[index],member=memberFor(memberId);root.innerHTML=`<div><div class="pres-story-progress">${posts.map((_,i)=>`<i class="${i<=index?'active':''}"></i>`).join('')}</div><div class="pres-story-top">${avatarMarkup(memberId)}<b>${esc(member?.name||'Familia')} · ${age(post.created_at)}</b><button class="pres-story-close">×</button></div></div><div class="pres-story-stage">${mediaMarkup(post)}<div class="pres-story-nav"><button data-story-prev aria-label="Anterior"></button><button data-story-next aria-label="Siguiente"></button></div></div><div class="pres-story-caption">${post.body&&post.media_type!=='text'?esc(post.body):'♡'}</div>`;root.querySelector('.pres-story-close')!.addEventListener('click',()=>history.back());root.querySelector('[data-story-prev]')!.addEventListener('click',()=>{if(index>0){index--;draw()}else history.back()});root.querySelector('[data-story-next]')!.addEventListener('click',()=>{if(index<posts.length-1){index++;draw()}else history.back()})};draw()
}
function closeStory(){storyOverlay?.querySelectorAll<HTMLMediaElement>('video,audio').forEach(media=>media.pause());storyOverlay?.remove();storyOverlay=null}

function bind(){
  if(!overlay)return
  overlay.querySelector('.presume-back')?.addEventListener('click',back)
  const cameraInput=overlay.querySelector<HTMLInputElement>('[data-camera-input]')!,videoInput=overlay.querySelector<HTMLInputElement>('[data-video-input]')!
  overlay.querySelectorAll('[data-camera]').forEach(button=>button.addEventListener('click',()=>cameraInput.click()))
  overlay.querySelector('[data-video]')?.addEventListener('click',()=>videoInput.click())
  overlay.querySelector('[data-text]')?.addEventListener('click',showTextSheet)
  overlay.querySelector('[data-voice]')?.addEventListener('click',()=>void startVoicePost())
  overlay.querySelector('[data-reminders]')?.addEventListener('click',()=>void enableReminders())
  cameraInput.addEventListener('change',()=>{const file=cameraInput.files?.[0];cameraInput.value='';if(file)showPublishSheet(file,'image')})
  videoInput.addEventListener('change',()=>{const file=videoInput.files?.[0];videoInput.value='';if(file)showPublishSheet(file,'video')})
  overlay.querySelectorAll<HTMLElement>('[data-story-member]').forEach(button=>button.addEventListener('click',()=>openStory(button.dataset.storyMember||'')))
  overlay.querySelectorAll<HTMLElement>('[data-reactions]').forEach(button=>button.addEventListener('click',()=>{const bar=overlay?.querySelector<HTMLElement>(`[data-reaction-bar="${CSS.escape(button.dataset.reactions||'')}"]`);if(bar)bar.hidden=!bar.hidden}))
  overlay.querySelectorAll<HTMLButtonElement>('[data-react]').forEach(button=>button.addEventListener('click',()=>void setReaction(button.dataset.react||'',button.dataset.emoji||'❤️').catch(error=>console.error(error))))
  overlay.querySelectorAll<HTMLElement>('[data-comments]').forEach(button=>button.addEventListener('click',()=>{const panel=overlay?.querySelector<HTMLElement>(`[data-comments-panel="${CSS.escape(button.dataset.comments||'')}"]`);if(panel)panel.hidden=!panel.hidden}))
  overlay.querySelectorAll<HTMLFormElement>('[data-comment-form]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();const input=form.querySelector<HTMLInputElement>('input')!;const body=input.value;input.value='';void sendComment(form.dataset.commentForm||'',body).catch(error=>console.error(error))}))
  overlay.querySelectorAll<HTMLButtonElement>('[data-voice-comment]').forEach(button=>button.addEventListener('click',()=>void voiceComment(button.dataset.voiceComment||'',button)))
  overlay.querySelectorAll<HTMLElement>('[data-react-target]').forEach(target=>{
    let lastTap=0,press:number|null=null
    target.addEventListener('pointerdown',()=>{press=window.setTimeout(()=>{const bar=overlay?.querySelector<HTMLElement>(`[data-reaction-bar="${CSS.escape(target.dataset.reactTarget||'')}"]`);if(bar)bar.hidden=false},520)})
    const clear=()=>{if(press){clearTimeout(press);press=null}};target.addEventListener('pointerup',clear);target.addEventListener('pointercancel',clear);target.addEventListener('pointerleave',clear)
    target.addEventListener('click',event=>{if((event.target as Element).closest('video,audio,button'))return;const now=Date.now();if(now-lastTap<330){heartBurst(target);void setReaction(target.dataset.reactTarget||'','❤️').catch(console.error);lastTap=0}else lastTap=now})
  })
  overlay.querySelectorAll<HTMLMediaElement>('video,audio').forEach(media=>media.addEventListener('play',()=>overlay?.querySelectorAll<HTMLMediaElement>('video,audio').forEach(other=>{if(other!==media&&!other.paused)other.pause()})))
}

async function enableReminders(){
  if(!('Notification'in window)){return}
  const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission()
  if(permission==='granted'){localStorage.setItem(REMINDER_KEY,'1');scheduleReminder();render()}
}
function clearReminderTimers(){if(reminderTimer){clearTimeout(reminderTimer);reminderTimer=null}reminderFollowups.forEach(id=>clearTimeout(id));reminderFollowups=[]}
function scheduleReminder(){
  clearReminderTimers();if(localStorage.getItem(REMINDER_KEY)!=='1'||!('Notification'in window)||Notification.permission!=='granted')return
  const now=new Date(),targets=[new Date(now),new Date(now)];targets[0].setHours(9,0,0,0);targets[1].setHours(17,0,0,0);let next=targets.find(target=>target.getTime()>now.getTime());if(!next){next=new Date(now);next.setDate(next.getDate()+1);next.setHours(9,0,0,0)}
  reminderTimer=window.setTimeout(()=>void fireReminder(0),Math.min(next.getTime()-now.getTime(),2147483000))
}
async function fireReminder(attempt:number){
  try{await loadData();if(!currentPending()){scheduleReminder();return}const registration=await navigator.serviceWorker?.ready;await registration?.showNotification('PRESUME 📸',{body:promptText(),tag:`presume-${localDateKey()}-${slotNow()}`,renotify:true});navigator.vibrate?.([180,80,180]);if(attempt<2){const id=window.setTimeout(()=>void fireReminder(attempt+1),20*60*1000);reminderFollowups.push(id)}else scheduleReminder()}catch(error){console.error('PRESUME reminder failed',error);scheduleReminder()}
}

function hydrateHome(){
  const button=document.querySelector<HTMLButtonElement>('#ok');if(!button)return
  button.classList.add('presumecard');const title=button.querySelector('b'),small=button.querySelector('small'),icon=button.querySelector('i');if(title)title.textContent='Presume';if(small)small.textContent='Foto del momento';if(icon)icon.textContent='◉'
  if(currentPending()&&!button.querySelector('.presume-home-dot'))button.insertAdjacentHTML('beforeend','<span class="presume-home-dot" aria-hidden="true"></span>')
}

inject()
document.addEventListener('click',event=>{const target=event.target as Element|null;if(!target?.closest('#ok'))return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void open(true)},true)
window.addEventListener('popstate',()=>{const view=rawView();if(view==='presume-story'){if(!storyOverlay&&overlay){const first=activePosts()[0];if(first)openStory(first.member_id,false)}return}closeStory();if(view==='presume'){if(!overlay)void open(false);return}close()})
const observer=new MutationObserver(()=>hydrateHome());observer.observe(document.body,{childList:true,subtree:true});hydrateHome();scheduleReminder()
