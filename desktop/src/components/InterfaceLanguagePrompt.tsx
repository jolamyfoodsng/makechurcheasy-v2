import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe2 } from "./icons/NativeIcons";
import ModalDialog from "./ModalDialog";
import { INTERFACE_LOCALES } from "../i18n/localeCatalog";
import {
  applyInterfaceLanguagePreference,
  getResolvedInterfaceLanguage,
  getStoredInterfaceLanguage,
} from "../services/interfaceLanguage";

const PROMPT_SEEN_KEY = "mce_interface_language_prompt_seen";

function hasSeenPrompt(): boolean {
  try {
    return localStorage.getItem(PROMPT_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

function markPromptSeen(): void {
  try {
    localStorage.setItem(PROMPT_SEEN_KEY, "true");
  } catch {
    // ignore storage failures
  }
}

export function InterfaceLanguagePrompt() {
  const { t } = useTranslation();
  const selectId = useId();
  const [visible, setVisible] = useState(() => !getStoredInterfaceLanguage() && !hasSeenPrompt());
  const [selectedLanguage, setSelectedLanguage] = useState(() => getResolvedInterfaceLanguage());
  const selectedLocale = useMemo(
    () => INTERFACE_LOCALES.find((locale) => locale.code === selectedLanguage) ?? INTERFACE_LOCALES[0],
    [selectedLanguage],
  );

  if (!visible) return null;

  const handleContinue = () => {
    void applyInterfaceLanguagePreference(selectedLocale.code, { broadcast: true }).finally(() => {
      markPromptSeen();
      setVisible(false);
    });
  };

  return (
    <ModalDialog
      tone="brand"
      icon={<Globe2 size={26} />}
      title={t("interfaceLanguagePrompt.title")}
      zIndex={100000}
      width={420}
      extra={
        <div className="obs-field">
          <label htmlFor={selectId}>{t("interfaceLanguagePrompt.label")}</label>
          <select
            id={selectId}
            value={selectedLanguage}
            onChange={(event) => setSelectedLanguage(event.target.value)}
            style={{ width: "100%" }}
            autoFocus
          >
            {INTERFACE_LOCALES.map((locale) => (
              <option key={locale.code} value={locale.code}>
                {locale.nativeName}
              </option>
            ))}
          </select>
        </div>
      }
      hint={t("interfaceLanguagePrompt.helper")}
      actions={[{ label: t("interfaceLanguagePrompt.continue"), variant: "primary", onClick: handleContinue }]}
    >
      {t("interfaceLanguagePrompt.description")}
    </ModalDialog>
  );
}
