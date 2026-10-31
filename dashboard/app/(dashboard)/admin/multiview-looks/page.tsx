"use client";

/**
 * Admin → Multi-View Looks
 *
 * Mirrors the Admin → Broadcast Graphics upload flow (see ../broadcast-graphics/page.tsx), adapted
 * for a different delivery mechanism: a Multi-View look is a full standalone HTML *page* (not a
 * DOM fragment), because OBS's browser source needs a real URL to point at. The desktop app
 * downloads the package, writes its html to a local file and points a browser source at it — see
 * desktop/src/multiview/customLookCatalog.ts and the `save_dock_html` Tauri command.
 *
 * Judgment call: unlike Broadcast Graphics, this v1 has no tiers/audience gating — every plan can
 * use an uploaded look once it's Active. Just status: Active (listed + usable), Paused (listed,
 * can't be added), Unavailable (not listed).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Download,
  Eye,
  FileUp,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  LayoutGrid,
  Trash2,
  Upload,
  EyeOff,
  XCircle,
} from "lucide-react";

type LookStatus = "active" | "paused" | "hidden";

interface CameraSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: "rect" | "circle";
}

interface LookPackage {
  format?: string;
  id: string;
  version?: number;
  name: string;
  description?: string;
  html: string;
  cameraSlot: CameraSlot;
}

interface Look {
  lookId: string;
  name: string;
  description: string;
  status: LookStatus;
  sortOrder: number;
  version: number;
  package: LookPackage;
  updatedAt: string;
}

const STATUS_META: Record<LookStatus, { label: string; hint: string; className: string }> = {
  active: { label: "Active", hint: "Listed and usable", className: "adm-badge--success" },
  paused: { label: "Paused", hint: "Listed, but no one can add it", className: "adm-badge--warning" },
  hidden: { label: "Unavailable", hint: "Not listed in the app", className: "" },
};

/**
 * Read an uploaded file. A .json file is the package itself. An .html file is the complete
 * overlay page, with its metadata embedded as:
 *   <script type="application/json" id="mce-multiview-look">{ id, name, description, cameraSlot }</script>
 * The whole file (metadata script included — it's inert JSON, never executed) becomes the
 * package's `html`, since OBS needs to load this exact page as-is.
 */
async function readLookFile(file: File): Promise<LookPackage> {
  const text = await file.text();
  if (/\.json$/i.test(file.name) || text.trim().startsWith("{")) {
    return JSON.parse(text) as LookPackage;
  }
  const doc = new DOMParser().parseFromString(text, "text/html");
  const meta = doc.querySelector<HTMLScriptElement>("script#mce-multiview-look");
  if (!meta) {
    throw new Error('The HTML file needs <script type="application/json" id="mce-multiview-look"> with id, name, description and cameraSlot.');
  }
  const manifest = JSON.parse(meta.textContent || "{}") as Partial<LookPackage>;
  if (!manifest.cameraSlot) throw new Error("The metadata script needs a cameraSlot (x, y, width, height).");
  return {
    format: "mce-multiview-look@1",
    id: manifest.id || "",
    version: manifest.version,
    name: manifest.name || "",
    description: manifest.description || "",
    cameraSlot: manifest.cameraSlot,
    html: text,
  };
}

function checkPackage(pkg: LookPackage): string | null {
  if (!pkg || typeof pkg !== "object") return "This is not a Multi-View look package.";
  if (!pkg.name) return "The look needs a name.";
  if (!pkg.html || !pkg.html.trim()) return "The look needs html (the overlay page's full markup).";
  if (!/<html[\s>]/i.test(pkg.html) || !/<\/html>/i.test(pkg.html)) return "The html must be a complete standalone page (needs <html>…</html>), not a fragment.";
  if (!pkg.cameraSlot || typeof pkg.cameraSlot.width !== "number" || typeof pkg.cameraSlot.height !== "number") {
    return "The look needs a cameraSlot (x, y, width, height in 1920×1080 design pixels).";
  }
  return null;
}

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Draft = { pkg: LookPackage; fileName: string; status: LookStatus; replaceId?: string };

