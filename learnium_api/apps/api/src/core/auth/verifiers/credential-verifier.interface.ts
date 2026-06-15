export interface CredentialVerifier {
  verify(username: string, password: string): Promise<number | null>;
}

export const CREDENTIAL_VERIFIER = 'CREDENTIAL_VERIFIER';
