# Vim Connect SDK — "SDK bridge initialization failed" (RESOLVED — local Chrome environment issue)

**RESOLVED 2026-08-05.** Actual root cause: **a second, conflicting Vim
Connect extension was active in the same Chrome profile.** Two extension
instances both trying to inject content scripts and bridge into the same
EHR page raced and collided — matching the extension boot logs in
"Update 2026-08-05 (part 4)" below exactly (`initializeDriverSystem`
timing out, `"Bridge not connected"`), and explaining the intermittency
(which extension "won" the race varied between attempts). Not a bug in
Trial Match's code, registration, or Vim's servers at all — disabling
the conflicting extension fixed it. Kept the rest of this doc for the
debugging narrative and because the extension-log-reading technique
(exporting the Vim Connect extension's own debug logs to see past the
app-level error into what the extension itself was doing) is a
genuinely useful diagnostic for next time, even though the root cause
here turned out to be local-environment, not server/extension-code.

## Update 2026-08-05: confirmed intermittent, not deterministic

Sequence, in order, same day:
1. Declared EHR capabilities in the app registration's **EHR tab**
   (previously completely empty — nothing was checked). Deployed.
2. Tested fresh in the sandbox: **the bridge connected successfully.**
   Patient in context, panel correctly showed "waiting for a patient
   chart to open" (proving `initVimSDK()` had resolved), Hub showed "May
   not be ready" (a separate, since-fixed issue — see below).
3. Fixed two follow-on issues found from that successful connection: (a)
   switched from `workflow.on('chart_open', ...)` to
   `context.onChange('chart_open:patient', ...)` since a workflow event
   subscription set up *after* the patient was already in context would
   permanently miss that one-shot event; (b) added
   `sdk.hub.setActivationStatus('ENABLED')`, which the quick-start guide
   calls immediately after a successful `initVimSDK()` and which we'd
   omitted — this is what "May not be ready" turned out to be. Deployed.
4. **Retested with a genuinely fresh launch (new `launch_id`, new
   authorize round-trip, new access token) — `"SDK bridge initialization
   failed"` again, identical to before step 1.**
5. Re-verified the EHR tab capabilities were still checked/saved (not
   reverted) — confirmed yes, still all checked.

Steps 3's code changes only run **after** `initVimSDK()` already
resolves — they cannot be the cause of `initVimSDK()` itself newly
failing. So between the success in step 2 and the failure in step 4,
nothing on our side changed that could plausibly explain the difference:
same client_id, same registration, same EHR capabilities, same code path
up to and including the `initVimSDK()` call itself. This points at
something intermittent in the extension/core-sdk bridge handshake itself
— not a deterministic misconfiguration we can find and fix from the
application side.

## Update 2026-08-05 (part 2): found a plausible mechanism, shipped a fix, not yet retested

Did a complete pass through every remaining docs page (error-handling,
react-integration, platform-overview, changelog, ehr-support) and fully
read `vimconnect/vim-demo-app`, including a file not previously read:
**`vim-sdk.js` at the demo repo's root — a checked-in, unminified
reference copy of the SDK client protocol itself** (the file ends with
`window.VimSDK = { init: initVimSDK, get: getVimSDK }`, confirming it's
what `@vimconnect/app-sdk` dynamically loads and calls; comments inside
point to `extensions/vim-connect/src/sidepanel/services/sdk-bridge.ts`
as the parent/extension-side counterpart). This is presumably an older
snapshot, not byte-identical to what's currently served from
`core-sdk.getvim.ai` (it doesn't contain the literal string "SDK bridge
initialization failed" or "sdk-handshake" — the currently-deployed
version has evidently evolved past this snapshot), but the **protocol
shape it reveals is almost certainly still representative**:

