import { useEffect, useMemo, useRef, useState } from "react";
import { fonts, glassOverlayVars } from "../theme";
import { useTheme } from "../theme-context";
import { Portal } from "../components/Portal";
import { IconClose, IconSearch } from "../components/icons";
import { SECTIONS } from "./catalogue-data";
import { sectionIdForPage, metricIdsForPage } from "./page-mapping";
import { MarkdownBody, MarkdownTable } from "./MarkdownBody";
import { startTour } from "./help-store";

// ---------------------------------------------------------------------------
// help/HelpDrawer.tsx
// ---------------------------------------------------------------------------
// Right-side, portalled, focus-trapped drawer — same modal chrome pattern as
// src/a11y/DisplayPanel.tsx (focus moves in on mount and is trapped inside,
// Escape closes, focus returns to whatever opened it on unmount). Content
// comes from ONE source, docs/feature-catalogue.data.mjs, dynamically
// imported only when this chunk loads (see HelpRoot.tsx's nested lazy()) so
// the catalogue's text never ships in the app's main bundle.
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface HelpDrawerProps {
  pageId: string;
  isAdmin: boolean;
  onClose: () => void;
  go: (id: string) => void;
}

export function HelpDrawer({ pageId, isAdmin, onClose, go }: HelpDrawerProps) {
  const t = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");

  const requestClose = () => {
    const o = openerRef.current;
    if (o && o !== document.body && document.contains(o)) o.focus();
    onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (openerRef.current == null) {
      openerRef.current = document.activeElement as HTMLElement | null;
    }
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const o = openerRef.current;
      if (o && o !== document.body && document.contains(o) && (document.activeElement === document.body || document.activeElement === null)) {
        o.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectionId = sectionIdForPage(pageId);
  const section = useMemo(() => SECTIONS.find((s) => s.id === sectionId), [sectionId]);
  const metricsSection = useMemo(() => SECTIONS.find((s) => s.id === "metrics"), []);
  const allowlist = useMemo(() => metricIdsForPage(pageId), [pageId]);
  const metricItems = useMemo(
    () => (metricsSection?.items ?? []).filter((it) => allowlist.includes(it.id)),
    [metricsSection, allowlist],
  );

  const q = query.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!section) return [];
    if (!q) return section.items;
    return section.items.filter((it) => it.title.toLowerCase().includes(q) || (it.body ?? "").toLowerCase().includes(q));
  }, [section, q]);
  const filteredMetrics = useMemo(() => {
    if (!q) return metricItems;
    return metricItems.filter((it) => it.title.toLowerCase().includes(q) || (it.body ?? "").toLowerCase().includes(q));
  }, [metricItems, q]);

  return (
    <Portal>
      <div
        className="modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-drawer-title"
          className="modal-dialog glass-overlay"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            left: "auto",
            bottom: 0,
            margin: 0,
            width: "min(420px, 100vw)",
            maxWidth: "min(420px, 100vw)",
            maxHeight: "100vh",
            height: "100vh",
            overflowY: "auto",
            borderRadius: 0,
            borderLeft: `1px solid ${t.ruleSoft}`,
            padding: 20,
            color: t.ink,
            ...glassOverlayVars(t),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <h2 id="help-drawer-title" style={{ margin: 0, fontFamily: fonts.display, fontSize: 18, fontWeight: 700, color: t.ink }}>
              {section?.title ?? "Help"}
            </h2>
            <button ref={closeBtnRef} aria-label="Close help" onClick={requestClose} className="a11y-seg-btn" style={{ color: t.ink, borderColor: t.ruleSoft }}>
              <IconClose size={20} />
            </button>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 14,
              padding: "6px 10px",
              border: `1px solid ${t.ruleSoft}`,
              borderRadius: 8,
            }}
          >
            <IconSearch size={14} style={{ color: t.inkSoft, flex: "0 0 auto" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this page's help…"
              aria-label="Search this page's help"
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: t.ink, fontFamily: fonts.body, fontSize: 13 }}
            />
          </div>

          {section?.intro && (
            <div style={{ marginTop: 14 }}>
              <MarkdownBody text={section.intro} t={t} />
            </div>
          )}

          {section &&
            filteredItems.map((it) => (
              <section key={it.id} style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${t.ruleSoft}` }}>
                <h3 style={{ margin: "0 0 6px", fontFamily: fonts.display, fontSize: 13.5, fontWeight: 700, color: t.ink }}>{it.title}</h3>
                {it.body && <MarkdownBody text={it.body} t={t} />}
                {it.table && <MarkdownTable table={it.table} t={t} />}
              </section>
            ))}

          {section && filteredItems.length === 0 && (
            <p style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, marginTop: 16 }}>No matching help items.</p>
          )}
          {!section && <p style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, marginTop: 16 }}>No help is available for this page yet.</p>}

          {filteredMetrics.length > 0 && (
            <section style={{ marginTop: 20, paddingTop: 14, borderTop: `2px solid ${t.ruleSoft}` }}>
              <h3
                style={{
                  margin: "0 0 8px",
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: t.inkSoft,
                }}
              >
                Metric definitions on this page
              </h3>
              {filteredMetrics.map((it) => (
                <div key={it.id} style={{ marginBottom: 12 }}>
                  <h4 style={{ margin: "0 0 4px", fontFamily: fonts.display, fontSize: 13, fontWeight: 700, color: t.ink }}>{it.title}</h4>
                  {it.body && <MarkdownBody text={it.body} t={t} />}
                </div>
              ))}
            </section>
          )}

          <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${t.ruleSoft}`, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => {
                requestClose();
                startTour();
              }}
              style={{ textAlign: "left", fontFamily: fonts.body, fontSize: 13, fontWeight: 700, border: "none", background: "transparent", color: t.accent, cursor: "pointer", padding: "6px 0" }}
            >
              Take the tour again
            </button>
            {isAdmin && (
              <button
                onClick={() => {
                  go("playbook");
                  requestClose();
                }}
                style={{ textAlign: "left", fontFamily: fonts.body, fontSize: 13, fontWeight: 700, border: "none", background: "transparent", color: t.accent, cursor: "pointer", padding: "6px 0" }}
              >
                Open the Playbook
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
