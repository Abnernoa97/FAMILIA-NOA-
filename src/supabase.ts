import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://ldtfzvvmjsarkxrchrqx.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_r3apEbRySSbhOSyx9URW7A_8aQDV5dN'
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
