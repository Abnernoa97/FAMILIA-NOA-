import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://ldtfzvvmjsarkxrchrqx.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_r3apEbRySSbhOSyx9URW7A_8aQDV5dN'

const isAdmin = typeof window !== 'undefined' && window.location.pathname.includes('/admin/')
const FAMILY_AUTH_KEY='familia-noa-family-auth'

if(typeof window!=='undefined'&&!isAdmin){
  try{
    const legacy=sessionStorage.getItem(FAMILY_AUTH_KEY)
    if(legacy&&!localStorage.getItem(FAMILY_AUTH_KEY))localStorage.setItem(FAMILY_AUTH_KEY,legacy)
    sessionStorage.removeItem(FAMILY_AUTH_KEY)
  }catch{}
}

const browserStorage = typeof window !== 'undefined' ? window.localStorage : undefined

const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: isAdmin ? 'familia-noa-admin-auth' : FAMILY_AUTH_KEY,
    storage: browserStorage,
    persistSession:true,
    autoRefreshToken:true,
    detectSessionInUrl:false,
  },
})

// Supabase exposes `functions` through a getter that can create a new FunctionsClient
// on each access. NOA decorates that client to add family conversation context, so we
// intentionally keep one shared instance for the lifetime of this app session.
const sharedFunctions = client.functions
try{
  Object.defineProperty(client,'functions',{
    configurable:true,
    enumerable:true,
    get:()=>sharedFunctions,
  })
}catch{}

export const supabase = client

/**
 * Android's long-lived service and the embedded Supabase WebView share one
 * family identity. Supabase rotates refresh tokens; two independent refresh
 * attempts with the same token invalidate the older session. Relay the newest
 * valid web session to the native service, and adopt a NEWER native session
 * when returning from the background. Do not touch the independent admin auth.
 */
if(typeof window!=='undefined'&&!isAdmin){
  type FamilyNativeAuthBridge={
    syncSessionFromWeb?:(payload:string)=>boolean
  }
  type SessionPayload={
    memberId:string
    accessToken:string
    refreshToken:string
    expiresAt:number
  }
  const bridge=()=>(
    window as Window&{FamiliaNoaNative?:FamilyNativeAuthBridge}
  ).FamiliaNoaNative

  const pushToNative=(session:import('@supabase/supabase-js').Session|null)=>{
    if(!session?.access_token||!session.refresh_token)return
    const id=String(session.user?.app_metadata?.member_id||'')
    if(session.user?.app_metadata?.family_member!==true||!id)return
    try{
      bridge()?.syncSessionFromWeb?.(JSON.stringify({
        memberId:id,
        accessToken:session.access_token,
        refreshToken:session.refresh_token,
        expiresAt:session.expires_at||0,
      } satisfies SessionPayload))
    }catch(error){console.warn('Native family session sync unavailable',error)}
  }

  client.auth.onAuthStateChange((event,session)=>{
    if(event==='INITIAL_SESSION'||event==='SIGNED_IN'||event==='TOKEN_REFRESHED'){
      pushToNative(session)
    }
  })

  // The native service may refresh credentials while Android suspends the web
  // page. Accept only a STRICTLY NEWER session for the SAME family member.
  let adoptingNative=false
  window.addEventListener('familia-noa:native-auth-update',event=>{
    const next=(event as CustomEvent<SessionPayload>).detail
    if(!next||adoptingNative||typeof next.memberId!=='string'||!next.accessToken||!next.refreshToken)return
    adoptingNative=true
    void (async()=>{
      try{
        const {data:{session}}=await client.auth.getSession()
        const memberId=String(session?.user?.app_metadata?.member_id||'')
        if(!session||memberId!==next.memberId)return
        if(!Number.isFinite(next.expiresAt)||next.expiresAt<=(session.expires_at||0)+15)return
        const {error}=await client.auth.setSession({
          access_token:next.accessToken,refresh_token:next.refreshToken,
        })
        if(error)console.warn('Could not adopt newer Android family session',error)
      }catch(error){console.warn('Android family session restore unavailable',error)}
      finally{adoptingNative=false}
    })()
  })
}