export default function AdminMultiviewLooksPage() {
  const [looks, setLooks] = useState<Look[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Look | null>(null);
  const [preview, setPreview] = useState<Look | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const notify = useCallback((type: "success" | "error", message: string) => setToast({ type, message }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/multiview-looks", { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to load Multi-View looks");
      setLooks(Array.isArray(body.looks) ? body.looks : []);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Failed to load Multi-View looks");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback(async (look: Look, changes: Partial<Pick<Look, "status" | "name">>) => {
    setBusyId(look.lookId);
    setLooks((list) => list.map((x) => (x.lookId === look.lookId ? { ...x, ...changes } : x)));
    try {
      const res = await fetch(`/api/admin/multiview-looks/${encodeURIComponent(look.lookId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to update");
      setLooks((list) => list.map((x) => (x.lookId === look.lookId ? { ...x, ...body.look } : x)));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Failed to update");
      void load();
    } finally {
      setBusyId(null);
    }
  }, [load, notify]);

  const remove = useCallback(async (look: Look) => {
    setBusyId(look.lookId);
    try {
      const res = await fetch(`/api/admin/multiview-looks/${encodeURIComponent(look.lookId)}`, { method: "DELETE", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed");
      notify("success", `"${look.name}" deleted. It disappears from desktop apps the next time they're online.`);
      setDeleteTarget(null);
      await load();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }, [load, notify]);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const pkg = await readLookFile(file);
      const problem = checkPackage(pkg);
      if (problem) throw new Error(problem);
      const replaceId = replaceTarget.current || undefined;
      const existing = looks.find((l) => l.lookId === (replaceId || pkg.id));
      setDraft({ pkg, fileName: file.name, status: existing?.status ?? "active", replaceId });
    } catch (error) {
      notify("error", error instanceof Error ? `Couldn't read ${file.name}: ${error.message}` : "Couldn't read the file");
    } finally {
      replaceTarget.current = null;
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [looks, notify]);

  const publish = useCallback(async () => {
    if (!draft) return;
    setBusyId("__publish");
    try {
      const res = await fetch("/api/admin/multiview-looks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: draft.pkg, status: draft.status, replaceId: draft.replaceId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to publish");
      notify("success", `"${body.look?.name || draft.pkg.name}" is published (version ${body.look?.version ?? 1}). Desktop apps get it the next time they're online.`);
      setDraft(null);
      await load();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Failed to publish");
    } finally {
      setBusyId(null);
    }
  }, [draft, load, notify]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return looks;
    return looks.filter((l) => [l.name, l.lookId, l.description].some((v) => (v || "").toLowerCase().includes(q)));
  }, [looks, search]);

  const counts = useMemo(() => ({
    total: looks.length,
    paused: looks.filter((l) => l.status === "paused").length,
    hidden: looks.filter((l) => l.status === "hidden").length,
  }), [looks]);

  return (
    <div className="adm-page">
      {toast && (
        <div
          className={cn(
            "fixed right-6 top-6 z-50 flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg text-white",
          )}
          style={{ background: toast.type === "success" ? "var(--mce-admin-success)" : "var(--mce-admin-danger)" }}
        >
          {toast.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".html,.htm,.json,application/json,text/html" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

      <div className="adm-header">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "var(--mce-admin-accent-soft)", color: "var(--mce-admin-accent-bright)" }}>
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <h1 className="adm-title">Multi-View Looks</h1>
            <p className="adm-subtitle max-w-2xl">
              Custom-branded Multi-View camera + verse looks, uploaded here and delivered to every desktop app the next
              time it&apos;s online — no app update needed. Apps keep a cached copy, so a look keeps working offline.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="adm-btn" onClick={() => setShowGuide((v) => !v)}><BookOpen className="h-4 w-4" /> Format guide</button>
          <button type="button" className="adm-btn" onClick={() => void load()}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh</button>
          <button type="button" className="adm-btn adm-btn--primary" onClick={() => { replaceTarget.current = null; fileRef.current?.click(); }}><Upload className="h-4 w-4" /> Upload look</button>
        </div>
      </div>

      {showGuide && <FormatGuide />}

      <div className="mb-5 grid grid-cols-3 gap-3">
        {[["Looks", counts.total], ["Paused", counts.paused], ["Unavailable", counts.hidden]].map(([label, n]) => (
          <div key={String(label)} className="adm-card p-4">
            <div className="adm-stat__label">{label}</div>
            <div className="adm-stat__value">{n}</div>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <label className="flex h-9 max-w-sm items-center gap-2 rounded-lg px-3 adm-input" style={{ display: "flex" }}>
          <Search className="h-4 w-4" style={{ color: "var(--mce-admin-text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search looks" className="min-w-0 flex-1 bg-transparent outline-none" style={{ color: "var(--mce-admin-text)" }} />
        </label>
      </div>

      <div className="adm-card">
        {loading ? (
          <div className="adm-empty flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading looks</div>
        ) : filtered.length === 0 ? (
          <div className="adm-empty">No looks uploaded yet. Upload your first one above.</div>
        ) : filtered.map((look) => (
          <div key={look.lookId} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", busyId === look.lookId && "opacity-60")} style={{ borderBottom: "1px solid var(--mce-admin-border)" }}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong style={{ color: "var(--mce-admin-text)" }}>{look.name}</strong>
                <span className="adm-badge adm-badge--info">v{look.version}</span>
              </div>
              <p className="adm-hint !mt-0.5">{look.lookId}{look.description ? ` · ${look.description}` : ""}</p>
            </div>
            <select
              value={look.status}
              disabled={busyId === look.lookId}
              onChange={(e) => void patch(look, { status: e.target.value as LookStatus })}
              title={STATUS_META[look.status].hint}
              className="adm-input"
              style={{ width: 160 }}
            >
              {(Object.keys(STATUS_META) as LookStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <button type="button" className="adm-icon-btn" title="Preview" onClick={() => setPreview(look)}><Eye className="h-4 w-4" /></button>
              <button type="button" className="adm-icon-btn" title="Upload a new version" onClick={() => { replaceTarget.current = look.lookId; fileRef.current?.click(); }}><FileUp className="h-4 w-4" /></button>
              {look.status !== "paused"
                ? <button type="button" className="adm-icon-btn" title="Pause" onClick={() => void patch(look, { status: "paused" })}><PauseCircle className="h-4 w-4" /></button>
                : <button type="button" className="adm-icon-btn" title="Make active" onClick={() => void patch(look, { status: "active" })}><PlayCircle className="h-4 w-4" /></button>}
              {look.status !== "hidden" && <button type="button" className="adm-icon-btn" title="Make unavailable" onClick={() => void patch(look, { status: "hidden" })}><EyeOff className="h-4 w-4" /></button>}
              <button type="button" className="adm-icon-btn" title="Delete" style={{ color: "var(--mce-admin-danger)" }} onClick={() => setDeleteTarget(look)}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <Modal title={draft.replaceId ? `New version of ${draft.replaceId}` : "Publish a new Multi-View look"} onClose={() => setDraft(null)}>
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--mce-admin-text)" }}>{draft.pkg.name}</div>
              <p className="adm-hint">{draft.fileName} · camera slot {draft.pkg.cameraSlot.width}×{draft.pkg.cameraSlot.height} at ({draft.pkg.cameraSlot.x}, {draft.pkg.cameraSlot.y}) · id <code className="adm-code">{draft.replaceId || draft.pkg.id}</code></p>
              {draft.pkg.description && <p className="adm-hint">{draft.pkg.description}</p>}
            </div>
            <label className="block">
              <span className="adm-label">Status</span>
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as LookStatus })} className="adm-input">
                {(Object.keys(STATUS_META) as LookStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label} — {STATUS_META[s].hint}</option>)}
              </select>
            </label>
            <button type="button" disabled={busyId === "__publish"} onClick={() => void publish()} className="adm-btn adm-btn--primary w-full justify-center" style={{ height: 40, width: "100%" }}>
              {busyId === "__publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Publish to desktop apps
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title={`Delete "${deleteTarget.name}"?`} onClose={() => setDeleteTarget(null)}>
          <p className="adm-hint !mt-0 mb-4">
            It disappears from every desktop app the next time it&apos;s online. Churches who already added it to a scene
            keep what they built, but can&apos;t add it again.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button type="button" className="adm-btn adm-btn--danger" onClick={() => void remove(deleteTarget)}>Delete</button>
          </div>
        </Modal>
      )}

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} wide>
          <iframe
            title={preview.name}
            srcDoc={preview.package?.html}
            style={{ width: "100%", aspectRatio: "16/9", border: "1px solid var(--mce-admin-border)", borderRadius: 8, background: "#000" }}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 py-8" role="dialog" aria-modal="true">
      <div className="adm-card w-full p-5" style={{ maxWidth: wide ? 920 : 520, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--mce-admin-text)" }}>{title}</h2>
          <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormatGuide() {
  return (
    <div className="adm-card mb-5 p-5 space-y-3" style={{ fontSize: 13, color: "var(--mce-admin-text-secondary)" }}>
      <p>
        A Multi-View look is <strong>one complete, standalone HTML page</strong> — the same kind of file as the
        app&apos;s bundled Scripture Circle/Arch/Gold Circle panels — not a fragment. OBS&apos;s browser source needs a
        real URL to point at, so this page is what the desktop app writes to disk and loads in OBS, and also what it
        shows in the in-app editor preview.
      </p>
      <p>Upload either:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>a single <code className="adm-code">.html</code> file — your whole page, with this metadata block embedded anywhere in it:</li>
      </ul>
      <pre className="adm-code adm-input" style={{ height: "auto", padding: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
{`<script type="application/json" id="mce-multiview-look">
{
  "id": "my-church-look",
  "name": "My Church Look",
  "description": "Camera + verse panel with our branding",
  "cameraSlot": { "x": 80, "y": 260, "width": 860, "height": 640, "shape": "rect" }
}
</script>`}
      </pre>
      <ul className="list-disc pl-5 space-y-1">
        <li>or a raw <code className="adm-code">.json</code> package: <code className="adm-code">{"{ format: \"mce-multiview-look@1\", id, name, description, html, cameraSlot }"}</code>.</li>
      </ul>
      <p><strong>cameraSlot</strong> is where the camera shows through, in 1920×1080 design pixels. Leave that exact rectangle fully transparent in your page (no background, no fill) — the app crops the operator&apos;s chosen camera scene into that rectangle and places it underneath your page, the same transparent-hole technique the Scripture Circle family uses (an opaque page with one cut-out, so no OBS mask filter is needed). <code className="adm-code">shape</code> is <code className="adm-code">&quot;rect&quot;</code> or <code className="adm-code">&quot;circle&quot;</code>.</p>
      <p>
        To make a Bible verse update live on your panel — exactly like every other Scripture look — copy this block
        verbatim into your page&apos;s script (it listens for the same packets every Bible overlay in the app
        broadcasts; see the Excellent Glory / Summit 2026 example for a full, working copy):
      </p>
      <pre className="adm-code adm-input" style={{ height: "auto", padding: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
{`var params = new URLSearchParams(location.search);
var tabParam = params.get("tab") || "bible";
var DEFAULT_SLIDE = { text: "Your sample verse…", reference: "Book 1:1 (KJV)" };

function handlePacket(packet) {
  if (!packet || typeof packet !== "object") return;
  if (packet.channel && packet.channel !== tabParam) return;
  var data = packet.data && typeof packet.data === "object" ? packet.data : packet;
  if (data.live && data.slide && !data.blanked) show(data.slide);
}
function readFromLocalStorage() {
  try {
    var raw = localStorage.getItem("bible-overlay-data");
    if (raw) handlePacket(JSON.parse(raw));
  } catch (e) {}
}
function connectRelay() {
  if (!("WebSocket" in window)) return;
  function open() {
    var ws = new WebSocket("ws://127.0.0.1:17891");
    ws.onmessage = function (e) { try { handlePacket(JSON.parse(e.data)); } catch (err) {} };
    ws.onclose = function () { setTimeout(open, 2000); };
  }
  open();
}
show(DEFAULT_SLIDE);
if (!params.get("preview")) {
  readFromLocalStorage();
  connectRelay();
  try {
    new BroadcastChannel("obs-church-studio-bible-overlay").onmessage = function (e) { handlePacket(e.data); };
  } catch (e) {}
}`}
      </pre>
      <p>
        Any setting that should differ church to church (a URL, a handle, a colour) should come from the query
        string, the same way <code className="adm-code">?wedge=</code>/<code className="adm-code">?paper=</code> work
        on the bundled Scripture Circle panel — that way one uploaded page can be reused with different branding
        text by setting the fields in the desktop editor.
      </p>
      <p>
        Markup and scripts run inside the church&apos;s own OBS and the in-app editor preview, so keep the page safe:
        no remote script tags from untrusted sources, and nothing that reads data this app doesn&apos;t already expose.
      </p>
    </div>
  );
}
