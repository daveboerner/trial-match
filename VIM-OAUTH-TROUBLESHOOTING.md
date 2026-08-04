# Vim Connect OAuth — redirect_uri rejection (blocked, needs Vim engineering)

**Status as of 2026-08-04: blocked.** We've exhausted client-side troubleshooting
and diffed our implementation against Vim's own reference app with no
discrepancy found. This needs someone with server-side access to Vim's
auth service to look at.

## One-line summary

The OAuth authorize step for our registered app fails with
`{"error":"redirect_uri not authorized for this client"}`, even though the
exact `redirect_uri` we send is confirmed present, byte-for-byte, in the
app's registered Allowed URLs.

## App / environment details

- App name: Trial Match
- `client_id`: `305d7d2a-7f7b-45ae-83db-75c70071d75b`
- Registered at: `console.stage.getvim.ai/build/apps/305d7d2a-7f7b-45ae-83db-75c70071d75b`
- Testing against: `sandbox-ehr.stage.getvim.ai` (staging sandbox)
- Vim backend in use: `https://api.stage.getvim.ai`
- App hosting: `https://trial-match-davesboerner-7206s-projects.vercel.app` (public)
- Repo: https://github.com/daveboerner/trial-match (public)

## Current registered app config (version 3, confirmed live — team says no separate publish step)

| Field | Value |
|---|---|
| App URL | `https://trial-match-davesboerner-7206s-projects.vercel.app` |
| Launch Endpoint | `https://trial-match-davesboerner-7206s-projects.vercel.app` |
| Token Endpoint | `https://trial-match-davesboerner-7206s-projects.vercel.app/api/auth/token` |
| Allowed URLs | `https://trial-match-davesboerner-7206s-projects.vercel.app,https://trial-match-davesboerner-7206s-projects.vercel.app,https://trial-match-davesboerner-7206s-projects.vercel.app/auth/callback` |
| Worker Launch Endpoint | (blank — no Worker App) |

## Timeline — what we tried, in order, and what each step ruled out

### 1. First real-chart test: SDK never connected at all

Console error:
```
SDKError: Failed to resolve access token: either pass accessToken directly
to init(), or configure a token_endpoint in your app manifest so the SDK
can fetch it automatically
```

Diagnosis: our client code assumed `initVimSDK()` would auto-resolve a
token via some `token_endpoint` query-param convention (based on a doc
comment on `SDKInitOptions`). That doesn't happen automatically — confirmed
by re-reading `developer-docs.getvim.ai/docs/authentication` with a more
targeted question, which described the actual required flow: the *app*
must redirect the browser to `/app-auth/authorize` itself.

**Fix:** implemented the full flow client-side — redirect to
`{VIM_BACKEND_URL}/app-auth/authorize` with `client_id`, `launch`,
`scope=launch openid`, `redirect_uri`, and a CSRF-protected `state`; a
callback page then POSTs the returned `code` to our own
`/api/auth/token`, which exchanges it server-side with Vim
(`client_id`+`client_secret`, never exposed to the browser) and returns
the access token.

### 2. `{"error":"Invalid or expired launch ID"}` — first occurrence

- **Ruled out: timing.** Confirmed the gap between the launch and the
  redirect was milliseconds, not seconds.
- **Real bug, but not the cause of this occurrence:** diffing against
  the reference app (`github.com/vimconnect/vim-demo-app`) showed its
  `/launch` page guards against the redirect effect firing more than
  once, with the comment *"Prevent duplicate redirects — React
  StrictMode runs effects twice."* Our code had no equivalent guard.
  Added a `useRef`-based guard matching that pattern. **The error
  persisted after this fix**, so it wasn't the actual cause here (though
  it's a real, worthwhile fix regardless).
- **Actual root cause:** re-tested with DevTools "Preserve log" enabled
  and confirmed there was genuinely only **one** `launches` call, **one**
  page load, **one** authorize attempt — no duplication at all. Checked
  the `launches` request's `:authority` request header: `api.stage.getvim.ai`.
  Our app's `VIM_BACKEND_URL` / `NEXT_PUBLIC_VIM_BACKEND_URL` env vars
  were set to **`api.getvim.ai`** (production) — production had no
  record of a staging-issued `launch_id`.
- **Fix:** updated both env vars (locally and in Vercel) to
  `https://api.stage.getvim.ai`, redeployed, and confirmed via the
  actual deployed client JS bundle (grepped the built chunk for the
  literal string) that the new value was genuinely live, not just
  assumed.

### 3. `{"error":"redirect_uri not authorized for this client"}` — current blocker

- Confirmed the app registration exists on `console.stage.getvim.ai`
  (the staging console) for this `client_id`, with Token Endpoint and
  Allowed URLs as shown in the table above.
- **Hypothesis A (ruled out): exact-match vs origin-level match.**
  Initially Allowed URLs only had the bare origin, no `/auth/callback`
  path. Added the exact path as an additional comma-separated entry
  (now version 3). Confirmed with the Vim team there's no separate
  "publish" step — a saved draft is immediately live. **Same error
  persisted.**
- **Confirmed byte-for-byte** (via a plain-text copy of the field, not
  a screenshot, specifically to rule out a transcription error) that
  the exact `redirect_uri` value **is present** in Allowed URLs:
  `https://trial-match-davesboerner-7206s-projects.vercel.app/auth/callback`
- **Confirmed with the Vim team** that "Allowed URLs" in this console
  *is* the field checked for `redirect_uri` authorization — not a
  separate, different system.
- **Compared our redirect_uri construction against the reference
  vim-demo-app** — structurally identical: `${window.location.origin}/<fixed-path>`,
  same `URLSearchParams` encoding, same `/app-auth/authorize` URL
  construction, same `scope=launch openid`. No client-side code
  difference found that would explain the rejection.
- At this point we've exhausted what's checkable/fixable from the
  client side.

## Exact repro (captured live from the browser, not a replay)

Full request that gets rejected:
```
GET https://api.stage.getvim.ai/app-auth/authorize?response_type=code&client_id=305d7d2a-7f7b-45ae-83db-75c70071d75b&launch=lnch_718668a5081c9888b8856429fd6e8250ef11f155f12a3c09e6d5c9f1fc6d30ac&scope=launch+openid&redirect_uri=https%3A%2F%2Ftrial-match-davesboerner-7206s-projects.vercel.app%2Fauth%2Fcallback&state=lnch_718668a5081c9888b8856429fd6e8250ef11f155f12a3c09e6d5c9f1fc6d30ac%3A98c6da16-189d-484d-9d6a-d0e776391410
```

Decoded `redirect_uri`: `https://trial-match-davesboerner-7206s-projects.vercel.app/auth/callback`

Response: `400 Bad Request`
```json
{"error":"redirect_uri not authorized for this client"}
```

## What we need Vim engineering to confirm

1. For `client_id` `305d7d2a-7f7b-45ae-83db-75c70071d75b`, what
   `redirect_uri`(s) does the **auth service itself** actually have on
   file — does it match what the `console.stage.getvim.ai` UI shows
   under Allowed URLs?
2. Is there a sync/propagation gap or a separate data store between the
   console UI's "Allowed URLs" field and whatever the live
   `/app-auth/authorize` endpoint validates against?
3. Any normalization rule we might be missing — trailing slash
   requirements, scheme/case sensitivity, a max field length that could
   silently truncate the comma-separated list, or a cap on the number of
   entries?
4. Can someone with server-side access reproduce the exact request
   above and tell us what the auth service is actually comparing it
   against?
