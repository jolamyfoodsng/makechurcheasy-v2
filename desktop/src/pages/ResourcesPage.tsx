/**
 * ResourcesPage.tsx — Setup resources for the dock-first workflow
 *
 * Keeps the media library as the default setup surface while the
 * MakeChurchEazy Dock stays focused on live control.
 */

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BibleLibrary from "../bible/components/BibleLibrary";
import { MediaTab } from "../library/MediaTab";
import { SongsTab } from "../library/SongsTab";
import "../library/library.css";

type ResourceTab = "bible" | "worship" | "media";

function parseTab(value: string | null): ResourceTab | null {
  if (value === "bible" || value === "worship" || value === "media") {
    return value;
  }
  return null;
}

export default function ResourcesPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = parseTab(searchParams.get("tab"));
  const focusMediaId = searchParams.get("mediaId") ?? undefined;
  const openReceiver = searchParams.get("receiver") === "1";
  // Resources opens on Media by default. Bible and Worship remain available
  // through their direct sidebar links, without adding another tab strip to
  // the media workspace.
  const tab: ResourceTab = requestedTab ?? "media";

  const translatedTabCopy = useMemo(() => ({
    bible: { title: t("resources.tabBibleTitle"), subtitle: t("resources.tabBibleSubtitle") },
    worship: { title: t("resources.tabWorshipTitle"), subtitle: t("resources.tabWorshipSubtitle") },
    media: { title: t("resources.tabMediaTitle"), subtitle: t("resources.tabMediaSubtitle") },
  }), [t]);

  const copy = translatedTabCopy[tab];

  return (
    <div className="app-page resources-page">
      <div className="app-page__inner resources-page__inner">
        <header className="app-page__header resources-page__header">
          <div className="app-page__header-copy resources-page__header-copy">
            <p className="app-page__eyebrow">{t("resources.pageEyebrow")}</p>
            <h1 className="app-page__title">{copy.title}</h1>
            <p className="app-page__subtitle">{copy.subtitle}</p>
          </div>

          {/* Direct Tab Switcher without emojis */}
          <div className="lib-tab-switcher" style={{ marginTop: "14px" }}>
            <button
              type="button"
              className={`lib-tab-btn${tab === "bible" ? " is-active" : ""}`}
              onClick={() => setSearchParams({ tab: "bible" })}
            >
              Bible Library & Downloads
            </button>
            <button
              type="button"
              className={`lib-tab-btn${tab === "worship" ? " is-active" : ""}`}
              onClick={() => setSearchParams({ tab: "worship" })}
            >
              Worship Songs
            </button>
            <button
              type="button"
              className={`lib-tab-btn${tab === "media" ? " is-active" : ""}`}
              onClick={() => setSearchParams({ tab: "media" })}
            >
              Media Library
            </button>
          </div>
        </header>

        <div className="resources-content">
          <div className="lib-page">
            {tab === "bible" && (
              <div className="resources-embedded-panel" data-resource-tab="bible">
                <BibleLibrary
                  open
                  onClose={() => { }}
                  mode="embedded"
                />
              </div>
            )}

            {tab === "worship" && <SongsTab />}
            {tab === "media" && <MediaTab focusMediaId={focusMediaId} openReceiver={openReceiver} />}
          </div>
        </div>
      </div>

    </div>
  );
}
