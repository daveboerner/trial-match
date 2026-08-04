# Vim Connect SDK — "SDK bridge initialization failed" (blocked, needs Vim engineering)

**Status as of 2026-08-04: blocked.** The OAuth flow (see the now-resolved
`VIM-OAUTH-TROUBLESHOOTING.md`) completes correctly end-to-end — we obtain
a valid, correctly-scoped access token. Handing that token to
`initVimSDK()` fails inside Vim's own dynamically-loaded core-sdk script.

## One-line summary

`initVimSDK({ accessToken })`, called with a freshly-obtained, correctly-scoped
access token, fails with:
```
SDKError: SDK bridge initialization failed
    at h (sdk-handshake.ts:306:11)
```
This happens **inside the Vim Connect Chrome extension's own core-sdk
script**, not in our application code — `sdk-handshake.ts` isn't a file
in our repo or in `@vimconnect/app-sdk`'s own package; it's a
sourcemap-resolved filename from the script dynamically loaded from
`core-sdk.getvim.ai` (or `core-sdk.stage.getvim.ai`) at runtime.

## App / environment details

- App name: Trial Match
- `client_id`: `vim_bd726f3119d1041971c7d7364baee74f` (confirmed correct —
  see `VIM-OAUTH-TROUBLESHOOTING.md` for the earlier appId/client_id mix-up)
- Testing against: `sandbox-ehr.stage.getvim.ai`, real Vim Connect Chrome
  extension, side panel — not local dev, not a mock
- Vim backend for our own OAuth calls: `https://api.stage.getvim.ai`
- App hosting: `https://trial-match-davesboerner-7206s-projects.vercel.app`
  (public)
- Repo: https://github.com/daveboerner/trial-match (public)

## What's confirmed correct (ruled out, in order)

1. **The full OAuth authorize → callback → token-exchange flow completes
   successfully.** Verified via the exact live `/app-auth/authorize`
   request (captured from DevTools, not a replay):
   ```
   GET https://api.stage.getvim.ai/app-auth/authorize?response_type=code&client_id=vim_bd726f3119d1041971c7d7364baee74f&launch=lnch_198088c99d0f0aa9356f6ba13026372b5f5cfa7d0e5ab3167d3b7124fca9b1b5&scope=launch+openid&redirect_uri=https%3A%2F%2Ftrial-match-davesboerner-7206s-projects.vercel.app%2Fauth%2Fcallback&state=lnch_198088c99d0f0aa9356f6ba13026372b5f5cfa7d0e5ab3167d3b7124fca9b1b5%3A9a432f4e-143b-4801-8a92-4c255a313374
   ```
   Correct `client_id`, correct `launch_id`, correct `redirect_uri`, no
   rejection. This redirects back through our `/auth/callback`, which
   POSTs the code to our own `/api/auth/token`, which exchanges it
   server-side and returns a real `access_token` — confirmed present in
   `sessionStorage` (`vim_access_token`, a real-looking JWT).
2. **The access token is fresh and scoped to the current launch**, not a
   stale one reused across launches — see the now-fixed "Launch ID
   mismatch" bug in git history; that fix (always re-authorize on a
   fresh `launch_id`, never reuse an old cached token) is confirmed live
   and working, and this test used a token obtained during *this specific*
   launch.
3. **Environment mismatch (production vs. staging core-sdk) is ruled
   out.** Tried `initVimSDK({ accessToken, __overrideEnv: 'staging' })`
   (an internal, undocumented option modeled on the `vimconnect/vim-demo-app`
   reference) — identical error. Removed it — identical error, same
   message, same stack location. The override made no observable
   difference either way.
4. **Not a CSP/frame-header issue on our side** — our deployment sets no
   `Content-Security-Policy`, `X-Frame-Options`, `Permissions-Policy`, or
   `Cross-Origin-*` headers that could interfere with being framed or
   with postMessage.
5. **The failure is not in our code or in `@vimconnect/app-sdk`'s own
   package** — grepped both for any string resembling "bridge
   initialization" or "sdk-handshake"; nothing. The dynamically-loaded
   `core-sdk.getvim.ai/index.js` (~40KB, fetched directly and inspected)
   does contain real postMessage/MessageChannel-based handshake logic
   with its own failure modes (`"Permission bridge unreachable — no
   response in 5 minutes."`, `HANDSHAKE_TIMEOUT`, `"Vim Connect extension
   acknowledged the handshake but did not complete initialization in
   time."`) — confirming this is a real handshake between the loaded
   script and the Chrome extension itself, not something we can
   inspect or influence from application code.

## What we need Vim engineering to check

1. Server/extension-side logs for this specific `client_id`
   (`vim_bd726f3119d1041971c7d7364baee74f`) and launch
   (`lnch_198088c99d0f0aa9356f6ba13026372b5f5cfa7d0e5ab3167d3b7124fca9b1b5`)
   around the time of this test (2026-08-04) — what does the extension's
   side of the handshake actually see/reject?
2. Is there a known cause for `"SDK bridge initialization failed"`
   distinct from the `HANDSHAKE_TIMEOUT` / `"Permission bridge
   unreachable"` messages we found in the core-sdk script — e.g., a
   permission/scope issue, a manifest capability not enabled for this
   app, or something about how the app is embedded (side panel vs. other
   embed modes) that affects whether the extension can complete this
   handshake?
3. Does this app's registration (`console.stage.getvim.ai/build/apps/305d7d2a-7f7b-45ae-83db-75c70071d75b`
   — note: that URL segment is the appId, not client_id) have all the
   capabilities/permissions enabled that a real bridge handshake
   requires, beyond just the OAuth endpoints we've already verified?
4. Is there anything different about how `vimconnect/vim-demo-app` (which
   presumably works, since it's the official reference) is embedded or
   registered that we should check ours against — e.g., a Worker Launch
   Endpoint, manifest capabilities, or some other registration field we
   haven't touched (ours is blank; do we need one for the bridge
   handshake to succeed even for the non-worker main app)?
