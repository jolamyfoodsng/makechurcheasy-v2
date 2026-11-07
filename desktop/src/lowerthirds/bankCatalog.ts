/**
 * bankCatalog.ts — find a bank's logo by typing its name.
 *
 * Nigerian banks are matched from a bundled list (names work offline) and their logos come from the
 * open nigerian-banks-api project. Other banks are matched from a short list of well-known ones by
 * website, and any website a person types ("chase.com") gets its site icon. Whatever is picked is saved
 * with the church's own files by the caller, so the graphic keeps working offline in OBS.
 */
import { NIGERIAN_BANKS } from "./bankCatalogData";

export type BankSource = "ng" | "world" | "site";

export interface BankSuggestion {
  id: string;
  /** What is printed on the graphic. */
  label: string;
  /** Full name, shown in the list when it differs from the label. */
  fullName: string;
  source: BankSource;
  logoUrl: string;
}

export const NIGERIAN_LOGO_BASE = "https://cdn.jsdelivr.net/gh/supermx1/nigerian-banks-api@main/logos/";

export function nigerianLogoUrl(slug: string): string {
  return `${NIGERIAN_LOGO_BASE}${encodeURIComponent(slug)}.png`;
}

/** Site icon for a website (the best a name-only lookup can do for banks outside Nigeria). */
export function siteIconUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

interface WorldBank {
  name: string;
  short?: string;
  domain: string;
  aliases?: string[];
}

/** Well-known banks outside the Nigerian list, and Nigerian ones the list does not carry. */
export const WORLD_BANKS: readonly WorldBank[] = [
  { name: "Wema Bank", domain: "wemabank.com", aliases: ["wema", "alat"] },
  // opayweb.com is OPay's own site; opay-nigeria.com has no site icon (the lookup returned 404).
  { name: "OPay", domain: "opayweb.com", aliases: ["opay", "o pay", "opay digital services", "paycom"] },
  { name: "PalmPay", domain: "palmpay.com", aliases: ["palmpay", "palm pay"] },
  { name: "Paga", domain: "paga.com" },
  { name: "Flutterwave", domain: "flutterwave.com" },
  { name: "Paystack", domain: "paystack.com" },
  { name: "Chase", domain: "chase.com", aliases: ["jpmorgan", "jp morgan", "jpmorgan chase"] },
  { name: "Bank of America", domain: "bankofamerica.com", aliases: ["bofa", "boa"] },
  { name: "Wells Fargo", domain: "wellsfargo.com" },
  { name: "Citibank", domain: "citi.com", aliases: ["citi"] },
  { name: "Capital One", domain: "capitalone.com" },
  { name: "U.S. Bank", domain: "usbank.com", aliases: ["us bank"] },
  { name: "PNC Bank", domain: "pnc.com", aliases: ["pnc"] },
  { name: "Truist", domain: "truist.com" },
  { name: "TD Bank", domain: "td.com", aliases: ["td", "toronto dominion"] },
  { name: "RBC Royal Bank", domain: "rbcroyalbank.com", aliases: ["rbc", "royal bank of canada"] },
  { name: "Scotiabank", domain: "scotiabank.com", aliases: ["scotia"] },
  { name: "BMO", domain: "bmo.com", aliases: ["bank of montreal"] },
  { name: "CIBC", domain: "cibc.com" },
  { name: "HSBC", domain: "hsbc.com" },
  { name: "Barclays", domain: "barclays.co.uk" },
  { name: "Lloyds Bank", domain: "lloydsbank.com", aliases: ["lloyds"] },
  { name: "NatWest", domain: "natwest.com" },
  { name: "Santander", domain: "santander.co.uk" },
  { name: "Monzo", domain: "monzo.com" },
  { name: "Standard Bank", domain: "standardbank.com" },
  { name: "Absa", domain: "absa.co.za" },
  { name: "FNB", domain: "fnb.co.za", aliases: ["first national bank"] },
  { name: "Nedbank", domain: "nedbank.co.za" },
  { name: "Equity Bank", domain: "equitygroupholdings.com", aliases: ["equity"] },
  { name: "KCB", domain: "kcbgroup.com", aliases: ["kenya commercial bank"] },
  { name: "GCB Bank", domain: "gcb.com.gh", aliases: ["gcb", "ghana commercial bank"] },
  { name: "Ecobank", domain: "ecobank.com" },
  { name: "Commonwealth Bank", domain: "commbank.com.au", aliases: ["commbank"] },
  { name: "ANZ", domain: "anz.com" },
  { name: "Westpac", domain: "westpac.com.au" },
  { name: "ICICI Bank", domain: "icicibank.com", aliases: ["icici"] },
  { name: "HDFC Bank", domain: "hdfcbank.com", aliases: ["hdfc"] },
  { name: "State Bank of India", domain: "sbi.co.in", aliases: ["sbi"] },
  { name: "Wise", domain: "wise.com", aliases: ["transferwise"] },
  { name: "PayPal", domain: "paypal.com" },
  { name: "Zelle", domain: "zellepay.com" },
  { name: "Cash App", domain: "cash.app", aliases: ["cashapp"] },
  { name: "Venmo", domain: "venmo.com" },
];

