import { supabase } from './supabase';

export const apiFetch = async (url: string, options: any = {}) => {
  try {
    let token = null;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
    const isPlaceholder = supabaseUrl.includes('placeholder');
    
    if (!isPlaceholder) {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token;
    }
    
    const headers: any = {
      ...options.headers,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (options.body && !headers['Content-Type'] && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, { ...options, headers });
    return response;
  } catch (error) {
    console.error(`apiFetch error for ${url}:`, error);
    throw error;
  }
};
