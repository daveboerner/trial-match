import { initVimSDK, type VimSDK } from '@vimconnect/app-sdk';

/**
 * Module-level singleton for the SDK connection — deliberately NOT a
 * per-component/per-hook guard. Read (by inspecting the demo repo's
 * checked-in reference copy of the SDK client protocol, vim-sdk.js):
 * SDKClient.init() has no protection of its own against being called more
 * than once in the same tab. Every call unconditionally creates a brand-new
 * client instance, registers another `window.addEventListener('message', ...)`
 * listener, and sends another `VIM_SDK_READY` postMessage — even if a prior
 * call is still mid-handshake. Two overlapping calls race multiple message
 * listeners against however many responses come back, with only the
 * *most recently created* instance actually getting wired up when any
 * listener fires. That's a plausible mechanism for "same config, sometimes
 * connects, sometimes doesn't" — a React-level useRef guard only protects
 * against the same component instance's effect re-firing, not a genuine
 * remount creating a fresh ref. Caching the promise here, outside any
 * component, means a remount reuses the same in-flight/resolved connection
 * instead of ever calling initVimSDK() a second time for the same token.
 */
let connectionPromise: Promise<VimSDK> | null = null;
let connectionToken: string | null = null;

export function connectVimSDKOnce(accessToken: string): Promise<VimSDK> {
  if (connectionPromise && connectionToken === accessToken) {
    return connectionPromise;
  }

  connectionToken = accessToken;
  connectionPromise = initVimSDK({ accessToken }).catch((err) => {
    // Don't cache a failure forever — let a genuinely new attempt (e.g. a
    // fresh launch with a new token) retry instead of being stuck replaying
    // the same rejection.
    connectionPromise = null;
    connectionToken = null;
    throw err;
  });

  return connectionPromise;
}
