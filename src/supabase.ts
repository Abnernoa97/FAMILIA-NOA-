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

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: isAdmin ? 'familia-noa-admin-auth' : FAMILY_AUTH_KEY,
    storage: browserStorage,
    persistSession:true,
    autoRefreshToken:true,
    detectSessionInUrl:false,
  },
})
