import { useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import type { SpokeRef } from "../../reference/reference-store";
import {
  ContrastHint, Field, GhostButton, PrimaryButton, SectionTitle, Table, Td, Th, EmptyRow,
  inputStyle, useSectionSave, InfoBanner,
} from "./shared";
import type { SectionProps } from "./shared";

type Draft = { spokeName: string; shortName: string; colorLight: string; colorDark: string };
const BLANK: Draft = { spokeName: "", shortName: "", colorLight: "#0B3239", colorDark: "#86C7BD" };

export function SquadsSection({ reference, update, actor, isAdmin }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(BLANK);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(BLANK);
  const [err, setErr] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div>
        <SectionTitle title="Squads (spokes)" helper="Every spoke's identity — its short code and light/dark accent colours used across every chart and the spoke slicer. Read-only for your role." />
        <SquadsTable reference={reference} readOnly onEdit={() => {}} />
        <Announcer />
      </div>
    );
  }

  const startEdit = (s: SpokeRef) => {
    setEditingId(s.spokeId);
    setEditDraft({ spokeName: s.spokeName, shortName: s.shortName, colorLight: s.colorLight, colorDark: s.colorDark });
    setErr(null);
  };

  const validate = (d: Draft, excludeId: number | null): string | null => {
    if (!d.spokeName.trim()) return "Spoke name is required.";
    if (!d.shortName.trim()) return "Short name is required.";
    if (reference.spokes.some((s) => s.spokeId !== excludeId && s.spokeName.toLowerCase() === d.spokeName.trim().toLowerCase())) return "A spoke with that name already exists.";
    return null;
  };

  const commitEdit = () => {
    const e = validate(editDraft, editingId);
    if (e) return setErr(e);
    save("spokes", (draft) => {
      draft.spokes = draft.spokes.map((s) => (s.spokeId === editingId ? { ...s, ...editDraft, spokeName: editDraft.spokeName.trim(), shortName: editDraft.shortName.trim() } : s));
    });
    setEditingId(null);
    setErr(null);
  };

  const commitAdd = () => {
    const e = validate(addDraft, null);
    if (e) return setErr(e);
    const nextId = reference.spokes.length ? Math.max(...reference.spokes.map((s) => s.spokeId)) + 1 : 1;
    save("spokes", (draft) => {
      draft.spokes = [...draft.spokes, { spokeId: nextId, spokeName: addDraft.spokeName.trim(), shortName: addDraft.shortName.trim(), colorLight: addDraft.colorLight, colorDark: addDraft.colorDark }];
    }, "Saved — new spoke is live. Add its propositions, processes and VDIs in the tabs to the left.");
    setAdding(false);
    setAddDraft(BLANK);
    setErr(null);
  };

  return (
    <div>
      <SectionTitle title="Squads (spokes)" helper="Every spoke's identity — its short code and light/dark accent colours used across every chart and the spoke slicer. Adding a spoke here makes it immediately available to assign propositions, processes, VDIs and people-cost history in the tabs to the left." />

      <InfoBanner>
        A new spoke appears in the spoke slicer straight away. It won't show any activity until real work-queue data for its processes flows through the next data build — that's expected for a spoke with no history yet.
      </InfoBanner>

      <div style={{ marginTop: 12 }}>
        <SquadsTable
          reference={reference}
          readOnly={false}
          editingId={editingId}
          editDraft={editDraft}
          setEditDraft={setEditDraft}
          onEdit={startEdit}
          onCancel={() => { setEditingId(null); setErr(null); }}
          onSave={commitEdit}
        />
      </div>

      {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, marginTop: 8 }}>{err}</p>}

      <div style={{ marginTop: 16 }}>
        {!adding ? (
          <PrimaryButton onClick={() => { setAdding(true); setAddDraft(BLANK); setErr(null); }}>+ Add spoke</PrimaryButton>
        ) : (
          <div style={{ border: `1px dashed ${t.ruleSoft}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10, maxWidth: 620 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Field id="sq-add-name" label="Spoke name" width={220}>
                <input id="sq-add-name" style={inputStyle(t)} value={addDraft.spokeName} onChange={(e) => setAddDraft({ ...addDraft, spokeName: e.target.value })} placeholder="e.g. Commercial" />
              </Field>
              <Field id="sq-add-short" label="Short name" width={140}>
                <input id="sq-add-short" style={inputStyle(t)} value={addDraft.shortName} onChange={(e) => setAddDraft({ ...addDraft, shortName: e.target.value })} placeholder="e.g. COM" />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field id="sq-add-light" label="Light-mode colour" width={160}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input id="sq-add-light" type="color" value={addDraft.colorLight} onChange={(e) => setAddDraft({ ...addDraft, colorLight: e.target.value })} style={{ width: 34, height: 30, padding: 0, border: `1px solid ${t.ruleSoft}`, borderRadius: 6, background: "none" }} />
                  <ContrastHint fg={addDraft.colorLight} bg="#FAF7F2" label="light" />
                </div>
              </Field>
              <Field id="sq-add-dark" label="Dark-mode colour" width={160}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input id="sq-add-dark" type="color" value={addDraft.colorDark} onChange={(e) => setAddDraft({ ...addDraft, colorDark: e.target.value })} style={{ width: 34, height: 30, padding: 0, border: `1px solid ${t.ruleSoft}`, borderRadius: 6, background: "none" }} />
                  <ContrastHint fg={addDraft.colorDark} bg="#0C2329" label="dark" />
                </div>
              </Field>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <PrimaryButton onClick={commitAdd}>Save spoke</PrimaryButton>
              <GhostButton onClick={() => { setAdding(false); setErr(null); }}>Cancel</GhostButton>
            </div>
          </div>
        )}
      </div>
      <Announcer />
    </div>
  );
}

function SquadsTable({
  reference, readOnly, editingId, editDraft, setEditDraft, onEdit, onCancel, onSave,
}: {
  reference: SectionProps["reference"];
  readOnly: boolean;
  editingId?: number | null;
  editDraft?: Draft;
  setEditDraft?: (d: Draft) => void;
  onEdit: (s: SpokeRef) => void;
  onCancel?: () => void;
  onSave?: () => void;
}) {
  const t = useTheme();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Spoke</Th>
          <Th>Short</Th>
          <Th align="center">Light accent</Th>
          <Th align="center">Dark accent</Th>
          {!readOnly && <Th align="right">Actions</Th>}
        </tr>
      </thead>
      <tbody>
        {reference.spokes.length === 0 && <EmptyRow colSpan={readOnly ? 4 : 5}>No spokes yet.</EmptyRow>}
        {reference.spokes.map((s) => {
          const editing = editingId === s.spokeId && editDraft && setEditDraft;
          return (
            <tr key={s.spokeId}>
              <Td>{editing ? <input style={inputStyle(t)} value={editDraft.spokeName} onChange={(e) => setEditDraft({ ...editDraft, spokeName: e.target.value })} aria-label="Spoke name" /> : <strong style={{ fontFamily: fonts.body }}>{s.spokeName}</strong>}</Td>
              <Td>{editing ? <input style={inputStyle(t)} value={editDraft.shortName} onChange={(e) => setEditDraft({ ...editDraft, shortName: e.target.value })} aria-label="Short name" /> : s.shortName}</Td>
              <Td align="center">
                {editing ? (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
                    <input type="color" aria-label="Light-mode colour" value={editDraft.colorLight} onChange={(e) => setEditDraft({ ...editDraft, colorLight: e.target.value })} style={{ width: 30, height: 26, padding: 0, border: `1px solid ${t.ruleSoft}`, borderRadius: 6 }} />
                    <ContrastHint fg={editDraft.colorLight} bg="#FAF7F2" label="light" />
                  </div>
                ) : (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 13, height: 13, borderRadius: "50%", background: s.colorLight, border: `1px solid ${t.ruleSoft}` }} />
                    <span style={{ fontFamily: fonts.mono, fontSize: 11 }}>{s.colorLight}</span>
                  </div>
                )}
              </Td>
              <Td align="center">
                {editing ? (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
                    <input type="color" aria-label="Dark-mode colour" value={editDraft.colorDark} onChange={(e) => setEditDraft({ ...editDraft, colorDark: e.target.value })} style={{ width: 30, height: 26, padding: 0, border: `1px solid ${t.ruleSoft}`, borderRadius: 6 }} />
                    <ContrastHint fg={editDraft.colorDark} bg="#0C2329" label="dark" />
                  </div>
                ) : (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 13, height: 13, borderRadius: "50%", background: s.colorDark, border: `1px solid ${t.ruleSoft}` }} />
                    <span style={{ fontFamily: fonts.mono, fontSize: 11 }}>{s.colorDark}</span>
                  </div>
                )}
              </Td>
              {!readOnly && (
                <Td align="right">
                  {editing ? (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <GhostButton onClick={onSave}>Save</GhostButton>
                      <GhostButton onClick={onCancel}>Cancel</GhostButton>
                    </div>
                  ) : (
                    <GhostButton onClick={() => onEdit(s)}>Edit</GhostButton>
                  )}
                </Td>
              )}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
