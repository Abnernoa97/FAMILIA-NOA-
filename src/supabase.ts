import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://ldtfzvvmjsarkxrchrqx.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_r3apEbRySSbhOSyx9URW7A_8aQDV5dN'

const isAdmin = typeof window !== 'undefined' && window.location.pathname.includes('/admin/')
const browserStorage = typeof window !== 'undefined'
  ? (isAdmin ? window.localStorage : window.sessionStorage)
  : undefined

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: isAdmin ? 'familia-noa-admin-auth' : 'familia-noa-family-auth',
    storage: browserStorage,
    persistSession:true,
    autoRefreshToken:true,
    detectSessionInUrl:false,
  },
})
