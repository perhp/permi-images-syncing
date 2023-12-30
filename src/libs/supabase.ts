import { createClient } from "@supabase/supabase-js";

const supabaseUrl = 'https://htyouocguzgigopxxidt.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY as string;
console.log(supabaseKey);
export const supabase = createClient(supabaseUrl, supabaseKey);