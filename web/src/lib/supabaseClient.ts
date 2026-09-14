import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[DermAI] Missing Supabase env vars — create web/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. ' +
    'Auth and database features will not work until you do.'
  )
}

// Use a dummy URL so the app boots without .env — supabase-js v2 throws a hard
// error when passed an empty string, which crashes the entire React tree.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
)
