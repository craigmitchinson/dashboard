import { useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import { useAuth } from "../../auth/auth-context";
import { addUser, listUsers, removeUser, resetPassphrase, updateUser } from "../../auth/dev-provider";
import type { Role, User } from "../../auth/types";
import { ROLE_LABEL, ROLE_PRIORITY } from "../../auth/types";
import {
  ConfirmDialog, Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow, InfoBanner,
  inputStyle, useSaveAnnounce,
} from "./shared";
import type { SectionProps } from "./shared";

type Draft = { name: string; email: string; roles: Role[]; spokeIds: string[] };
const blankDraft = (): Draft => ({ name: "", email: "", roles: [], spokeIds: [] });

function slugId(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
  return `u-${base}-${Date.now().toString(36).slice(-4)}`;
}

export function UsersSection({ reference }: SectionProps) {
  const t = useTheme();
  const { user: me, refreshSession } = useAuth();
  const { announce, Announcer } = useSaveAnnounce();
  const [users, setUsers] = useState<User[]>(() => listUsers());
  const spokeOptions = reference.spokes.map((s) => s.spokeName);

  // Also re-resolve the signed-in session from the directory: without this,
  // editing your own name/roles here wouldn't update the header chip or
  // greeting until the next sign-in (the session stores a user snapshot).
  const refresh = () => {
    setUsers(listUsers());
    refreshSession();
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(blankDraft());
  const [addPass, setAddPass] = useState("demo");
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPass, setNewPass] = useState("");
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const startEdit = (u: User) => {
    setEditingId(u.id);
    setDraft({ name: u.name, email: u.email, roles: u.roles, spokeIds: u.spokeIds });
    setErr(null);
  };

  const toggleRole = (roles: Role[], r: Role): Role[] => (roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);
  const toggleSpoke = (spokeIds: string[], s: string): string[] => (spokeIds.includes(s) ? spokeIds.filter((x) => x !== s) : [...spokeIds, s]);

  const validate = (d: Draft): string | null => {
    if (!d.name.trim()) return "Name is required.";
    if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) return "Enter a valid email address.";
    if (d.roles.length === 0) return "Choose at least one role.";
    return null;
  };

  const commitEdit = () => {
    if (editingId == null) return;
    const e = validate(draft);
    if (e) return setErr(e);
    updateUser(editingId, { name: draft.name.trim(), email: draft.email.trim(), roles: draft.roles, spokeIds: draft.spokeIds });
    refresh();
    setEditingId(null);
    setErr(null);
    announce("Saved.");
  };

  const commitAdd = () => {
    const e = validate(addDraft);
    if (e) return setErr(e);
    if (!addPass.trim()) return setErr("Set an initial passphrase.");
    try {
      addUser({ id: slugId(addDraft.name), name: addDraft.name.trim(), email: addDraft.email.trim(), roles: addDraft.roles, spokeIds: addDraft.spokeIds }, addPass.trim());
    } catch (ex) {
      return setErr(ex instanceof Error ? ex.message : "Could not add user.");
    }
    refresh();
    setAdding(false);
    setAddDraft(blankDraft());
    setAddPass("demo");
    setErr(null);
    announce("Saved — user added.");
  };

  const commitReset = () => {
    if (resettingId == null) return;
    if (!newPass.trim()) return setErr("Enter a new passphrase.");
    resetPassphrase(resettingId, newPass.trim());
    setResettingId(null);
    setNewPass("");
    setErr(null);
    announce("Passphrase reset.");
  };

  const confirmRemove = () => {
    if (!removeTarget) return;
    removeUser(removeTarget.id);
    refresh();
    setRemoveTarget(null);
    announce("User removed.");
  };

  return (
    <div>
      <SectionTitle title="Users & roles" helper="Who can sign in, what they can see, and which spokes they lead or belong to. Roles: admin (everything), hub lead (edits their own spoke's data), hub member (CoE-wide, read-only in Administration), business user (dashboards only, no Administration access)." />
      <InfoBanner>In production this is managed via AD group membership — see the Playbook. This screen is a working stand-in for the demo directory only.</InfoBanner>

      {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      <div style={{ marginTop: 12 }}>
        <Table>
          <thead><tr><Th>Name</Th><Th>Email</Th><Th>Roles</Th><Th>Spokes</Th><Th align="right">Actions</Th></tr></thead>
          <tbody>
            {users.length === 0 && <EmptyRow colSpan={5}>No users.</EmptyRow>}
            {users.map((u) => {
              const editing = editingId === u.id;
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <Td>{editing ? <input style={inputStyle(t)} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" /> : <>{u.name}{isSelf && <span style={{ marginLeft: 6, fontFamily: fonts.mono, fontSize: 9.5, color: t.inkSoft }}>(you)</span>}</>}</Td>
                  <Td muted>{editing ? <input style={inputStyle(t)} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} aria-label="Email" /> : u.email}</Td>
                  <Td>
                    {editing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {ROLE_PRIORITY.map((r) => (
                          <label key={r} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: fonts.body, fontSize: 11.5 }}>
                            <input type="checkbox" checked={draft.roles.includes(r)} onChange={() => setDraft({ ...draft, roles: toggleRole(draft.roles, r) })} /> {ROLE_LABEL[r]}
                          </label>
                        ))}
                      </div>
                    ) : u.roles.map((r) => ROLE_LABEL[r]).join(", ")}
                  </Td>
                  <Td muted>
                    {editing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 110, overflow: "auto" }}>
                        {spokeOptions.length === 0 && <span style={{ fontSize: 11 }}>No spokes yet</span>}
                        {spokeOptions.map((s) => (
                          <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: fonts.body, fontSize: 11.5 }}>
                            <input type="checkbox" checked={draft.spokeIds.includes(s)} onChange={() => setDraft({ ...draft, spokeIds: toggleSpoke(draft.spokeIds, s) })} /> {s}
                          </label>
                        ))}
                      </div>
                    ) : (u.spokeIds.length ? u.spokeIds.join(", ") : "—")}
                  </Td>
                  <Td align="right">
                    {editing ? (
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <GhostButton onClick={commitEdit}>Save</GhostButton>
                        <GhostButton onClick={() => setEditingId(null)}>Cancel</GhostButton>
                      </div>
                    ) : resettingId === u.id ? (
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, alignItems: "center" }}>
                        <input type="password" style={inputStyle(t, { width: 130 })} value={newPass} onChange={(e) => setNewPass(e.target.value)} aria-label="New passphrase" placeholder="New passphrase" />
                        <GhostButton onClick={commitReset}>Confirm</GhostButton>
                        <GhostButton onClick={() => setResettingId(null)}>Cancel</GhostButton>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <GhostButton onClick={() => startEdit(u)}>Edit</GhostButton>
                        <GhostButton onClick={() => { setResettingId(u.id); setNewPass(""); }}>Reset passphrase</GhostButton>
                        <DangerButton onClick={() => setRemoveTarget(u)} disabled={isSelf} title={isSelf ? "You can't remove your own signed-in account." : undefined}>Remove</DangerButton>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {adding ? (
        <div style={{ border: `1px dashed ${t.ruleSoft}`, borderRadius: 10, padding: 14, marginTop: 12, display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Field id="ua-name" label="Name" width={200}><input id="ua-name" style={inputStyle(t)} value={addDraft.name} onChange={(e) => setAddDraft({ ...addDraft, name: e.target.value })} /></Field>
            <Field id="ua-email" label="Email" width={220}><input id="ua-email" type="email" style={inputStyle(t)} value={addDraft.email} onChange={(e) => setAddDraft({ ...addDraft, email: e.target.value })} /></Field>
            <Field id="ua-pass" label="Initial passphrase" width={160}><input id="ua-pass" style={inputStyle(t)} value={addPass} onChange={(e) => setAddPass(e.target.value)} /></Field>
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <span style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>Roles</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                {ROLE_PRIORITY.map((r) => (
                  <label key={r} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: fonts.body, fontSize: 12.5 }}>
                    <input type="checkbox" checked={addDraft.roles.includes(r)} onChange={() => setAddDraft({ ...addDraft, roles: toggleRole(addDraft.roles, r) })} /> {ROLE_LABEL[r]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <span style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>Spokes</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4, maxHeight: 110, overflow: "auto" }}>
                {spokeOptions.length === 0 && <span style={{ fontSize: 12, color: t.inkSoft }}>No spokes yet</span>}
                {spokeOptions.map((s) => (
                  <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: fonts.body, fontSize: 12.5 }}>
                    <input type="checkbox" checked={addDraft.spokeIds.includes(s)} onChange={() => setAddDraft({ ...addDraft, spokeIds: toggleSpoke(addDraft.spokeIds, s) })} /> {s}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <PrimaryButton onClick={commitAdd}>Add user</PrimaryButton>
            <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}><PrimaryButton onClick={() => { setAdding(true); setAddDraft(blankDraft()); setAddPass("demo"); }}>+ Add user</PrimaryButton></div>
      )}

      {removeTarget && (
        <ConfirmDialog
          title={`Remove ${removeTarget.name}?`}
          body={`${removeTarget.name} (${removeTarget.email}) will no longer be able to sign in. This can't be undone from here.`}
          confirmLabel="Remove user"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
      <Announcer />
    </div>
  );
}
