/**
 * Client-side half of the Vim Connect OAuth authorization-code flow.
 * Confirmed against developer-docs.getvim.ai/docs/authentication:
 *
 * 1. Vim's Hub opens our Launch Endpoint with `?launch_id=...`.
 * 2. We redirect the browser to `{VIM_BACKEND_URL}/app-auth/authorize` with
 *    client_id, the launch_id, a redirect_uri, and a CSRF-protected `state`.
 * 3. Vim redirects back to that redirect_uri with `?code=...&state=...`.
 * 4. The callback page (src/app/auth/callback/page.tsx) validates state and
 *    POSTs { code } to our own /api/auth/token (server-side exchange).
 * 5. The resulting access_token is what useChartContext() passes to
 *    initVimSDK({ accessToken }) — the SDK does not fetch this on its own.
 */

const CSRF_STORAGE_KEY = 'vim_oauth_csrf';
const TOKEN_STORAGE_KEY = 'vim_access_token';

const BACKEND_URL = process.env.NEXT_PUBLIC_VIM_BACKEND_URL ?? 'https://api.getvim.ai';
const CLIENT_ID = process.env.NEXT_PUBLIC_VIM_CLIENT_ID;

export function getStoredAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function storeAccessToken(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/** Redirects the browser to Vim's authorize endpoint. Does not return. */
export function beginAuthorize(launchId: string): void {
  if (!CLIENT_ID) {
    console.error('[trial-match] NEXT_PUBLIC_VIM_CLIENT_ID is not configured — cannot start Vim authorization.');
    return;
  }

  const csrfToken = crypto.randomUUID();
  sessionStorage.setItem(CSRF_STORAGE_KEY, csrfToken);

  const redirectUri = `${window.location.origin}/auth/callback`;
  const url = new URL('/app-auth/authorize', BACKEND_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('launch', launchId);
  url.searchParams.set('scope', 'launch openid');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', `${launchId}:${csrfToken}`);

  window.location.href = url.toString();
}

/**
 * Validates the `state` param Vim's authorize redirect returns, against the
 * CSRF token we stashed before redirecting. Returns the launchId if valid,
 * null if the state is missing, malformed, or doesn't match (or if this page
 * load isn't actually a callback from our own redirect).
 */
export function validateState(state: string | null): string | null {
  if (!state) return null;
  const [launchId, csrfToken] = state.split(':');
  const expected = sessionStorage.getItem(CSRF_STORAGE_KEY);
  sessionStorage.removeItem(CSRF_STORAGE_KEY);
  if (!csrfToken || !expected || csrfToken !== expected) return null;
  return launchId ?? null;
}
