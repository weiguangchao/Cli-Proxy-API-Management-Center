/**
 * Whether a credential has run out of usable quota, and when it comes back.
 *
 * The list dims an exhausted account and says "back in 9h 45m" beside it, so
 * the question here is narrower than "is any bar at zero": a model-scoped
 * window (Claude's 7-day Opus, a Codex code-review limit) running dry leaves
 * the account usable for everything else, and dimming it would hide a working
 * credential.
 *
 * Limits are therefore read as *pools*. A pool is blocked while any of its
 * limits sits at zero with a reset still ahead; the account is exhausted only
 * when every pool is blocked. Most providers have one pool (5-hour + weekly);
 * Antigravity and plugin quotas have one per model group, since running out of
 * Gemini does not stop Claude-and-GPT requests.
 *
 * Pure and React-free: `nowMs` is passed in and quota state is read
 * structurally, like resetSchedule.ts.
 */

import type { TFunction } from 'i18next';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import type { QuotaProviderType } from './providers/types';

export interface QuotaExhaustion {
  /** Instant the first pool regains capacity; null when no blocking limit reports a reset. */
  recoversAtMs: number | null;
}

interface PoolLimit {
  /** Remaining capacity, 0..100. Null when the provider did not report usage. */
  remaining: number | null;
  resetAtMs: number | null;
}

type Pool = PoolLimit[];

/** Account-wide windows — model- and feature-scoped windows never exhaust the account. */
const CLAUDE_ACCOUNT_WINDOW_IDS = new Set(['five-hour', 'seven-day']);
const CODEX_ACCOUNT_WINDOW_IDS = new Set(['five-hour', 'weekly', 'monthly']);

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const remainingFromUsed = (used: unknown): number | null => {
  const value = finiteOrNull(used);
  return value === null ? null : 100 - value;
};

interface UsedWindowLike {
  id?: string;
  usedPercent?: number | null;
  resetAtMs?: number | null;
}

interface BucketLike {
  remainingFraction?: number | null;
  resetAtMs?: number | null;
}

const usedWindowsPool = (windows: readonly UsedWindowLike[], ids: ReadonlySet<string>): Pool =>
  windows
    .filter((window) => window.id !== undefined && ids.has(window.id))
    .map((window) => ({
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: finiteOrNull(window.resetAtMs),
    }));

const bucketPool = (buckets: readonly BucketLike[]): Pool =>
  buckets.map((bucket) => {
    const fraction = finiteOrNull(bucket.remainingFraction);
    return {
      remaining: fraction === null ? null : fraction * 100,
      resetAtMs: finiteOrNull(bucket.resetAtMs),
    };
  });

/** Limit pools for one credential, read structurally per provider. */
function collectPools(provider: QuotaProviderType, quota: unknown): Pool[] {
  if (provider === 'claude' || provider === 'codex') {
    const windows = (quota as { windows?: UsedWindowLike[] }).windows ?? [];
    const ids = provider === 'claude' ? CLAUDE_ACCOUNT_WINDOW_IDS : CODEX_ACCOUNT_WINDOW_IDS;
    return [usedWindowsPool(windows, ids)];
  }

  if (provider === 'devin') {
    const windows =
      (quota as { windows?: { remainingPercent?: number | null; resetAtMs?: number | null }[] })
        .windows ?? [];
    return [
      windows.map((window) => ({
        remaining: finiteOrNull(window.remainingPercent),
        resetAtMs: finiteOrNull(window.resetAtMs),
      })),
    ];
  }

  if (provider === 'meta') {
    const windows =
      (quota as { data?: { windows?: { usedPercent: number | null; resetAt?: number }[] } }).data
        ?.windows ?? [];
    return [
      windows.map((window) => {
        const resetAt = finiteOrNull(window.resetAt);
        return {
          remaining: remainingFromUsed(window.usedPercent),
          // Unix seconds upstream.
          resetAtMs: resetAt === null ? null : resetAt * 1000,
        };
      }),
    ];
  }

  if (provider === 'kimi') {
    const rows =
      (quota as { rows?: { used: number; limit: number; resetAtMs?: number | null }[] }).rows ?? [];
    return [
      rows.map((row) => ({
        // Mirrors KimiQuotaBody: a zero limit with usage is spent, without usage is unknown.
        remaining:
          row.limit > 0 ? ((row.limit - row.used) / row.limit) * 100 : row.used > 0 ? 0 : null,
        resetAtMs: finiteOrNull(row.resetAtMs),
      })),
    ];
  }

  if (provider === 'xai') {
    // Only the weekly limit is a rate window; the monthly figure is a billing cycle.
    const billing = (
      quota as {
        billing?: {
          periodType?: string;
          usagePercent?: number | null;
          resetAtMs?: number | null;
        } | null;
      }
    ).billing;
    if (!billing || billing.periodType !== 'weekly') return [];
    return [
      [
        {
          remaining: remainingFromUsed(billing.usagePercent),
          resetAtMs: finiteOrNull(billing.resetAtMs),
        },
      ],
    ];
  }

  if (provider === 'antigravity' || provider === 'plugin') {
    const groups = (quota as { groups?: { buckets?: BucketLike[] }[] }).groups ?? [];
    return groups.map((group) => bucketPool(group.buckets ?? []));
  }

  return [];
}

/**
 * Null while the credential still has usable capacity somewhere.
 *
 * A depleted limit whose reset is already behind `nowMs` no longer blocks:
 * the window turned over since the last fetch, so the account is usable even
 * though the cached bar still reads zero.
 */
export function resolveQuotaExhaustion(
  provider: QuotaProviderType,
  quota: unknown,
  nowMs: number
): QuotaExhaustion | null {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return null;

  const pools = collectPools(provider, quota).filter((pool) => pool.length > 0);
  if (pools.length === 0) return null;

  // A pool returns once its *last* blocking limit resets; unknown resets make it unknown.
  const poolRecoveries: (number | null)[] = [];
  for (const pool of pools) {
    const blocking = pool.filter(
      (limit) =>
        limit.remaining !== null &&
        limit.remaining <= 0 &&
        (limit.resetAtMs === null || limit.resetAtMs > nowMs)
    );
    if (blocking.length === 0) return null;
    poolRecoveries.push(
      blocking.some((limit) => limit.resetAtMs === null)
        ? null
        : Math.max(...blocking.map((limit) => limit.resetAtMs as number))
    );
  }

  const known = poolRecoveries.filter((atMs): atMs is number => atMs !== null);
  return { recoversAtMs: known.length > 0 ? Math.min(...known) : null };
}

/** Compact countdown for the "back in …" hint: `2d 4h`, `9h 45m`, `12m`, `<1m`. */
export function formatRecoveryDuration(t: TFunction, deltaMs: number): string {
  if (deltaMs < MINUTE_MS) return t('quota_management.duration_less_than_minute');
  const days = Math.floor(deltaMs / DAY_MS);
  const hours = Math.floor((deltaMs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((deltaMs % HOUR_MS) / MINUTE_MS);
  if (days > 0) return t('quota_management.duration_day_hour', { days, hours });
  if (hours > 0) return t('quota_management.duration_hour_minute', { hours, minutes });
  return t('quota_management.duration_minute', { minutes });
}
