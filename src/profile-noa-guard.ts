// The floating NOA launcher is the current experience.
// This marker prevents the deprecated hidden profile card from mounting
// and avoids an unnecessary family-assistant request every time Perfil opens.

function guard(menu:HTMLElement){
  if(menu.querySelector('[data-noa-card]'))return
  const marker=document.createElement('span')
  marker.hidden=true
  marker.dataset.noaCard='disabled'
  marker.dataset.noaProfileCardGuard='1'
  menu.appendChild(marker)
}

const observer=new MutationObserver(mutations=>{
  for(const mutation of mutations){
    for(const node of Array.from(mutation.addedNodes)){
      if(!(node instanceof Element))continue
      const menu=node.matches('.profile-menu')?node as HTMLElement:node.querySelector<HTMLElement>('.profile-menu')
      if(menu){guard(menu);return}
    }
  }
})
observer.observe(document.body,{childList:true,subtree:true})

document.querySelectorAll<HTMLElement>('.profile-menu').forEach(guard)
