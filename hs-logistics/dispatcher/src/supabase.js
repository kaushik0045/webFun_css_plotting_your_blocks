import { createClient } from '@supabase/supabase-js';
import { createDemoClient } from './demo/mockSupabase.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// With no Supabase keys (or with ?demo in the address), the dashboard runs on
// sample data so it can be tried right away.
export const demo = !(url && key) || new URLSearchParams(location.search).has('demo');
export const configured = true;
export const supabase = demo ? createDemoClient() : createClient(url, key);
