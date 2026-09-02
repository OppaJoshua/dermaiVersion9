import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[DermAI] Missing Supabase env vars — create web/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. ' +
    'Auth and database features will not work until you do.'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')