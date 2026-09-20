export function bindChatViewport(page:HTMLElement,list:HTMLElement,input:HTMLInputElement,isSticky:()=>boolean,scrollLatest:()=>void){
 const update=()=>{if(!page.isConnected)return;const v=window.visualViewport,height=Math.max(1,Math.round(v?.height||window.innerHeight)),top=Math.max(0,Math.round(v?.offsetTop||0));page.style.setProperty('--chat-vh',`${height}px`);page.style.setProperty('--chat-vtop',`${top}px`);if(isSticky()||document.activeElement===input)requestAnimationFrame(scrollLatest)}
 const focus=()=>requestAnimationFrame(scrollLatest),v=window.visualViewport
 v?.addEventListener('resize',update);v?.addEventListener('scroll',update);window.addEventListener('resize',update);window.addEventListener('orientationchange',update);input.addEventListener('focus',focus);update()
 return()=>{v?.removeEventListener('resize',update);v?.removeEventListener('scroll',update);window.removeEventListener('resize',update);window.removeEventListener('orientationchange',update);input.removeEventListener('focus',focus)}
}