const norm = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function score(query: string, names: string[]): number {
  let best = 0;
  for (const raw of names) {
    const name = norm(raw);
    if (!name) continue;
    if (name === query) return 100;
    if (name.startsWith(query)) best = Math.max(best, 80);
    else if (name.split(" ").some((word) => word.startsWith(query))) best = Math.max(best, 60);
    else if (query.length >= 3 && name.includes(query)) best = Math.max(best, 40);
  }
  return best;
}

/** The website in what was typed ("chase.com", "https://www.gtbank.com/x"), or null. */
export function domainFromText(text: string): string | null {
  const value = text.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(value) ? value : null;
}

/** Banks matching what was typed, best first: Nigerian list, then the other banks, then the typed website. */
export function searchBanks(text: string, limit = 6): BankSuggestion[] {
  const query = norm(text);
  const results: Array<BankSuggestion & { score: number }> = [];

  const domain = domainFromText(text);
  if (domain) {
    results.push({ id: `site:${domain}`, label: domain.replace(/\..*$/, "").toUpperCase(), fullName: `Icon from ${domain}`, source: "site", logoUrl: siteIconUrl(domain), score: 90 });
  }
  if (query.length >= 2) {
    for (const bank of NIGERIAN_BANKS) {
      const s = score(query, [bank.short ?? "", bank.name, ...(bank.aliases ?? [])]);
      if (s > 0) {
        results.push({ id: `ng:${bank.slug}`, label: bank.short ?? bank.name, fullName: bank.name, source: "ng", logoUrl: nigerianLogoUrl(bank.slug), score: s + 1 });
      }
    }
    for (const bank of WORLD_BANKS) {
      const s = score(query, [bank.short ?? "", bank.name, ...(bank.aliases ?? [])]);
      if (s > 0) {
        results.push({ id: `world:${bank.domain}`, label: bank.short ?? bank.name, fullName: bank.name, source: "world", logoUrl: siteIconUrl(bank.domain), score: s });
      }
    }
  }
  const seen = new Set<string>();
  return results
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const key = norm(item.label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ score: _score, ...suggestion }) => suggestion);
}

/**
 * The logo to put on the graphic for a picked bank.
 *
 * First the picture is downloaded and saved with the church's own files (works offline in OBS). The site
 * icon service used for banks outside the Nigerian list does not allow downloads from other web pages,
 * so for those the download fails; the logo's web address is used instead (an <img> may load it), as
 * long as `canLoad` confirms the picture shows.
 */
export async function resolveBankLogo(
  suggestion: BankSuggestion,
  save: (file: File) => Promise<string>,
  options: { fetchImpl?: typeof fetch; canLoad?: (url: string) => Promise<boolean> } = {},
): Promise<{ url: string; savedLocally: boolean }> {
  try {
    return { url: await save(await fetchBankLogoFile(suggestion, options.fetchImpl)), savedLocally: true };
  } catch (error) {
    const remote = suggestion.logoUrl;
    if (/^https:\/\//i.test(remote) && (!options.canLoad || (await options.canLoad(remote)))) {
      return { url: remote, savedLocally: false };
    }
    throw error;
  }
}

/** Download a suggestion's logo as a file, so it can be saved with the church's own files. */
export async function fetchBankLogoFile(suggestion: BankSuggestion, fetchImpl: typeof fetch = fetch): Promise<File> {
  const response = await fetchImpl(suggestion.logoUrl);
  if (!response.ok) throw new Error(`Logo not available (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The logo is not a picture");
  const ext = blob.type.includes("svg") ? "svg" : blob.type.includes("jpeg") ? "jpg" : "png";
  const base = suggestion.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}
