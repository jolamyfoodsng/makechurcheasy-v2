/**
 * GivingBankFields — the bank rows of the "Giving Accounts Board" graphic.
 *
 * Pick how many banks to show (1–6), type a bank's name and its logo is found for you, or upload one.
 * Everything is stored in the graphic's ordinary fields (bank1…6, num1…6, logo1…6): a bank with an empty
 * name is hidden by the graphic, so "how many" simply fills or empties the names.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveBankLogo, searchBanks, type BankSuggestion } from "../../lowerthirds/bankCatalog";
import { resolveOverlayAssetUrl } from "../../lowerthirds/runtimeBranding";
import { getSafeFileName, saveToDisk } from "../dockUploadService";

export const MAX_GIVING_BANKS = 6;
const SLOTS = Array.from({ length: MAX_GIVING_BANKS }, (_, i) => i + 1);

/** True for the graphic that has numbered bank / account / logo fields. */
export function hasGivingBankFields(keys: Iterable<string>): boolean {
  const set = new Set(keys);
  return set.has("bank1") && set.has("num1") && set.has("logo1");
}

/** Keys the rows replace in the generic field list. */
export function isGivingBankFieldKey(key: string): boolean {
  return /^(bank|num|logo)[1-6]$/.test(key);
}

/** How many banks are showing: the filled-in names, at least one. */
export function countShownBanks(values: Record<string, string | undefined>): number {
  const filled = SLOTS.filter((i) => (values[`bank${i}`] ?? "").trim() !== "").length;
  return Math.max(1, filled);
}

interface Props {
  /** "dock" uses the Dock's field styles; "app" the Broadcast Graphics page's. */
  variant?: "dock" | "app";
  values: Record<string, string>;
  /** The graphic's own defaults, used when a hidden bank is switched back on. */
  defaults: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
}

