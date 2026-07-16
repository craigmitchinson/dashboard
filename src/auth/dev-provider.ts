import type { AuthProvider } from "./provider";
import type { Role, Session, User } from "./types";

// ---------------------------------------------------------------------------
// Dev auth provider — a working, localStorage-backed stand-in for a real
// identity backend. Good enough to demo full RBAC behaviour end-to-end;
// swap for EntraAuthProvider (entra-provider.ts) once Entra ID is wired up.
// ---------------------------------------------------------------------------

// v2: re-seeds the directory (admin demo user renamed). Bumping the key is a
// deliberate wipe of any locally-edited demo directory — it's a prototype
// fixture, not real user data.
const USERS_KEY = "bp-users-v2";
const SESSION_KEY = "bp-session-v1";

interface DirectoryEntry {
  user: User;
  passphrase: string;
}

// Seeded demo directory — one of each role, spread across the four real
// spokes (Insurance, Pensions & Investments / Risk / Commercial / Consumer
// Lending — see rpaData.ts SPOKE_INFO). Passphrase choice: every seeded
// user shares the literal passphrase "demo" — this is a prototype directory,
// not a security boundary, so a single easy-to-remember passphrase keeps the
// demo login screen frictionless. hub_member is modelled as CoE-wide support
// staff with no single spoke affiliation (spokeIds: []); give it a spoke of
// its own later if a scoped-support-staff scenario is needed.
const SEED_DIRECTORY: DirectoryEntry[] = [
  {
    user: {
      id: "u-admin",
      name: "Nigel Spriggs",
      email: "nigel.spriggs@bp-coe.example",
      roles: ["admin"],
      spokeIds: [],
    },
    passphrase: "demo",
  },
  {
    user: {
      id: "u-lead-ipi",
      name: "Callum Ferris",
      email: "callum.ferris@bp-coe.example",
      roles: ["hub_lead"],
      spokeIds: ["Insurance, Pensions & Investments"],
    },
    passphrase: "demo",
  },
  {
    user: {
      id: "u-lead-risk",
      name: "Naomi Whitfield",
      email: "naomi.whitfield@bp-coe.example",
      roles: ["hub_lead"],
      spokeIds: ["Risk"],
    },
    passphrase: "demo",
  },
  {
    user: {
      id: "u-hubmember",
      name: "Dev Kapoor",
      email: "dev.kapoor@bp-coe.example",
      roles: ["hub_member"],
      spokeIds: [],
    },
    passphrase: "demo",
  },
  {
    user: {
      id: "u-biz-commercial",
      name: "Sian Roberts",
      email: "sian.roberts@bp-coe.example",
      roles: ["business_user"],
      spokeIds: ["Commercial"],
    },
    passphrase: "demo",
  },
  {
    user: {
      id: "u-biz-lending",
      name: "Marcus Delaney",
      email: "marcus.delaney@bp-coe.example",
      roles: ["business_user"],
      spokeIds: ["Consumer Lending"],
    },
    passphrase: "demo",
  },
];

function readDirectory(): DirectoryEntry[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDirectory(dir: DirectoryEntry[]): void {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(dir));
  } catch {
    /* ignore — storage unavailable/full, directory just won't persist */
  }
}

// Seed on first run only. Never stomps an existing directory (e.g. one an
// admin panel has already edited).
function ensureSeeded(): void {
  try {
    if (localStorage.getItem(USERS_KEY) == null) {
      writeDirectory(SEED_DIRECTORY);
    }
  } catch {
    /* localStorage unavailable — nothing to seed into */
  }
}
ensureSeeded();

// --- directory API, for a future admin panel --------------------------------

/** All seeded/managed users (no passphrases — those never leave the directory). */
export function listUsers(): User[] {
  return readDirectory().map((e) => e.user);
}

export function addUser(user: User, passphrase: string): void {
  const dir = readDirectory();
  if (dir.some((e) => e.user.id === user.id)) {
    throw new Error(`addUser: a user with id "${user.id}" already exists`);
  }
  writeDirectory([...dir, { user, passphrase }]);
}

export function updateUser(userId: string, patch: Partial<User>): void {
  const dir = readDirectory();
  const idx = dir.findIndex((e) => e.user.id === userId);
  if (idx === -1) return; // no-op on unknown user
  const next = [...dir];
  next[idx] = { ...next[idx], user: { ...next[idx].user, ...patch, id: next[idx].user.id } };
  writeDirectory(next);
}

export function removeUser(userId: string): void {
  const dir = readDirectory();
  writeDirectory(dir.filter((e) => e.user.id !== userId));
}

/** Admin panel "reset passphrase" action. In production this whole directory
 * (and passphrases with it) goes away in favour of Entra ID / AD group
 * membership — see the Playbook note surfaced next to this action in the UI. */
export function resetPassphrase(userId: string, newPassphrase: string): void {
  const dir = readDirectory();
  const idx = dir.findIndex((e) => e.user.id === userId);
  if (idx === -1) return; // no-op on unknown user
  const next = [...dir];
  next[idx] = { ...next[idx], passphrase: newPassphrase };
  writeDirectory(next);
}

// --- provider -----------------------------------------------------------------

export class DevAuthProvider implements AuthProvider {
  async signIn(credentials?: { userId: string; passphrase: string }): Promise<Session> {
    if (!credentials) throw new Error("DevAuthProvider.signIn requires { userId, passphrase }");
    const entry = readDirectory().find((e) => e.user.id === credentials.userId);
    if (!entry || entry.passphrase !== credentials.passphrase) {
      throw new Error("Invalid user or passphrase");
    }
    const session: Session = { user: entry.user, issuedAt: new Date().toISOString(), provider: "dev" };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* ignore — session just won't survive a reload */
    }
    return session;
  }

  signOut(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  getSession(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.user) return null;
      const session = parsed as Session;
      // The stored session is a snapshot from sign-in time. The user's
      // identity (name, roles, spokes) must come from the CURRENT directory,
      // or renames/role changes made in Administration only show up after a
      // sign-out/sign-in. Re-resolve by id; a user deleted from the
      // directory means the session is no longer valid.
      const current = listUsers().find((u) => u.id === session.user.id);
      if (!current) return null;
      return { ...session, user: current };
    } catch {
      return null;
    }
  }
}

// Re-exported for the Login screen's user picker + badges (roles typed here
// so Login doesn't need its own import of Role).
export type { Role };
