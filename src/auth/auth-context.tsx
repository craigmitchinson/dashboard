import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AuthProvider } from "./provider";
import { DevAuthProvider } from "./dev-provider";
import { EntraAuthProvider, completeEntraRedirect, tryRenewEntraSession, getAccessToken } from "./entra-provider";
import type { Session, User } from "./types";
import { setAuthTokenProvider } from "../data/client";

// ---------------------------------------------------------------------------
// Active auth provider. This is the ONLY place the concrete provider is
// chosen — controlled by VITE_AUTH_PROVIDER ("entra" to use EntraAuthProvider,
// anything else falls back to the dev provider).
// ---------------------------------------------------------------------------
const provider: AuthProvider = import.meta.env.VITE_AUTH_PROVIDER === "entra" ? new EntraAuthProvider() : new DevAuthProvider();

// Best-effort surface for a redirect-completion failure (see the effect
// below) — there's no in-flight signIn() promise to reject when the failure
// happens on the page load AFTER the redirect, since the flow spans a full
// navigation. Not required today, but documented here in case a future
// Login.tsx wants to surface it.
export let lastEntraError: string | null = null;

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

  // Entra-only: on mount, check whether we just landed back from Microsoft's
  // login page (redirect carries ?code=&state=) and if so complete the PKCE
  // exchange and adopt the resulting session.
  useEffect(() => {
    if (!(provider instanceof EntraAuthProvider)) return;
    let cancelled = false;
    completeEntraRedirect()
      .then((session) => {
        if (!cancelled && session) setSession(session);
      })
      .catch((err) => {
        // Surface a redirect-completion failure the same way DevAuthProvider's
        // signIn() failures already surface to the Login screen: as a thrown
        // rejection from signIn(). There's no in-flight signIn() promise to
        // reject here (the flow spans a full page navigation), so stash the
        // message somewhere the Login screen can read it. Simplest option
        // that doesn't touch Login.tsx (not owned here): log it and leave
        // session null so the user lands back on the sign-in screen; ALSO
        // set a small module-level `lastEntraError` string this file exports,
        // in case a future Login.tsx wants to surface it (documented, not
        // required today).
        console.error("Entra ID sign-in redirect failed:", err);
        if (!cancelled) lastEntraError = err instanceof Error ? err.message : String(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Entra-only: periodically try a silent refresh so a long-lived tab
  // doesn't silently drop to signed-out at the token's expiry with no
  // attempt to renew.
  useEffect(() => {
    if (!(provider instanceof EntraAuthProvider)) return;
    const id = setInterval(async () => {
      const renewed = await tryRenewEntraSession();
      if (renewed) setSession(renewed);
      // if renewal fails (returns null), leave the current state as-is —
      // getSession() will naturally start returning null once the existing
      // token's expiry passes, and the user will be prompted to sign in
      // again the next time something calls refreshSession()/reloads.
    }, 5 * 60 * 1000); // check every 5 minutes; tryRenewEntraSession is cheap to call and safe to no-op
    return () => clearInterval(id);
  }, []);

  // Entra-only: register this provider's access-token getter with the data
  // client so every /api/* call made anywhere in the app carries a bearer
  // token. src/main.tsx registers it too, for the very first boot-time fetch
  // (before this component even mounts) — this effect keeps it registered
  // for the lifetime of the app afterwards.
  useEffect(() => {
    if (!(provider instanceof EntraAuthProvider)) return;
    setAuthTokenProvider(getAccessToken);
    return () => setAuthTokenProvider(null);
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