const row: React.CSSProperties = { display: "flex", gap: 6, alignItems: "flex-start" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box" };
const small: React.CSSProperties = { fontSize: 10, color: "var(--dock-text-dim, var(--text-secondary))" };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** Save a logo with the church's own files; fall back to the picture itself when there is no upload API. */
async function persistLogo(file: File): Promise<string> {
  try {
    const savedPath = await saveToDisk(file, `bank_logo_${Date.now()}_${getSafeFileName(file.name)}`);
    const url = resolveOverlayAssetUrl(savedPath);
    if (url && !url.startsWith("blob:")) return url;
  } catch {
    // Browser without the local upload API: keep the picture inside the graphic instead.
  }
  return readAsDataUrl(file);
}

/** True when the picture at `url` shows in an <img> (used when the logo can't be downloaded and saved). */
function canLoadImage(url: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => { window.clearTimeout(timer); resolve(img.naturalWidth > 0); };
    img.onerror = () => { window.clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

export default function GivingBankFields({ variant = "dock", values, defaults, onChange }: Props) {
  const inputClass = variant === "app" ? "bg-form-group__input" : "dock-lt-field-input";
  const selectClass = variant === "app" ? "bg-form-group__select" : "dock-lt-field-input";
  const count = countShownBanks(values);
  const hiddenRef = useRef<Record<number, { bank: string; num: string }>>({});
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [notice, setNotice] = useState<Record<number, string>>({});
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const setCount = useCallback((next: number) => {
    const patch: Record<string, string> = {};
    for (const i of SLOTS) {
      const name = (values[`bank${i}`] ?? "").trim();
      if (i > next && name) {
        hiddenRef.current[i] = { bank: values[`bank${i}`] ?? "", num: values[`num${i}`] ?? "" };
        patch[`bank${i}`] = "";
      } else if (i <= next && !name) {
        const kept = hiddenRef.current[i];
        patch[`bank${i}`] = kept?.bank || defaults[`bank${i}`] || "BANK NAME";
        if (kept?.num) patch[`num${i}`] = kept.num;
      }
    }
    if (Object.keys(patch).length) onChange(patch);
  }, [defaults, onChange, values]);

  const applyLogoFile = useCallback(async (slot: number, file: File) => {
    setBusy((b) => ({ ...b, [slot]: true }));
    setNotice((n) => ({ ...n, [slot]: "" }));
    try {
      onChange({ [`logo${slot}`]: await persistLogo(file) });
    } catch {
      setNotice((n) => ({ ...n, [slot]: "Could not save that picture." }));
    } finally {
      setBusy((b) => ({ ...b, [slot]: false }));
    }
  }, [onChange]);

  const pick = useCallback(async (slot: number, suggestion: BankSuggestion) => {
    setOpenSlot(null);
    onChange({ [`bank${slot}`]: suggestion.label });
    setBusy((b) => ({ ...b, [slot]: true }));
    setNotice((n) => ({ ...n, [slot]: "" }));
    try {
      const logo = await resolveBankLogo(suggestion, persistLogo, { canLoad: canLoadImage });
      onChange({ [`logo${slot}`]: logo.url });
      if (!logo.savedLocally) {
        setNotice((n) => ({ ...n, [slot]: "This logo loads from the internet. Upload it to use it offline." }));
      }
    } catch {
      setNotice((n) => ({ ...n, [slot]: "Couldn't get that logo (are you online?). Upload one instead." }));
    } finally {
      setBusy((b) => ({ ...b, [slot]: false }));
    }
  }, [onChange]);

  const suggestionsFor = useCallback((slot: number) => (openSlot === slot ? searchBanks(values[`bank${slot}`] ?? "") : []), [openSlot, values]);
  const shown = useMemo(() => SLOTS.filter((i) => i <= count), [count]);

  return (
    <div className={variant === "app" ? "bg-form-group" : "dock-lt-field-row"} style={variant === "app" ? undefined : { display: "block" }}>
      <label
        htmlFor="giving-bank-count"
        className={variant === "app" ? "bg-form-group__label" : undefined}
        style={variant === "app" ? undefined : { display: "block", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--dock-text, var(--text-primary))", marginBottom: 4 }}
      >
        How many bank accounts?
      </label>
      <select
        id="giving-bank-count"
        className={selectClass}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 8 }}
        value={count}
        onChange={(e) => setCount(Number(e.target.value))}
      >
        {SLOTS.map((n) => (
          <option key={n} value={n}>{n === 1 ? "1 bank account" : `${n} bank accounts`}</option>
        ))}
      </select>

      {shown.map((slot) => {
        const logo = values[`logo${slot}`] ?? "";
        const suggestions = suggestionsFor(slot);
        return (
          <div key={slot} style={{ border: "1px solid var(--dock-border, var(--border))", borderRadius: 4, padding: 6, marginBottom: 6, background: "var(--dock-surface, var(--surface))" }}>
            <div style={row}>
              <button
                type="button"
                title={logo ? "Change logo" : "Upload a logo"}
                aria-label={`Bank ${slot} logo: upload`}
                onClick={() => fileRefs.current[slot]?.click()}
                style={{ flex: "none", width: 44, height: 44, padding: 2, borderRadius: 3, border: "1px dashed var(--dock-border, var(--border))", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: busy[slot] ? 0.5 : 1 }}
              >
                {logo ? <img src={logo} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span style={{ ...small, color: "#666", textAlign: "center", lineHeight: 1.1 }}>Logo</span>}
              </button>
              <input
                ref={(el) => { fileRefs.current[slot] = el; }}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.type.startsWith("image/")) void applyLogoFile(slot, file);
                  e.target.value = "";
                }}
              />
              <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                <input
                  className={inputClass}
                  type="text"
                  style={input}
                  value={values[`bank${slot}`] ?? ""}
                  placeholder={`Bank ${slot}: type its name (GTBank, Zenith, Chase…)`}
                  aria-label={`Bank ${slot} name`}
                  autoComplete="off"
                  onChange={(e) => { onChange({ [`bank${slot}`]: e.target.value }); setOpenSlot(slot); }}
                  onFocus={() => setOpenSlot(slot)}
                  onBlur={() => { closeTimer.current = window.setTimeout(() => setOpenSlot((s) => (s === slot ? null : s)), 150); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && suggestions[0]) { e.preventDefault(); void pick(slot, suggestions[0]); }
                    if (e.key === "Escape") setOpenSlot(null);
                  }}
                />
                {suggestions.length > 0 && (
                  <ul role="listbox" style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "100%", margin: "2px 0 0", padding: 2, listStyle: "none", background: "var(--dock-surface-overlay, var(--dock-surface, var(--surface-raised, #1f2430)))", border: "1px solid var(--dock-border, var(--border))", borderRadius: 4, maxHeight: 190, overflowY: "auto" }}>
                    {suggestions.map((s) => (
                      <li key={s.id} role="option" aria-selected={false}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void pick(slot, s)}
                          style={{ display: "flex", width: "100%", alignItems: "center", gap: 6, padding: "4px 6px", border: 0, borderRadius: 3, background: "transparent", color: "var(--dock-text, var(--text-primary))", cursor: "pointer", textAlign: "left", fontSize: 12 }}
                        >
                          <img src={s.logoUrl} alt="" loading="lazy" style={{ width: 20, height: 20, objectFit: "contain", background: "#fff", borderRadius: 2, flex: "none" }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                          <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}{s.fullName !== s.label ? <span style={small}> · {s.fullName}</span> : null}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  className={inputClass}
                  type="text"
                  style={{ ...input, marginTop: 4 }}
                  value={values[`num${slot}`] ?? ""}
                  placeholder="Account number"
                  aria-label={`Bank ${slot} account number`}
                  onChange={(e) => onChange({ [`num${slot}`]: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginTop: 4, minHeight: 14 }}>
              <span style={{ ...small, color: notice[slot] ? "var(--dock-warning, #f59e0b)" : "var(--dock-text-dim, var(--text-secondary))" }}>
                {busy[slot] ? "Getting the logo…" : notice[slot] || (logo ? "" : "No logo yet: pick a bank from the list, or click the box to upload.")}
              </span>
              {logo ? (
                <button type="button" onClick={() => onChange({ [`logo${slot}`]: "" })} style={{ border: 0, background: "transparent", color: "var(--dock-text-dim, var(--text-secondary))", cursor: "pointer", fontSize: 10, textDecoration: "underline", padding: 0 }}>
                  Remove logo
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
