// FAMILIA NOA — profile visual / duplicate-open guard
// Keeps the profile editor to a single drawer and prevents rapid taps
// from opening multiple async copies of the same profile editor.

const STYLE_ID = 'familia-profile-visual-fix'
let opening = false

function injectStyles(){
  if(document.getElementById(STYLE_ID)) return
  const style=document.createElement('style')
  style.id=STYLE_ID
  style.textContent=`
    .profile-menu{overflow:hidden!important;z-index:1000!important}
    .profile-menu .profile-drawer{position:relative;display:flex;flex-direction:column;gap:0;width:min(92vw,430px);height:100%;padding:24px 22px calc(24px + env(safe-area-inset-bottom));overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch}
    .profile-menu .profile-close{position:absolute;right:18px;top:14px;z-index:5;width:42px;height:42px;float:none;margin:0;border-radius:50%;background:rgba(0,0,0,.08);display:grid;place-items:center;line-height:1}
    .profile-menu .profile-head{flex:0 0 auto;clear:none;text-align:center;padding:18px 0 20px}
    .profile-menu .profile-field{flex:0 0 auto;margin:16px 0}
    .profile-menu .profile-cover-editor{order:0;margin:0 0 16px}
    .profile-menu .profile-cover-label{margin:0 0 8px}
    .profile-menu .profile-cover-preview{height:150px;min-height:150px;border-radius:22px;background-position:center;background-size:cover;overflow:hidden}
    .profile-menu .profile-field label{margin-bottom:8px}
    .profile-menu .profile-actions{flex:0 0 auto;margin:2px 0 8px}
    .profile-menu .profiles-section{flex:0 0 auto;margin-top:14px;padding-top:18px}
    .profile-menu .profile-list-item{min-height:68px}
    .profile-menu .profile-list-item img,.profile-menu .profile-list-item .profile-avatar{flex:0 0 48px}
    .profile-menu .profile-list-item div:last-child{min-width:0}
  `
  document.head.appendChild(style)
}

function cleanDuplicateMenus(){
  const menus=Array.from(document.querySelectorAll('.profile-menu'))
  if(menus.length<=1) return
  // Keep the newest editor and remove stale copies created by rapid taps.
  menus.slice(0,-1).forEach(m=>m.remove())
}

function bind(){
  injectStyles()
  cleanDuplicateMenus()
  const avatar=document.querySelector<HTMLElement>('#change')
  if(!avatar||avatar.getAttribute('data-profile-visual-guard')) return
  avatar.setAttribute('data-profile-visual-guard','1')
  avatar.addEventListener('click',(event)=>{
    const existing=document.querySelector('.profile-menu')
    if(opening||existing){
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    opening=true
    // The profile enhancer opens asynchronously; release the guard as soon as
    // its drawer exists, or after a short safety window if something failed.
    setTimeout(()=>{ if(!document.querySelector('.profile-menu')) opening=false },5000)
  },true)
}

const observer=new MutationObserver(()=>{
  bind()
  if(document.querySelector('.profile-menu')) opening=false
})
observer.observe(document.body,{childList:true,subtree:true})
bind()
