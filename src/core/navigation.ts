export type AppView='home'|'chat'|'photos'|'album'|'media'|'profile'|'profile-detail'|'location'
const KEY='familiaNoaView'
export function currentView():AppView{return (history.state?.[KEY]||'home') as AppView}
export function enterView(view:AppView){
  if(currentView()===view)return
  history.pushState({...(history.state||{}),[KEY]:view},'',location.href)
}
export function replaceView(view:AppView){history.replaceState({...(history.state||{}),[KEY]:view},'',location.href)}
export function backView(){history.back()}
export function initNavigation(onView:(view:AppView)=>void){
  if(!history.state?.[KEY])replaceView('home')
  const handler=()=>onView(currentView())
  window.addEventListener('popstate',handler)
  return()=>window.removeEventListener('popstate',handler)
}
