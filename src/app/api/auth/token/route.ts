import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/auth/token
 *
 * Server-side half of the Vim Connect OAuth exchange. The browser (Vim's
 * core-sdk script, invoked via the `token_endpoint` this route's URL is
 * registered as) posts { code }; we exchange it for a real access token by
 * calling Vim's own OAuth server with our client_id + client_secret. The
 * secret never reaches the browser — see developer-docs.getvim.ai/docs/authentication.
 */

const BACKEND_URL = process.env.VIM_BACKEND_URL ?? 'https://api.getvim.ai';

export async function POST(req: NextRequest) {
  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.code) {
    return NextResponse.json({ error: 'missing_code' }, { status: 400 });
  }

  const clientId = process.env.VIM_CLIENT_ID;
  const clientSecret = process.env.VIM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[vim-auth] VIM_CLIENT_ID / VIM_CLIENT_SECRET not configured');
    return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/app-auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: body.code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (err) {
    console.error('[vim-auth] token exchange request failed:', err);
    return NextResponse.json({ error: 'token_exchange_failed' }, { status: 502 });
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[vim-auth] token exchange rejected:', res.status, errBody.slice(0, 300));
    return NextResponse.json({ error: 'token_exchange_failed' }, { status: 502 });
  }

  const tokenResponse = await res.json();
  return NextResponse.json(tokenResponse);
}
