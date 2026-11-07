import { describe, expect, it } from "vitest";
import {
  PLAN_ENTITLEMENTS,
  getLegacyCompatibleEntitlementsForPlan,
} from "../lib/subscriptionSourceOfTruth";

describe("Basic plan entitlements", () => {
  it("keeps the resource limits and feature gates aligned with the paid offer", () => {
    expect(PLAN_ENTITLEMENTS.basic).toMatchObject({
      credits: 240,
      maxSongs: -1,
      maxImages: -1,
      maxVideos: -1,
      maxBibleVersions: -1,
      maxMultiviewTemplates: 5,
      multiview: true,
      tickers: true,
      bulkImport: true,
      easyWorshipImport: true,
      propresenterImport: true,
      maxLowerThirds: 15,
      maxThemes: 10,
      maxTickerThemes: -1,
      speechToScripture: true,
      translation: false,
      countdowns: false,
    });
  });

  it("allows Verse AI but blocks transcript translation in legacy consumers", () => {
    expect(getLegacyCompatibleEntitlementsForPlan("basic")).toMatchObject({
      songs: -1,
      images: -1,
      videos: -1,
      bibleVersions: -1,
      multiviewTemplates: 5,
      multiview: true,
      tickers: true,
      lowerThirds: 15,
      themes: 10,
      tickerThemes: -1,
      speechToScripture: true,
      translation: false,
      sermonExport: false,
      aiFeatures: false,
      countdowns: false,
    });
  });

  it("keeps Growth unlimited and gives Free 3 broadcast graphics, 3 ticker themes and no tickers", () => {
    expect(getLegacyCompatibleEntitlementsForPlan("free")).toMatchObject({
      multiviewTemplates: 0,
      multiview: false,
      tickers: false,
      lowerThirds: 3,
      themes: 2,
      tickerThemes: 3,
      countdowns: false,
    });
    expect(getLegacyCompatibleEntitlementsForPlan("growth")).toMatchObject({
      multiviewTemplates: -1,
      multiview: true,
      tickers: true,
      lowerThirds: -1,
      themes: -1,
      countdowns: true,
    });
  });
});
