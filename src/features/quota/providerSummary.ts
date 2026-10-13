/**
 * Provider cards for the 7-day quota remaining on each account.
 *
 * The headline number adds those remainings ("436% of 500%" is five accounts).
 * The bar does not merge them: one segment per account, in list order, filled
 * from that account's own 7-day window. Model windows such as Claude's
 * 7-day Fable are a different limit and never become this card.
 *
 * Pure: `nowMs` is passed in, and quota state is read structurally.
 */

import { getQuotaAccountLabel } from '@/utils/quota/identity';
import { QUOTA_TAB_ORDER } from './constants';
import type { QuotaFileEntry } from './logic';
import type { QuotaProviderType } from './providers/types';

export type ProviderSummaryAvailability = 'idle' | 'loading' | 'ready';

export interface ProviderSummaryAccount {
  key: string;
  label: string;
  /** Remaining on the 7-day window, 0..100. Null when this account did not report it. */
  remaining: number | null;
}

export interface ProviderSummaryWindow {
  id: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  /** Sum of the accounts that reported a 7-day number. Null when none did. */
  remainingPercent: number | null;
  /** `knownCount * 100`, or `credentialCount * 100` when no number came back. */
  capacityPercent: number;
  /** Soonest 7-day reset still ahead. */
  resetAtMs: number | null;
}

export interface ProviderQuotaSummary {
  type: QuotaProviderType;
  credentialCount: number;
  availability: ProviderSummaryAvailability;
  /** One slot per credential, in list order. */
  accounts: ProviderSummaryAccount[];
  window: ProviderSummaryWindow | null;
}

interface Observation {
  id: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  remaining: number | null;
  resetAtMs: number | null;
  /** Week-scale bucket. Only Antigravity and plugin quotas need this. */
  weekly: boolean;
}

const WEEK_MIN_HOURS = 24 * 7 - 1;
const WEEK_MAX_HOURS = 24 * 8;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const remainingFromUsed = (used: unknown): number | null => {
  const value = finite(used);
  if (value === null) return null;
  return Math.round(clampPercent(100 - clampPercent(value)));
};

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readParams(value: unknown): Record<string, string | number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const params: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))) {
      params[key] = entry;
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function isWeekPeriod(periodHours: number | null, id: string, labelKey?: string): boolean {
  if (periodHours !== null && periodHours >= WEEK_MIN_HOURS && periodHours <= WEEK_MAX_HOURS) {
    return true;
  }
  const key = `${id} ${labelKey ?? ''}`.toLowerCase();
  if (key.includes('month')) return false;
  return /\bweekly\b|\bweek\b|seven[-_ ]?day/.test(key);
}

function observation(
  partial: Omit<Observation, 'weekly'> & { periodHours?: number | null }
): Observation {
  return {
    id: partial.id,
    label: partial.label,
    labelKey: partial.labelKey,
    labelParams: partial.labelParams,
    remaining: partial.remaining,
    resetAtMs: partial.resetAtMs,
    weekly: isWeekPeriod(partial.periodHours ?? null, partial.id, partial.labelKey),
  };
}

function readUsedWindows(quota: unknown): Observation[] {
  const windows = (quota as { windows?: unknown[] }).windows;
  if (!Array.isArray(windows)) return [];
  return windows.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const window = value as {
      id?: unknown;
      label?: unknown;
      labelKey?: unknown;
      labelParams?: unknown;
      usedPercent?: unknown;
      remainingPercent?: unknown;
      resetAtMs?: unknown;
      periodHours?: unknown;
    };
    const id = readString(window.id);
    if (!id) return [];
    const usedRemaining = remainingFromUsed(window.usedPercent);
    const direct = finite(window.remainingPercent);
    return [
      observation({
        id,
        label: readString(window.label),
        labelKey: readString(window.labelKey),
        labelParams: readParams(window.labelParams),
        remaining: usedRemaining ?? (direct === null ? null : Math.round(clampPercent(direct))),
        resetAtMs: finite(window.resetAtMs),
        periodHours: finite(window.periodHours),
      }),
    ];
  });
}

function readKimiRows(quota: unknown): Observation[] {
  const rows = (
    quota as {
      rows?: {
        id?: unknown;
        label?: unknown;
        labelKey?: unknown;
        labelParams?: unknown;
        used?: unknown;
        limit?: unknown;
        resetAtMs?: unknown;
        periodHours?: unknown;
      }[];
    }
  ).rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const id = readString(row.id);
    if (!id) return [];
    const labelKey = readString(row.labelKey);
    const used = finite(row.used) ?? 0;
    const limit = finite(row.limit) ?? 0;
    const remaining =
      limit > 0 ? Math.round(clampPercent(((limit - used) / limit) * 100)) : used > 0 ? 0 : null;
    return [
      observation({
        id,
        label: readString(row.label),
        labelKey,
        labelParams: readParams(row.labelParams),
        remaining,
        resetAtMs: finite(row.resetAtMs),
        periodHours: finite(row.periodHours),
      }),
    ];
  });
}

function readBuckets(quota: unknown): Observation[] {
  const groups = (quota as { groups?: { buckets?: unknown[] }[] }).groups;
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => {
    const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
    return buckets.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const bucket = value as {
        id?: unknown;
        label?: unknown;
        remainingFraction?: unknown;
        resetAtMs?: unknown;
        periodHours?: unknown;
      };
      const id = readString(bucket.id);
      if (!id) return [];
      const fraction = finite(bucket.remainingFraction);
      return [
        observation({
          id,
          label: readString(bucket.label),
          remaining:
            fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100),
          resetAtMs: finite(bucket.resetAtMs),
          periodHours: finite(bucket.periodHours),
        }),
      ];
    });
  });
}

