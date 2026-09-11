import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

export type PasskeyAccount = { id: string; displayName: string };
export type PasskeyCredential = { id: string; name: string; createdAt: string };
export type PasskeySession = {
  available: boolean;
  authenticated: boolean;
  account?: PasskeyAccount;
  credentials?: PasskeyCredential[];
  error?: string;
};
export type PasskeyAuthResult = {
  authenticated: boolean;
  account?: PasskeyAccount;
  credentials?: PasskeyCredential[];
};
export type PasskeyPrivateItem = { id: string; title: string; body: string };
export type PasskeyPrivateContent = { account: PasskeyAccount; items: PasskeyPrivateItem[] };
export type PasskeyRegistrationOptions = { options: PublicKeyCredentialCreationOptionsJSON };
export type PasskeyLoginOptions = { options: PublicKeyCredentialRequestOptionsJSON };
