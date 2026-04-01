import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

function resolveCacheScope(value) {
	try {
		const hostname = new URL(value).hostname || '';
		return hostname.split('.')[0] || 'default';
	} catch {
		return 'default';
	}
}

export const SUPABASE_CACHE_SCOPE = resolveCacheScope(url);

export const supabase = createClient(url, anon);

let anonymousSessionPromise = null;

export async function ensureAnonymousSession() {
	const {
		data: { session },
		error: sessionError,
	} = await supabase.auth.getSession();

	if (sessionError) throw sessionError;
	if (session) return session;

	if (!anonymousSessionPromise) {
		anonymousSessionPromise = supabase.auth
			.signInAnonymously()
			.then(({ data, error }) => {
				if (error) throw error;
				return data?.session || null;
			})
			.finally(() => {
				anonymousSessionPromise = null;
			});
	}

	return anonymousSessionPromise;
}
