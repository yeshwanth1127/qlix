import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";

/** Surface real DOMException reasons; generic catch hid cases where the OS saved a passkey but a second ceremony failed. */
function formatWebAuthnBrowserError(err: unknown): string {
  const name =
    typeof err === "object" && err !== null && "name" in err && typeof (err as { name: unknown }).name === "string"
      ? (err as { name: string }).name
      : "";
  const message =
    typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";

  if (name === "NotAllowedError") {
    return (
      "That step was blocked or cancelled. If your browser already saved a passkey, wait for it to finish, then click " +
      "Verify once more (avoid double-clicking — two overlapping prompts can fail even when the first passkey saves)."
    );
  }
  if (name === "AbortError") {
    return "Device verification timed out or was aborted. Try again.";
  }
  if (name === "SecurityError") {
    return `Device verification failed (SecurityError). ${message || "Use the same hostname as configured for WebAuthn (e.g. localhost vs 127.0.0.1)."}`;
  }
  if (name === "InvalidStateError") {
    return "Passkey setup hit an invalid state. Refresh the page and try Verify again.";
  }
  if (name || message) {
    return `Device verification failed${name ? ` (${name})` : ""}${message ? `: ${message}` : ""}`;
  }
  return "Device verification was cancelled or failed in the browser.";
}

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export async function registerDevice(): Promise<boolean> {
  const optionsRes = await fetch(`${apiBase()}/api/v1/webauthn/register/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({}),
  });

  if (!optionsRes.ok) {
    return false;
  }

  const startPayload = (await optionsRes.json()) as { options?: PublicKeyCredentialCreationOptionsJSON };
  if (!startPayload.options) {
    return false;
  }

  const credential = await startRegistration({ optionsJSON: startPayload.options });

  const verifyRes = await fetch(`${apiBase()}/api/v1/webauthn/register/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ credential }),
  });

  if (!verifyRes.ok) {
    return false;
  }

  const result = (await verifyRes.json()) as { deviceVerified?: boolean };
  return result.deviceVerified === true;
}

export type RegisterDeviceResult =
  | { ok: true; stepUpToken: string }
  | { ok: false; errorMessage: string };

export async function registerDeviceWithError(): Promise<RegisterDeviceResult> {
  const optionsRes = await fetch(`${apiBase()}/api/v1/webauthn/register/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({}),
  });

  if (!optionsRes.ok) {
    const body = (await optionsRes.json().catch(() => null)) as ApiErrorBody | null;
    return {
      ok: false,
      errorMessage: body?.error?.message ?? `Registration start failed (${optionsRes.status})`,
    };
  }

  const startPayload = (await optionsRes.json()) as { options?: PublicKeyCredentialCreationOptionsJSON };
  if (!startPayload.options) {
    return { ok: false, errorMessage: "Invalid response from server" };
  }

  let credential: Awaited<ReturnType<typeof startRegistration>>;
  try {
    credential = await startRegistration({
      optionsJSON: startPayload.options,
    });
  } catch (err) {
    return { ok: false, errorMessage: formatWebAuthnBrowserError(err) };
  }

  const verifyRes = await fetch(`${apiBase()}/api/v1/webauthn/register/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ credential }),
  });

  if (!verifyRes.ok) {
    const body = (await verifyRes.json().catch(() => null)) as ApiErrorBody | null;
    return {
      ok: false,
      errorMessage: body?.error?.message ?? `Verification failed (${verifyRes.status})`,
    };
  }

  const result = (await verifyRes.json()) as { deviceVerified?: boolean; stepUpToken?: string };
  if (result.deviceVerified !== true) {
    return { ok: false, errorMessage: "Device was not marked verified" };
  }
  if (typeof result.stepUpToken !== "string" || result.stepUpToken.length === 0) {
    return { ok: false, errorMessage: "Server did not return a device step-up token" };
  }

  return { ok: true, stepUpToken: result.stepUpToken };
}

/**
 * Step-up token for agent / brain creation: registers a passkey when none exists,
 * otherwise runs a WebAuthn assertion (same flow as Create Agent).
 */
export async function obtainAgentCreateStepUpToken(
  deviceVerified: boolean,
): Promise<RegisterDeviceResult> {
  if (!deviceVerified) {
    return registerDeviceWithError();
  }
  return authenticateForAgentCreateWithError();
}

/** WebAuthn assertion for users who already have a passkey (step-up before agent creation). */
export async function authenticateForAgentCreateWithError(): Promise<RegisterDeviceResult> {
  const optionsRes = await fetch(`${apiBase()}/api/v1/webauthn/authenticate/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({}),
  });

  if (!optionsRes.ok) {
    const body = (await optionsRes.json().catch(() => null)) as ApiErrorBody | null;
    return {
      ok: false,
      errorMessage: body?.error?.message ?? `Authentication start failed (${optionsRes.status})`,
    };
  }

  const startPayload = (await optionsRes.json()) as { options?: PublicKeyCredentialRequestOptionsJSON };
  if (!startPayload.options) {
    return { ok: false, errorMessage: "Invalid response from server" };
  }

  let credential: Awaited<ReturnType<typeof startAuthentication>>;
  try {
    credential = await startAuthentication({
      optionsJSON: startPayload.options,
    });
  } catch (err) {
    return { ok: false, errorMessage: formatWebAuthnBrowserError(err) };
  }

  const verifyRes = await fetch(`${apiBase()}/api/v1/webauthn/authenticate/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ credential }),
  });

  if (!verifyRes.ok) {
    const body = (await verifyRes.json().catch(() => null)) as ApiErrorBody | null;
    return {
      ok: false,
      errorMessage: body?.error?.message ?? `Authentication verify failed (${verifyRes.status})`,
    };
  }

  const result = (await verifyRes.json()) as { ok?: boolean; stepUpToken?: string };
  if (typeof result.stepUpToken !== "string" || result.stepUpToken.length === 0) {
    return { ok: false, errorMessage: "Server did not return a device step-up token" };
  }

  return { ok: true, stepUpToken: result.stepUpToken };
}
