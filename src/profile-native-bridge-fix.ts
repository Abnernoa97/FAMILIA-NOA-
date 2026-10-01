const PROFILE_SELECTOR='#profile-entry'
const LEGACY_SELECTOR='#change'

const originalDocumentQuerySelector=Document.prototype.querySelector
const originalClosest=Element.prototype.closest
let allowLegacyProfileAlias=false

function rawQuery(selector:string){
  return originalDocumentQuerySelector.call(document,selector) as Element|null
}

function migrateProfileEntry(){
  const legacy=rawQuery(LEGACY_SELECTOR) as HTMLElement|null
  if(!legacy||!legacy.classList.contains('avatar'))return
  legacy.id='profile-entry'
  legacy.setAttribute('data-profile-entry','1')
}

Document.prototype.querySelector=function(selector:string){
  if(selector===LEGACY_SELECTOR){
    const profile=originalDocumentQuerySelector.call(this,PROFILE_SELECTOR)
    if(profile)return profile
  }
  return originalDocumentQuerySelector.call(this,selector)
} as typeof Document.prototype.querySelector

Element.prototype.closest=function(selector:string){
  if(selector===LEGACY_SELECTOR&&allowLegacyProfileAlias){
    const profile=originalClosest.call(this,PROFILE_SELECTOR)
    if(profile)return profile
  }
  return originalClosest.call(this,selector)
} as typeof Element.prototype.closest

// The installed Android shell still has a legacy capture listener for #change
// that opens ProtectionActivity. Keep the real profile entry under a new id.
// After that native listener has had its chance to ignore the click, expose a
// short-lived alias so the current web profile enhancer receives the same click.
document.addEventListener('click',event=>{
  const target=event.target as Element|null
  if(!target||!originalClosest.call(target,PROFILE_SELECTOR))return
  allowLegacyProfileAlias=true
  queueMicrotask(()=>{allowLegacyProfileAlias=false})
},true)

const observer=new MutationObserver(()=>migrateProfileEntry())
observer.observe(document.body,{childList:true,subtree:true})
migrateProfileEntry()

document.documentElement.setAttribute('data-profile-entry-build','20261001-native-conflict-fixed')
window.addEventListener('beforeunload',()=>observer.disconnect(),{once:true})
