"use client";

/**
 * Enoki zkLogin OAuth landing route — Phase A, 2026-05-17.
 *
 * Flow recap (see `node_modules/@mysten/enoki/dist/wallet/wallet.mjs`):
 *
 *   1. dApp opens an OAuth popup (Google / Twitch) with
 *      `redirect_uri = <origin>/auth/callback` pinned by
 *      `src/config/dapp-kit.ts`.
 *   2. The provider authenticates the user and redirects the popup back
 *      to this route — either `#id_token=...` (success, implicit flow)
 *      or `?error=...&error_description=...` (failure).
 *   3. The parent window polls `popup.location.hash` / `.search`,
 *      extracts the token, and closes the popup. In the happy path this
 *      page is visible for one frame at most.
 *
 * Why this page exists:
 *
 *   - Same-origin landing target so the parent's polling loop can read
 *     `popup.location.*` without a cross-origin SecurityError.
 *   - Avoids a 404 if the popup lingers (slow network, error redirect).
 *   - Surfaces the OAuth provider's `error` / `error_description` query
 *     params when present. Without this, a misconfigured client_id or
 *     redirect URI vanishes into a blank popup that's silently closed
 *     — exactly the failure mode that produced the redirect_mismatch we
 *     just debugged.
 *
 * Intentionally minimal: no app shell, no design tokens, no auth state
 * mutations. The wallet flow does all of that in the parent window via
 * `EnokiWallet.#handleAuthCallback`.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function CallbackBody() {
  const params = useSearchParams();
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>Sign-in failed</h1>
        <p style={{ marginBottom: 8 }}>
          <strong>Error:</strong> {error}
        </p>
        {errorDescription ? (
          <p style={{ marginBottom: 16 }}>
            <strong>Detail:</strong> {errorDescription.replace(/\+/g, " ")}
          </p>
        ) : null}
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          Close this window and try again. If the error persists, the OAuth
          redirect URI registered with the provider does not match{" "}
          <code>{typeof window !== "undefined" ? window.location.origin : ""}/auth/callback</code>.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <p>Signing you in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Signing you in…</div>}>
      <CallbackBody />
    </Suspense>
  );
}
