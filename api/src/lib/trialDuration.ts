/** The free trial length every new user gets unless an admin changes it in the platform settings. */
export const DEFAULT_TRIAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

interface LegacyTrialDates {
  durationDays?: unknown;
  startedAt?: unknown;
  endsAt?: unknown;
  extendedDays?: unknown;
}

/**
 * Length in days of a trial stored on the user document (the old embedded format) when it has to be
 * turned into a trial record. Uses the stored duration; if there is none, works it out from the trial's
 * own start and end dates (minus any days an admin added); only then falls back to the default.
 */
export function legacyTrialDurationDays(trial: LegacyTrialDates): number {
  const stored = Number(trial.durationDays);
  if (Number.isInteger(stored) && stored > 0) return stored;

  const start = Date.parse(String(trial.startedAt ?? ""));
  const end = Date.parse(String(trial.endsAt ?? ""));
  const extended = Math.max(0, Number(trial.extendedDays) || 0);
  const span = Math.round((end - start) / DAY_MS - extended);
  return Number.isFinite(span) && span >= 1 ? span : DEFAULT_TRIAL_DAYS;
}
