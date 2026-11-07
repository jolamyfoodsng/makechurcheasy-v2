import { describe, expect, it } from "vitest";
import { domainFromText, fetchBankLogoFile, nigerianLogoUrl, resolveBankLogo, searchBanks, siteIconUrl } from "./bankCatalog";

describe("bank search", () => {
  it("finds Nigerian banks by short name, alias or full name", () => {
    expect(searchBanks("gtb")[0]).toMatchObject({ label: "GTBank", source: "ng", logoUrl: nigerianLogoUrl("guaranty-trust-bank") });
    expect(searchBanks("zenith")[0].fullName).toBe("Zenith Bank");
    expect(searchBanks("united bank for africa")[0].label).toBe("UBA");
    expect(searchBanks("fcmb")[0].fullName).toBe("First City Monument Bank");
  });

  it("falls back to well-known banks outside the Nigerian list", () => {
    expect(searchBanks("wema")[0]).toMatchObject({ label: "Wema Bank", source: "world", logoUrl: siteIconUrl("wemabank.com") });
    expect(searchBanks("chase")[0].source).toBe("world");
    expect(searchBanks("hsbc")[0].label).toBe("HSBC");
  });

  it("turns a typed website into its icon", () => {
    expect(domainFromText("https://www.GTBank.com/personal")).toBe("gtbank.com");
    expect(domainFromText("first bank")).toBeNull();
    const first = searchBanks("wellsfargo.com")[0];
    expect(first).toMatchObject({ source: "site", logoUrl: siteIconUrl("wellsfargo.com") });
  });

  it("returns nothing for tiny or unknown text and never repeats a name", () => {
    expect(searchBanks("a")).toEqual([]);
    expect(searchBanks("qqqqzzzz")).toEqual([]);
    const labels = searchBanks("access").map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("fetchBankLogoFile", () => {
  const suggestion = searchBanks("zenith")[0];

  it("returns the picture as a file", async () => {
    const fake = (async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 })) as unknown as typeof fetch;
    const file = await fetchBankLogoFile(suggestion, fake);
    expect(file.name).toBe("ng_zenith_bank.png");
    expect(file.type).toBe("image/png");
  });

  it("rejects a missing logo or something that is not a picture", async () => {
    await expect(fetchBankLogoFile(suggestion, (async () => new Response("no", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow();
    await expect(fetchBankLogoFile(suggestion, (async () => new Response(new Blob(["<html>"], { type: "text/html" }))) as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("common Nigerian banks and fintechs", () => {
  it("finds each one with a logo source", () => {
    expect(searchBanks("OPay")[0]).toMatchObject({ label: "OPay", logoUrl: siteIconUrl("opayweb.com") });
    expect(searchBanks("Opay")[0].label).toBe("OPay");
    expect(searchBanks("PalmPay")[0]).toMatchObject({ label: "PalmPay", logoUrl: siteIconUrl("palmpay.com") });
    expect(searchBanks("moniepoint")[0]).toMatchObject({ label: "Moniepoint", logoUrl: nigerianLogoUrl("moniepoint-mfb-ng") });
    expect(searchBanks("kuda")[0].logoUrl).toBe(nigerianLogoUrl("kuda-bank"));
    expect(searchBanks("gtbank")[0].logoUrl).toBe(nigerianLogoUrl("guaranty-trust-bank"));
    expect(searchBanks("access")[0].logoUrl).toBe(nigerianLogoUrl("access-bank"));
    expect(searchBanks("first bank")[0].logoUrl).toBe(nigerianLogoUrl("first-bank-of-nigeria"));
    expect(searchBanks("uba")[0].logoUrl).toBe(nigerianLogoUrl("united-bank-for-africa"));
    expect(searchBanks("zenith")[0].logoUrl).toBe(nigerianLogoUrl("zenith-bank"));
  });
});

describe("resolveBankLogo", () => {
  const palmpay = searchBanks("palmpay")[0];
  const save = async (file: File) => `/uploads/${file.name}`;

  it("saves the downloaded logo with the church's files", async () => {
    const ok = (async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 })) as unknown as typeof fetch;
    await expect(resolveBankLogo(palmpay, save, { fetchImpl: ok })).resolves.toEqual({ url: "/uploads/world_palmpay_com.png", savedLocally: true });
  });

  it("uses the logo's web address when the download is blocked but the picture shows", async () => {
    const blocked = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(resolveBankLogo(palmpay, save, { fetchImpl: blocked, canLoad: async () => true })).resolves.toEqual({ url: palmpay.logoUrl, savedLocally: false });
  });

  it("fails when the picture cannot be shown either", async () => {
    const blocked = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(resolveBankLogo(palmpay, save, { fetchImpl: blocked, canLoad: async () => false })).rejects.toThrow();
  });
});
