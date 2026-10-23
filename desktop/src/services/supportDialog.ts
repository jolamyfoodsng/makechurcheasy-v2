/**
 * supportDialog.ts — open the Support dialog from anywhere in the app.
 *
 * The dialog itself lives in DashboardSidebar (it is mounted on every page that has the
 * sidebar); other places such as the top strip just fire this event.
 */

export const OPEN_SUPPORT_DIALOG_EVENT = "mce:open-support-dialog";

export function openSupportDialog(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_SUPPORT_DIALOG_EVENT));
}
