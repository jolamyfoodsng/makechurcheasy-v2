"use client";

import { Bell, Save } from "lucide-react";
import { Card, CardHeader, Button, Toggle, Input, Textarea } from "@/components/ui";
import { useTranslations } from "next-intl";
import type { PlatformSettings } from "../types";

interface Props {
  data: PlatformSettings["notifications"];
  onChange: (data: PlatformSettings["notifications"]) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

export function NotificationsSection({
  data,
  onChange,
  onSave,
  saving,
}: Props) {
  const t = useTranslations("admin.settings.notifications");
  const tc = useTranslations("common");
  const update = (fields: Partial<PlatformSettings["notifications"]>) =>
    onChange({ ...data, ...fields });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">{t("title")}</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          {t("description")}
        </p>
      </div>

      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-100">
          <CardHeader
            title={t("emailNotifications")}
            description={t("emailNotificationsDescription")}
            icon={<Bell className="w-4 h-4" />}
            action={
              <Button
                size="sm"
                loading={saving}
                onClick={onSave}
                icon={<Save className="w-3.5 h-3.5" />}
              >
                {tc("save")}
              </Button>
            }
          />
        </div>
        <div className="divide-y divide-slate-100">
          <div className="px-6 py-4">
            <Toggle
              label={t("welcomeEmail")}
              description={t("welcomeEmailDescription")}
              checked={data.welcomeEmail}
              onChange={(v) => update({ welcomeEmail: v })}
            />
            {data.welcomeEmail && (
              <div className="mt-4 space-y-3">
                <Input
                  label={t("welcomeEmailSubject")}
                  value={data.welcomeEmailSubject ?? ""}
                  maxLength={200}
                  onChange={(e) => update({ welcomeEmailSubject: e.target.value })}
                  placeholder="Welcome to MakeChurchEazy! 🎉"
                />
                <Textarea
                  label={t("welcomeEmailMessage")}
                  value={data.welcomeEmailMessage ?? ""}
                  maxLength={5000}
                  rows={6}
                  onChange={(e) => update({ welcomeEmailMessage: e.target.value })}
                  placeholder={t("welcomeEmailMessagePlaceholder")}
                />
                <p className="text-xs text-slate-400">{t("welcomeEmailMessageHint")}</p>
              </div>
            )}
          </div>
          <div className="px-6 py-4">
            <Toggle
              label={t("trialExpiryReminders")}
              description={t("trialExpiryRemindersDescription")}
              checked={data.trialExpiryReminder}
              onChange={(v) => update({ trialExpiryReminder: v })}
            />
          </div>
          <div className="px-6 py-4">
            <Toggle
              label={t("paymentReminders")}
              description={t("paymentRemindersDescription")}
              checked={data.paymentReminder}
              onChange={(v) => update({ paymentReminder: v })}
            />
          </div>
          <div className="px-6 py-4">
            <Toggle
              label={t("securityAlerts")}
              description={t("securityAlertsDescription")}
              checked={data.securityAlerts}
              onChange={(v) => update({ securityAlerts: v })}
            />
          </div>
          <div className="px-6 py-4">
            <Toggle
              label={t("creditLowBalance")}
              description={t("creditLowBalanceDescription")}
              checked={data.creditLowBalance}
              onChange={(v) => update({ creditLowBalance: v })}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
