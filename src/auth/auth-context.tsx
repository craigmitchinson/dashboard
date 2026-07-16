import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { AuthProvider } from "./provider";
import { DevAuthProvider } from "./dev-provider";
import type { Session, User } from "./types";

// ---------------------------------------------------------------------------
// Active auth provider. This is the ONLY place the concrete provider is
// chosen — swapping to Entra ID is a one-line change:
//   import { EntraAuthProvider } from "./entra-provider";
//   const provider: AuthProvider = new EntraAuthProvider();
// ---------------------------------------------------------------------------
const provider: AuthProvider = new DevAuthProvider();

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  signIn: (credentials?: { userId: string; passphrase: string }) => Promise<void>;
  signOut: () => void;
  /** Re-read the session from the provider — call after editing the user
   * directory (Administration → Users & roles) so a signed-in user's own
   * name/roles update live instead of waiting for a sign-out/sign-in. */
  refreshSession: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  signIn: async () => {},
  signOut: () => {},
  refreshSession: () => {},
});

/**
 * Wraps the active AuthProvider in React state. Hydrates from
 * provider.getSession() via a lazy initializer, so an already-signed-in
 * user's session is available on the very first render (no `<Login/>`
 * flash while an effect catches up post-mount) — a page refresh keeps the
 * user signed in (dev provider persists the session to localStorage; a real
 * Entra integration would instead silently redeem a cached token here).
 */
export function AuthContextProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => provider.getSession());

  const signIn = useCallback(async (credentials?: { userId: string; passphrase: string }) => {
    const s = await provider.signIn(credentials);
    setSession(s);
  }, []);

  const signOut = useCallback(() => {
    provider.signOut();
    setSession(null);
  }, []);

  const refreshSession = useCallback(() => {
    setSession(provider.getSession());
  }, []);

  return <AuthContext.Provider value={{ session, user: session?.user ?? null, signIn, signOut, refreshSession }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------

export type PermAction = "view_dashboards" | "view_admin" | "edit_spoke_reference" | "edit_global_reference" | "manage_users" | "view_docs";

/**
 * Pure permission check — takes the user explicitly so it's trivial to unit
 * test or reuse outside a component (e.g. from a future admin panel's data
 * loader). `usePermissions()` below just binds this to the current session.
 *
 * `edit_spoke_reference` spokeId semantics: when `spokeId` IS supplied, this
 * answers "can this user edit reference data for that specific spoke"
 * (admin: always; hub_lead: only if spokeId is one of their spokeIds; anyone
 * else: no). When `spokeId` is OMITTED, this instead answers the weaker
 * question "can this user edit spoke reference data for at least one spoke"
 * — admin: true; hub_lead: true iff they have any spokeIds at all; anyone
 * else: false. Callers that already know which spoke they're editing should
 * always pass spokeId; the no-spokeId form exists for callers that just
 * need to decide whether to show an "Edit" affordance at all (e.g. a nav
 * item) before a specific spoke is chosen.
 */
export function can(user: User | null, action: PermAction, spokeId?: string): boolean {
  if (!user) return false;
  const roles = user.roles;

  switch (action) {
    case "view_dashboards":
      return true;

    case "view_admin":
      return roles.includes("admin") || roles.includes("hub_lead") || roles.includes("hub_member");

    case "edit_spoke_reference":
      if (roles.includes("admin")) return true;
      if (roles.includes("hub_lead")) {
        return spokeId === undefined ? user.spokeIds.length > 0 : user.spokeIds.includes(spokeId);
      }
      return false;

    case "edit_global_reference":
      return roles.includes("admin");

    // Reference/ops pages (Playbook + Data model) — admins only.
    case "view_docs":
      return roles.includes("admin");

    case "manage_users":
      return roles.includes("admin");

    default:
      return false;
  }
}

export function usePermissions(): { can: (action: PermAction, spokeId?: string) => boolean } {
  const { user } = useAuth();
  return { can: (action: PermAction, spokeId?: string) => can(user, action, spokeId) };
}
