'use client';

import { useEffect, useRef, useState } from 'react';
import { validateState, storeAccessToken } from '@/lib/vim-auth-client';

/**
 * Registered as Vim's `redirect_uri` (validated against "Allowed URLs" —
 * origin-level, no separate redirect_uri field in app registration). Vim
 * redirects here with ?code=...&state=... after /app-auth/authorize.
 */
export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  // Same double-invoke guard as use-chart-context.ts — a second run would
  // find the CSRF value already removed from sessionStorage by the first
  // (validateState() deletes it on read) and fail anyway, but this also
  // stops us from POSTing the same auth code twice.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const launchId = validateState(params.get('state'));

    if (!code || !launchId) {
      setError('Invalid or expired authorization response. Please relaunch the app from Vim.');
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const body = await res.json();

        if (!res.ok || !body.access_token) {
          setError('Could not complete sign-in with Vim. Please relaunch the app.');
          return;
        }

        storeAccessToken(body.access_token);
        window.location.href = '/';
      } catch {
        setError('Could not complete sign-in with Vim. Please relaunch the app.');
      }
    })();
  }, []);

  return (
    <main className="page">
      <p className="results-empty">{error ?? 'Completing sign-in with Vim…'}</p>
    </main>
  );
}