- `SDKClient.init()` has **no protection against being called more than
  once in the same browser tab.** Every call unconditionally creates a
  brand-new client instance (overwriting the module-level singleton
  reference to any prior instance, even one still mid-handshake),
  registers another `window.addEventListener('message', ...)` listener,
  and sends another `VIM_SDK_READY` postMessage to the parent frame.
- The response-handling listener resolves against *whatever instance is
  currently the singleton at the time a `VIM_SDK_INIT` message arrives*
  — not necessarily the instance that sent the particular `VIM_SDK_READY`
  the extension is responding to.
- Two overlapping `init()` calls in the same tab would therefore race
  multiple listeners against however many responses come back, with only
  the most recently created instance actually getting wired up — a
  concrete, plausible mechanism for "identical configuration, sometimes
  connects, sometimes doesn't."

Our own `use-chart-context.ts` had a `useRef` guard against the *same
component instance's* effect re-firing (needed for a different, already-
fixed bug — see the launch_id-mismatch history above) — but that
guard is powerless against a genuine remount creating a fresh `useRef`.
The `react-integration` docs page independently corroborates this angle:
*"connection failures often stem from multiple initialization
attempts"*, and recommends a single-source-of-truth Provider pattern for
exactly this reason. (Note: `vim-demo-app`'s own main page does **not**
actually follow that Provider pattern itself — it uses a component-level
guard much like ours, so this inconsistency exists in Vim's own materials
too, and isn't itself evidence our architecture was wrong.)

**Fix shipped:** `src/lib/vim-sdk-connection.ts` — a *module-level*
(not component-level) cached promise for the SDK connection, so that no
matter how many times a component remounts, at most one `initVimSDK()`
call ever fires per access token in a given page load. `use-chart-context.ts`
now calls this instead of `initVimSDK()` directly.

## Update 2026-08-05 (part 3): retested — same error, same stack location. Multi-init theory ruled out.

Retested a genuinely fresh launch with the module-level connection
singleton live. **Identical result**:
```
[trial-match] Vim SDK failed to connect with stored access token: SDKError: SDK bridge initialization failed
    at h (sdk-handshake.ts:306:11)
```
Same message, same stack location, panel fell back to `standalone`
exactly as before. Since this fix specifically makes a second
`initVimSDK()` call for the same token impossible, and the failure is
unchanged, **the multi-init-attempts theory is now ruled out** as the
cause of this specific failure (the fix is still worth keeping — it's a
real, independently-correct improvement — it just isn't what's causing
this).

**This closes out what's checkable from the application side.** Across
this investigation we have tried, and ruled out, every one of:
timing/expiry, duplicate-redirect launch_id reuse, staging-vs-production
backend URL mismatch, wrong client_id (appId confusion — this one was
real and fixed), missing EHR capability declarations (this got the
bridge to connect *once*, but didn't make it reliable), the
`__overrideEnv` staging core-sdk override, CSP/frame headers on our
deployment, and now concurrent/duplicate `initVimSDK()` calls. Every
docs page and the full reference implementation (including its
lowest-level protocol source, `vim-sdk.js`) have been read. There is
nothing left to try from this side without visibility into what the
extension or Vim's servers actually see during a failing handshake vs. a
succeeding one for the exact same app configuration. **The path forward
is Vim engineering, not another client-side change** — see "What we need
Vim engineering to check" below, which still stands as written.

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

## Update 2026-08-05 (part 4): extension boot logs show the real root cause — not app-side at all

Separately from all the above, we noticed the Trial Match icon was
**completely missing from the Vim Hub strip** — not just failing to
connect, genuinely absent. Dave exported the Vim Connect extension's own
debug logs (via its extension-logs export feature) for the tab where
this was happening. They show the extension's **content script itself**
(injected into the Sandbox EHR page, independent of our app/iframe
entirely) failing to boot:

```
[Vim Connect] Content script initializing in tab 315965567
[Messaging] Sending to background: TAB_CONTENT_STARTING
[Messaging] Sending to background: SESSION_CONTEXT_GET
[CommunicationBridge] Sent alive message to MAIN world
...
ERROR [Vim Connect] Failed to initialize driver system: Connection timeout
    at chrome-extension://hkgoafgiinlkilinanffdoehogbhckeo/src/content/content-script.js:449:37
[Vim Connect] Driver system initialized without bridge
ERROR [Vim Connect] boot failed
  step: "wireNetworkMonitor", totalDurationMs: 5188
  completed: [["getTabId",8],["fetchPriorContext",9,{"hasPrior":false}],
              ["loadEnvConsoleGate",6],["initializeDriverSystem",5163]]
  error: Error: Bridge not connected
    at CommunicationBridge.subscribe (chrome-extension://.../content-script.js:540:15)
    at initialize (chrome-extension://.../content-script.js:25829:41)
```

Reading this boot sequence: `getTabId` (8ms), `fetchPriorContext` (9ms,
no prior context), `loadEnvConsoleGate` (6ms) all complete fine, then
`initializeDriverSystem` — which registers detection drivers for `dom`,
`url`, `redirect`, `network`, `angular`, `ember`, `backbone` (presumably
to detect the host EHR's own frontend framework/state) — **takes
5163ms and times out**, degrading to "initialized without bridge." The
overall content-script boot then fails outright with `Bridge not
connected` when something later tries to `CommunicationBridge.subscribe`.

**This is the extension bridging into the EHR page itself — entirely
independent of our app, our iframe, our client_id, or our registration.**
It plausibly explains everything documented above:
- Why the Hub icon is sometimes/completely missing (if the extension
  can't bridge into the page, it can't detect page state to render the
  Hub strip reliably)
- Why our own `"SDK bridge initialization failed"` is intermittent with
  *identical* app config — our iframe's handshake likely depends on this
  same underlying content-script/bridge infrastructure being healthy
  first, and it's timing out on a ~5-second race, not failing
  deterministically
- Why nothing we changed on the application side ever made a
  difference — there was nothing to fix there

**This should be treated as the primary lead**, not the app-level
"SDK bridge initialization failed" framing this doc started with. It's
also worth noting this may not be specific to Trial Match at all — a
flaky content-script bridge to the Sandbox EHR page would presumably
affect any app running in that Hub.

## What we needed Vim engineering to check (superseded — resolved locally, no longer needed)

Turned out to be a conflicting second Vim Connect extension in the same
Chrome profile — see the RESOLVED note at the top. Keeping these
questions for the record; nothing further needed from Vim engineering
on this specific error.

1. **Most important, and now the primary lead:** the extension's own
   content-script boot log shows `initializeDriverSystem` timing out
   after ~5.1 seconds with `"Bridge not connected"` on the Sandbox EHR
   page (`sandbox-ehr.stage.getvim.ai`), independent of any specific
   app. Is this a known issue with the extension's content-script bridge
   on this sandbox environment? Full extension log export is available
   on request — key excerpt is in "Update 2026-08-05 (part 4)" above.
2. Is `initializeDriverSystem`'s ~5s timeout adjustable, or is there a
   known cause for it failing specifically against the Sandbox EHR (as
   opposed to a real production EHR)?
3. Assuming the content-script bridge issue above is fixed or explained:
   why did the bridge handshake succeed on one fresh-launch attempt and
   fail with `"SDK bridge initialization failed"` on others, for the
   same `client_id`, same registration, same EHR capabilities? Comparing
   server/extension-side logs for a successful attempt against a failed
   one (both documented with exact `launch_id`s above) would help
   confirm whether it's the same content-script timing issue or
   something separate.
4. Is there anything different about how `vimconnect/vim-demo-app` (the
   official reference) is embedded or registered that we should check
   ours against — e.g., a Worker Launch Endpoint, additional manifest
   capabilities beyond EHR data access, or some other registration field
   we haven't touched (ours is blank)?
