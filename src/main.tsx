import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initData } from "./rpaData";
import "./styles.css";

// ---------------------------------------------------------------------------
// Data boot. THE SWAP POINT for the frontend:
//   - default: the static /data/model.json baked by `npm run data:build`
//     (mock CSV today, a real export tomorrow — same schema, same file)
//   - production: set VITE_DATA_URL to an API endpoint that returns the same
//     JSON shape over the live warehouse (e.g. Cloud Run service in front of
//     Cloud SQL) and rebuild — nothing else in the app changes.
// Data is loaded and installed BEFORE the first render, so every module reads
// fully-populated bindings.
// ---------------------------------------------------------------------------
const DATA_URL: string = import.meta.env.VITE_DATA_URL || `${import.meta.env.BASE_URL}data/model.json`;

const root = createRoot(document.getElementById("root")!);

async function boot() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Data source returned ${res.status} ${res.statusText}`);
  initData(await res.json());
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot().catch((err) => {
  root.render(
    <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "#071316", color: "#f4f1eb", fontFamily: "Carlito, Calibri, sans-serif" }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Couldn't load dashboard data</h1>
        <p style={{ opacity: 0.75, fontSize: 14, lineHeight: 1.6 }}>
          Failed to fetch <code>{DATA_URL}</code> — {String(err?.message ?? err)}.
          <br />
          Run <code>npm run data:build</code> to generate it from the CSV, or point
          <code> VITE_DATA_URL</code> at a live data API.
        </p>
      </div>
    </div>,
  );
});
