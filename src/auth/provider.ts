import type { Session } from "./types";

/**
 * Common shape every auth backend implements. Swapping the active provider
 * (see auth-context.tsx) is a one-line change because callers only ever
 * touch this interface.
 */
export interface AuthProvider {
  /**
   * `credentials` is DEV-PROVIDER-SPECIFIC (userId + passphrase, checked
   * against the localStorage-seeded directory in dev-provider.ts). The
   * Entra provider ignores it entirely — real SSO is a redirect flow
   * (browser navigates to Microsoft, then back with a code), not a
   * credentials object — so its signIn() takes no meaningful argument.
   */
  signIn(credentials?: { userId: string; passphrase: string }): Promise<Session>;
  signOut(): Promise<void> | void;
  getSession(): Session | null;
}