function readXai(quota: unknown): Observation[] {
  const billing = (
    quota as {
      billing?: {
        periodType?: unknown;
        usagePercent?: unknown;
        resetAtMs?: unknown;
        periodHours?: unknown;
      } | null;
    }
  ).billing;
  if (!billing || billing.periodType !== 'weekly') return [];
  return [
    observation({
      id: 'weekly',
      labelKey: 'xai_quota.weekly_limit',
      remaining: remainingFromUsed(billing.usagePercent),
      resetAtMs: finite(billing.resetAtMs),
      periodHours: finite(billing.periodHours) ?? 24 * 7,
    }),
  ];
}

function readMeta(quota: unknown): Observation[] {
  const windows = (
    quota as {
      data?: {
        windows?: { id?: unknown; usedPercent?: unknown; resetAt?: unknown }[];
      };
    }
  ).data?.windows;
  if (!Array.isArray(windows)) return [];
  return windows.flatMap((window) => {
    const id = readString(window.id);
    if (!id) return [];
    const resetAt = finite(window.resetAt);
    return [
      observation({
        id,
        labelKey: `meta_quota.${id}`,
        remaining: remainingFromUsed(window.usedPercent),
        resetAtMs: resetAt === null ? null : resetAt * 1000,
        periodHours: id === 'weekly' ? 24 * 7 : null,
      }),
    ];
  });
}

function readWindows(provider: QuotaProviderType, quota: unknown): Observation[] {
  switch (provider) {
    case 'claude':
    case 'codex':
      return readUsedWindows(quota);
    case 'devin':
      return readUsedWindows(quota).map((window) => ({
        ...window,
        labelKey: window.labelKey ?? `devin_quota.${window.id}`,
      }));
    case 'kimi':
      return readKimiRows(quota);
    case 'antigravity':
    case 'plugin':
      return readBuckets(quota);
    case 'xai':
      return readXai(quota);
    case 'meta':
      return readMeta(quota);
    default:
      return [];
  }
}

/** The account-wide 7-day window. Model windows (Fable, a Codex extra limit) are not it. */
function isSevenDay(provider: QuotaProviderType, window: Observation): boolean {
  switch (provider) {
    case 'claude':
      return window.id === 'seven-day';
    case 'codex':
    case 'devin':
    case 'meta':
    case 'xai':
      return window.id === 'weekly';
    case 'kimi':
      return window.labelKey === 'kimi_quota.weekly_limit';
    case 'antigravity':
    case 'plugin':
      return window.weekly && (window.id === 'weekly' || window.id === 'week');
    default:
      return false;
  }
}

function pickSevenDay(
  provider: QuotaProviderType,
  windows: readonly Observation[]
): Observation | null {
  const matches = windows.filter((window) => isSevenDay(provider, window));
  return matches.length === 1
    ? matches[0]
    : (matches.find((window) => window.remaining !== null) ?? matches[0] ?? null);
}

function soonestFuture(resets: readonly (number | null)[], nowMs: number): number | null {
  let best: number | null = null;
  for (const at of resets) {
    if (at === null || at <= nowMs) continue;
    if (best === null || at < best) best = at;
  }
  return best;
}

interface CredentialSample {
  key: string;
  label: string;
  window: Observation | null;
}

function summarizeProvider(
  type: QuotaProviderType,
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => unknown,
  nowMs: number
): ProviderQuotaSummary {
  let sawSuccess = false;
  let sawLoading = false;
  const samples: CredentialSample[] = [];

  for (const entry of entries) {
    const quota = quotaFor(entry) as { status?: string } | undefined;
    if (quota?.status === 'loading') sawLoading = true;
    let window: Observation | null = null;
    if (quota?.status === 'success') {
      sawSuccess = true;
      window = pickSevenDay(type, readWindows(type, quota));
    }
    samples.push({
      key: `${type}:${entry.file.name}`,
      label: getQuotaAccountLabel(entry.file),
      window,
    });
  }

  const availability: ProviderSummaryAvailability = sawSuccess
    ? 'ready'
    : sawLoading
      ? 'loading'
      : 'idle';
  const accounts: ProviderSummaryAccount[] = samples.map((sample) => ({
    key: sample.key,
    label: sample.label,
    remaining: sample.window?.remaining ?? null,
  }));
  const chosen = samples.find((sample) => sample.window)?.window ?? null;
  if (!chosen) {
    return { type, credentialCount: entries.length, availability, accounts, window: null };
  }

  const known = accounts
    .map((account) => account.remaining)
    .filter((remaining): remaining is number => remaining !== null);
  return {
    type,
    credentialCount: entries.length,
    availability,
    accounts,
    window: {
      id: chosen.id,
      label: chosen.label,
      labelKey: chosen.labelKey,
      labelParams: chosen.labelParams,
      remainingPercent:
        known.length > 0 ? known.reduce((sum, remaining) => sum + remaining, 0) : null,
      capacityPercent: (known.length > 0 ? known.length : entries.length) * 100,
      resetAtMs: soonestFuture(
        samples.map((sample) => sample.window?.resetAtMs ?? null),
        nowMs
      ),
    },
  };
}

export function buildProviderSummaries(
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => unknown,
  nowMs: number
): ProviderQuotaSummary[] {
  const byType = new Map<QuotaProviderType, QuotaFileEntry[]>();
  for (const entry of entries) {
    const group = byType.get(entry.type);
    if (group) group.push(entry);
    else byType.set(entry.type, [entry]);
  }

  const summaries: ProviderQuotaSummary[] = [];
  for (const type of QUOTA_TAB_ORDER) {
    const group = byType.get(type);
    if (!group || group.length === 0) continue;
    summaries.push(summarizeProvider(type, group, quotaFor, nowMs));
  }
  return summaries;
}
