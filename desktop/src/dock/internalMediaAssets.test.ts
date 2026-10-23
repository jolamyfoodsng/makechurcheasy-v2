import { describe, expect, it } from "vitest";
import { isInternalDockMediaItem, isInternalDockUploadFile } from "./internalMediaAssets";

describe("internal Dock media assets", () => {
  it("recognizes generated Multiview files by basename", () => {
    expect(isInternalDockUploadFile("mv-frame-123.png")).toBe(true);
    expect(isInternalDockUploadFile("/Users/pc/Documents/MakeChurchEasy/uploads/mv-pattern-456.svg")).toBe(true);
    expect(isInternalDockUploadFile("media_1234-worship.png")).toBe(false);
  });

  it("keeps logos saved for lower-thirds (bank logos, lower-third logos) out of user media", () => {
    expect(isInternalDockUploadFile("bank_logo_1729670000000_stanbic-ibtc-bank.png")).toBe(true);
    expect(isInternalDockUploadFile("C:\\Users\\pc\\uploads\\lt_logo_1729670000000_church.png")).toBe(true);
    expect(isInternalDockUploadFile("media_1729670000000_bank_logo_from_user.png")).toBe(false);
  });

  it("filters generated files even when a library item uses an absolute path", () => {
    expect(isInternalDockMediaItem({
      name: "MCE Frames",
      filePath: "/Users/pc/Documents/MakeChurchEasy/uploads/mv-frame-123.png",
    })).toBe(true);
    expect(isInternalDockMediaItem({
      name: "Worship background",
      filePath: "/Users/pc/Documents/MakeChurchEasy/uploads/media_1234-worship.png",
    })).toBe(false);
  });
});
