import { api, finishAuthentication } from "./api";

export function passkeysSupported() {
  return (
    !/^[\d.]+$/.test(window.location.hostname) &&
    !window.location.hostname.includes(":") &&
    window.isSecureContext &&
    "PublicKeyCredential" in window &&
    !!navigator.credentials
  );
}

function decode(value: string): ArrayBuffer {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

function encode(value: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function serialize(credential: PublicKeyCredential) {
  const response = credential.response as
    AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      ...("attestationObject" in response
        ? {
            attestationObject: encode(response.attestationObject),
            transports: response.getTransports?.() || [],
          }
        : {
            authenticatorData: encode(response.authenticatorData),
            signature: encode(response.signature),
            userHandle: response.userHandle
              ? encode(response.userHandle)
              : null,
          }),
    },
  };
}

function passkeyError(error: unknown): Error {
  if (error instanceof Error && error.name === "NotAllowedError")
    return new Error(
      "The passkey request was cancelled or no matching passkey was available. You can try again or use your password.",
    );
  if (error instanceof Error && error.name === "InvalidStateError")
    return new Error(
      "A passkey is already saved on this device. Use it to sign in.",
    );
  if (error instanceof Error && error.name === "SecurityError")
    return new Error(
      "Passkeys need Chindi's secure HTTPS address, or localhost while developing.",
    );
  return error instanceof Error
    ? error
    : new Error("Could not use this passkey.");
}

export async function signInWithPasskey() {
  try {
    const options = await api("/auth/passkeys/authenticate/options", "POST");
    const credential = (await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: decode(options.challenge),
        allowCredentials: options.allowCredentials?.map((c: any) => ({
          ...c,
          id: decode(c.id),
        })),
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("No passkey was selected.");
    const result = await api("/auth/passkeys/authenticate/verify", "POST", {
      credential: serialize(credential),
    });
    return finishAuthentication(result);
  } catch (error) {
    throw passkeyError(error);
  }
}

export async function createPasskey(password: string, name: string) {
  try {
    const options = await api("/auth/passkeys/register/options", "POST", {
      password,
      name,
    });
    const credential = (await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: decode(options.challenge),
        user: { ...options.user, id: decode(options.user.id) },
        excludeCredentials: options.excludeCredentials?.map((c: any) => ({
          ...c,
          id: decode(c.id),
        })),
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("No passkey was created.");
    return api("/auth/passkeys/register/verify", "POST", {
      credential: serialize(credential),
    });
  } catch (error) {
    throw passkeyError(error);
  }
}
