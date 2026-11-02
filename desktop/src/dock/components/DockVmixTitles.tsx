import { useState } from "react";
import {
  MCE_VMIX_INPUT_NAME,
  VMIX_TITLE_JOBS,
  findSlotInput,
  isVmixTitleInput,
  type VmixClient,
  type VmixSettings,
  type VmixStatus,
  type VmixTitleJob,
  type VmixTitleSlot,
} from "../../services/vmixClient";
import { addVmixBuiltinTitle, slotForChurchTitle } from "../../services/vmixSetup";

const JOB_LABELS: Record<VmixTitleJob, string> = {
  scripture: "Bible verses",
  songs: "Songs and notes",
  names: "Names",
};

const MCE_CHOICE = "__mce";
const BUILTIN_CHOICE = "__builtin";

function fieldLabel(field: string): string {
  return field.replace(/\.Text$/i, "");
}

/**
 * Which vMix title shows what: MakeChurchEazy's own title, or one the church
 * already has in vMix (its own design or one of vMix's built-in titles), with
 * the fields MCE fills. The church's titles are never changed or removed.
 */
export default function DockVmixTitles({
  settings,
  status,
  client,
  busy,
  onChange,
  onError,
}: {
  settings: VmixSettings;
  status: VmixStatus;
  client: VmixClient;
  busy: boolean;
  onChange: (titles: VmixSettings["titles"]) => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState<VmixTitleJob | null>(null);
  // MCE's own "MCE Presentation" title isn't offered as a church title.
  const churchTitles = status.inputs.filter((input) => isVmixTitleInput(input) && input.title !== MCE_VMIX_INPUT_NAME);

  const setSlot = (job: VmixTitleJob, slot: VmixTitleSlot) => onChange({ ...settings.titles, [job]: slot });

  const choose = async (job: VmixTitleJob, value: string) => {
    if (value === MCE_CHOICE) {
      setSlot(job, { kind: "mce" });
      return;
    }
    if (value === BUILTIN_CHOICE) {
      setAdding(job);
      try {
        const slot = await addVmixBuiltinTitle(client, job);
        if (slot) setSlot(job, slot);
        else onError("vMix's built-in titles weren't found on this computer. In vMix choose Add Input → Title, then pick it here.");
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setAdding(null);
      }
      return;
    }
    const input = churchTitles.find((entry) => entry.key === value);
    if (input) setSlot(job, slotForChurchTitle(input));
  };

  return (
    <div className="dock-vmix-titles" data-testid="dock-vmix-titles">
      <div className="dock-vmix-step__hint">
        Which vMix title shows what. Use MakeChurchEazy&apos;s title, or one you already have in vMix.
      </div>
      {VMIX_TITLE_JOBS.map((job) => {
        const slot = settings.titles[job];
        const input = findSlotInput(status, slot);
        const value = slot.kind === "mce" ? MCE_CHOICE : input?.key ?? "";
        return (
          <div key={job} className="dock-vmix-titles__row">
            <label className="dock-vmix-titles__job">
              <span>{JOB_LABELS[job]}</span>
              <select
                value={value}
                onChange={(e) => void choose(job, e.target.value)}
                disabled={busy || adding !== null}
                data-testid={`dock-vmix-title-${job}`}
              >
                <option value={MCE_CHOICE}>MakeChurchEazy title</option>
                {slot.kind === "vmix" && !input && <option value="">{slot.title} (not in vMix now)</option>}
                {churchTitles.map((title) => (
                  <option key={title.key} value={title.key}>{title.number}. {title.title}</option>
                ))}
                <option value={BUILTIN_CHOICE}>
                  {adding === job ? "Adding…" : "Add vMix's built-in title"}
                </option>
              </select>
            </label>
            {slot.kind === "vmix" && input && input.fields.length > 0 && (
              <div className="dock-vmix-titles__fields">
                <label>
                  <span>{job === "names" ? "Name in" : "Reference in"}</span>
                  <select
                    value={slot.referenceField}
                    onChange={(e) => setSlot(job, { ...slot, referenceField: e.target.value })}
                  >
                    <option value="">(not shown)</option>
                    {input.fields.map((field) => <option key={field} value={field}>{fieldLabel(field)}</option>)}
                  </select>
                </label>
                <label>
                  <span>{job === "names" ? "Role in" : job === "songs" ? "Lyrics in" : "Verse in"}</span>
                  <select
                    value={slot.textField}
                    onChange={(e) => setSlot(job, { ...slot, textField: e.target.value })}
                  >
                    <option value="">(not shown)</option>
                    {input.fields.map((field) => <option key={field} value={field}>{fieldLabel(field)}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
