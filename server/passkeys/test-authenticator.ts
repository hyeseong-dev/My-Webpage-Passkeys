/**
 * Test-only software authenticator. It generates a real P-256 key pair and signs
 * actual WebAuthn assertions. It is never imported by the application handler.
 * The private key stays in this object's closure and is never exported/logged.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

type CborValue = string | number | Uint8Array | Map<CborValue, CborValue>;
function cborHead(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  if (value < 65536) { const result = Buffer.alloc(3); result[0] = (major << 5) | 25; result.writeUInt16BE(value, 1); return result; }
  throw new Error("Test CBOR value too large");
}
function cbor(value: CborValue): Buffer {
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") { const encoded = Buffer.from(value); return Buffer.concat([cborHead(3, encoded.length), encoded]); }
  if (value instanceof Uint8Array) return Buffer.concat([cborHead(2, value.length), Buffer.from(value)]);
  return Buffer.concat([cborHead(5, value.size), ...Array.from(value.entries()).flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

export function createTestAuthenticator() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = pair.publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(32);
  const publicKey = cbor(new Map<CborValue, CborValue>([
    [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(publicJwk.x!, "base64url")], [-3, Buffer.from(publicJwk.y!, "base64url")],
  ]));
  let userHandle = "";
  let counter = 0;
  const clientData = (type: string, challenge: string, origin: string) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  function authData(rpId: string, flags: number, count: number): Buffer {
    const countBuffer = Buffer.alloc(4);
    countBuffer.writeUInt32BE(count);
    return Buffer.concat([createHash("sha256").update(rpId).digest(), Buffer.from([flags]), countBuffer]);
  }
  return {
    id: credentialId.toString("base64url"),
    publicKeyBase64url: publicKey.toString("base64url"),
    registration(options: PublicKeyCredentialCreationOptionsJSON, origin: string, overrides: { userVerified?: boolean; rpId?: string } = {}): RegistrationResponseJSON {
      userHandle = options.user.id;
      const credentialLength = Buffer.alloc(2);
      credentialLength.writeUInt16BE(credentialId.length);
      const authenticatorData = Buffer.concat([
        authData(overrides.rpId ?? options.rp.id!, overrides.userVerified === false ? 0x41 : 0x45, counter),
        Buffer.alloc(16), credentialLength, credentialId, publicKey,
      ]);
      return {
        id: credentialId.toString("base64url"), rawId: credentialId.toString("base64url"), type: "public-key",
        clientExtensionResults: { credProps: { rk: true } }, authenticatorAttachment: "platform",
        response: {
          clientDataJSON: clientData("webauthn.create", options.challenge, origin).toString("base64url"),
          attestationObject: cbor(new Map<CborValue, CborValue>([["fmt", "none"], ["authData", authenticatorData], ["attStmt", new Map()]])).toString("base64url"),
          transports: ["internal"],
        },
      };
    },
    authentication(options: PublicKeyCredentialRequestOptionsJSON, origin: string, overrides: { userVerified?: boolean; rpId?: string; counter?: number; wrongSignature?: boolean; userHandle?: string } = {}): AuthenticationResponseJSON {
      counter = overrides.counter ?? counter + 1;
      const authenticatorData = authData(overrides.rpId ?? options.rpId!, overrides.userVerified === false ? 1 : 5, counter);
      const client = clientData("webauthn.get", options.challenge, origin);
      const signature = sign("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(client).digest()]), pair.privateKey);
      if (overrides.wrongSignature) signature[signature.length - 1] ^= 1;
      return {
        id: credentialId.toString("base64url"), rawId: credentialId.toString("base64url"), type: "public-key",
        clientExtensionResults: {}, authenticatorAttachment: "platform",
        response: {
          clientDataJSON: client.toString("base64url"), authenticatorData: authenticatorData.toString("base64url"),
          signature: signature.toString("base64url"), userHandle: overrides.userHandle ?? userHandle,
        },
      };
    },
  };
}
