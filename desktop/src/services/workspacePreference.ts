export type PreferredWorkspace = "studio" | "obs" | "vmix";

export const PREFERRED_WORKSPACE_KEY = "mce-preferred-workspace-v1";
export const ONBOARDING_COMPLETED_KEY = "mce-onboarding-completed-v1";
const LEGACY_ONBOARDING_COMPLETED_KEY = "mce-onboarding-complete";
const STUDIO_WELCOME_PENDING_KEY = "mce-studio-welcome-pending-v1";
const sessionFallback = new Map<string, string>();

function readValue(key: string): string | null {
  const fallback = sessionFallback.get(key) ?? null;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    sessionFallback.delete(key);
  } catch {
    sessionFallback.set(key, value);
  }
}

function removeValue(key: string): void {
  sessionFallback.delete(key);
  try { localStorage.removeItem(key); } catch { /* Ignore unavailable browser storage. */ }
}

export function getPreferredWorkspace(): PreferredWorkspace | null {
  const value = readValue(PREFERRED_WORKSPACE_KEY);
  if (value === "studio" || value === "obs" || value === "vmix") return value;
  // Existing installs completed the original OBS onboarding before this preference existed.
  return readValue(LEGACY_ONBOARDING_COMPLETED_KEY) === "true" ? "obs" : null;
}

export function setPreferredWorkspace(workspace: PreferredWorkspace): void {
  writeValue(PREFERRED_WORKSPACE_KEY, workspace);
}

export function markStudioWelcomePending(): void {
  writeValue(STUDIO_WELCOME_PENDING_KEY, "true");
}

export function hasStudioWelcomePending(): boolean {
  return readValue(STUDIO_WELCOME_PENDING_KEY) === "true";
}

export function clearStudioWelcomePending(): void {
  removeValue(STUDIO_WELCOME_PENDING_KEY);
}

export function isOnboardingCompleted(): boolean {
  // Read-only: this runs during React render, so legacy migration must not write here.
  return readValue(ONBOARDING_COMPLETED_KEY) === "true"
    || readValue(LEGACY_ONBOARDING_COMPLETED_KEY) === "true";
}

export function completeWorkspaceOnboarding(): void {
  writeValue(ONBOARDING_COMPLETED_KEY, "true");
  // Keep older consumers that still read the original completion flag working.
  writeValue(LEGACY_ONBOARDING_COMPLETED_KEY, "true");
}

export function shouldAutoConnectObs(): boolean {
  const workspace = getPreferredWorkspace();
  if (workspace) return workspace === "obs";
  return isOnboardingCompleted();
}

export function resetWorkspaceOnboarding(): void {
  removeValue(ONBOARDING_COMPLETED_KEY);
  removeValue(LEGACY_ONBOARDING_COMPLETED_KEY);
  removeValue(PREFERRED_WORKSPACE_KEY);
}
