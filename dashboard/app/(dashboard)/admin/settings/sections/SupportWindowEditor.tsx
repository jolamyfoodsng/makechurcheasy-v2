"use client";

/**
 * SupportWindowEditor — Controls → "Support window in the desktop app".
 * Edits everything the app's Support window shows (see ../supportContent.ts): the title and
 * subtitle, the live-support line, the contact channels (order, main one, on/off, label,
 * description, link or number) and the Sunday emergency hotline.
 */

import { ArrowDown, ArrowUp, LifeBuoy, Plus, Star, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Input, Select, Toggle } from "@/components/ui";
import {
  MAX_SUPPORT_CHANNELS,
  SUPPORT_CHANNEL_KINDS,
  supportValueProblem,
  whatsappChatLink,
  type SupportChannel,
  type SupportChannelKind,
  type SupportContent,
} from "../supportContent";

interface Props {
  value: SupportContent;
  onChange: (value: SupportContent) => void;
  saveButton: React.ReactNode;
}

function newChannelId(channels: SupportChannel[]): string {
  let n = channels.length + 1;
  while (channels.some((c) => c.id === `channel-${n}`)) n += 1;
  return `channel-${n}`;
}

export function SupportWindowEditor({ value, onChange, saveButton }: Props) {
  const set = (patch: Partial<SupportContent>) => onChange({ ...value, ...patch });
  const setChannel = (id: string, patch: Partial<SupportChannel>) =>
    set({ channels: value.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const move = (index: number, by: -1 | 1) => {
    const next = [...value.channels];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    set({ channels: next });
  };
  const remove = (id: string) => {
    const channels = value.channels.filter((c) => c.id !== id);
    set({ channels, primaryChannelId: value.primaryChannelId === id ? (channels[0]?.id ?? "") : value.primaryChannelId });
  };
  const add = () => {
    const channel: SupportChannel = { id: newChannelId(value.channels), kind: "website", label: "", description: "", value: "", enabled: true };
    set({ channels: [...value.channels, channel] });
  };
  const kindMeta = (kind: SupportChannelKind) => SUPPORT_CHANNEL_KINDS.find((k) => k.value === kind) ?? SUPPORT_CHANNEL_KINDS[0];
  const emergencyProblem = !value.emergency.enabled
    ? ""
    : supportValueProblem("phone", value.emergency.phone) ||
      (whatsappChatLink(value.emergency.phone) ? "" : "Add the country code (e.g. +234 906 945 5406) so it opens a WhatsApp chat.");

  return (
    <Card padding="none">
      <div className="px-6 py-4 border-b border-slate-100">
        <CardHeader
          title="Support window in the desktop app"
          description="Everything people see when they click Support in the app's sidebar. Changes reach the app within a few minutes of saving."
          icon={<LifeBuoy className="w-4 h-4" />}
          action={saveButton}
        />
      </div>

      <div className="px-6 py-4 space-y-6">
        {/* Heading */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Title" value={value.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} placeholder="Get help" />
          <Input label="Subtitle" value={value.subtitle} maxLength={140} onChange={(e) => set({ subtitle: e.target.value })} placeholder="We're here to help Sunday run smoothly." />
        </div>

        {/* Live support */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <Toggle
            checked={value.status.online}
            onChange={(online) => set({ status: { ...value.status, online } })}
            label="Live support available"
            description="Shows the green dot next to Support in the app's sidebar."
          />
          <Input
            label="Status line"
            value={value.status.text}
            maxLength={140}
            onChange={(e) => set({ status: { ...value.status, text: e.target.value } })}
            placeholder="Our team usually replies within minutes."
          />
        </div>

        {/* Channels */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Contact channels</h4>
              <p className="text-xs text-slate-500">Shown in this order. The ★ main channel is the large button at the top.</p>
            </div>
            <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />} onClick={add} disabled={value.channels.length >= MAX_SUPPORT_CHANNELS}>
              Add channel
            </Button>
          </div>

          {value.channels.length === 0 && (
            <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg px-4 py-3">No channels yet. Add one so people can reach you.</p>
          )}

          {value.channels.map((channel, index) => {
            const meta = kindMeta(channel.kind);
            const problem = channel.enabled ? supportValueProblem(channel.kind, channel.value) : "";
            const isPrimary = value.primaryChannelId === channel.id;
            return (
              <div key={channel.id} className={`rounded-lg border px-4 py-3 space-y-3 ${channel.enabled ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-75"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Toggle checked={channel.enabled} onChange={(enabled) => setChannel(channel.id, { enabled })} label={channel.enabled ? "Shown" : "Hidden"} />
                  <button
                    type="button"
                    onClick={() => set({ primaryChannelId: channel.id })}
                    className={`inline-flex items-center gap-1 rounded-md px-2 h-7 text-xs font-medium border ${isPrimary ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                    aria-pressed={isPrimary}
                    title="Make this the large button at the top"
                  >
                    <Star className="w-3.5 h-3.5" fill={isPrimary ? "currentColor" : "none"} /> {isPrimary ? "Main channel" : "Make main"}
                  </button>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => move(index, -1)} icon={<ArrowUp className="w-3.5 h-3.5" />} />
                    <Button size="sm" variant="ghost" aria-label="Move down" title="Move down" disabled={index === value.channels.length - 1} onClick={() => move(index, 1)} icon={<ArrowDown className="w-3.5 h-3.5" />} />
                    <Button size="sm" variant="ghost" aria-label="Remove channel" title="Remove channel" onClick={() => remove(channel.id)} icon={<Trash2 className="w-3.5 h-3.5 text-red-600" />} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Select
                    label="Type"
                    value={channel.kind}
                    options={SUPPORT_CHANNEL_KINDS.map((k) => ({ value: k.value, label: k.label }))}
                    onChange={(e) => setChannel(channel.id, { kind: e.target.value as SupportChannelKind })}
                  />
                  <Input label="Label" value={channel.label} maxLength={60} onChange={(e) => setChannel(channel.id, { label: e.target.value })} placeholder="Chat on WhatsApp" />
                  <div className="md:col-span-2">
                    <Input label={meta.valueLabel} value={channel.value} maxLength={500} onChange={(e) => setChannel(channel.id, { value: e.target.value })} placeholder={meta.placeholder} error={problem || undefined} />
                  </div>
                  <div className="md:col-span-4">
                    <Input label="Description" value={channel.description} maxLength={140} onChange={(e) => setChannel(channel.id, { description: e.target.value })} placeholder="One short line under the label" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Emergency hotline */}
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3">
          <Toggle
            checked={value.emergency.enabled}
            onChange={(enabled) => set({ emergency: { ...value.emergency, enabled } })}
            label="Sunday emergency hotline"
            description="A highlighted number at the bottom of the Support window. Clicking it opens a WhatsApp chat with this number."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Title" value={value.emergency.title} maxLength={60} onChange={(e) => set({ emergency: { ...value.emergency, title: e.target.value } })} placeholder="Sunday emergency hotline" />
            <Input label="Phone number" value={value.emergency.phone} maxLength={25} onChange={(e) => set({ emergency: { ...value.emergency, phone: e.target.value } })} placeholder="+234 906 945 5406" error={emergencyProblem || undefined} />
            <Input label="Description" value={value.emergency.description} maxLength={140} onChange={(e) => set({ emergency: { ...value.emergency, description: e.target.value } })} placeholder="Something stopped working during the service? Message us on WhatsApp." />
          </div>
        </div>

        <p className="text-xs text-slate-500">
          A channel without a valid link or number is hidden in the app. A WhatsApp number becomes a link that opens a chat with it. The first WhatsApp, YouTube and email channels are also used in emails.
        </p>
      </div>
    </Card>
  );
}
