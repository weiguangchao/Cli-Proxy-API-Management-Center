import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { formatRecoveryDuration, resolveQuotaExhaustion } from '@/features/quota/exhaustion';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

const claude = (
  windows: { id: string; usedPercent: number | null; resetAtMs?: number | null }[]
) => ({
  status: 'success',
  windows: windows.map((window) => ({ label: window.id, resetLabel: '-', ...window })),
});

describe('resolveQuotaExhaustion', () => {
  test('ignores anything that has not loaded successfully', () => {
    const spent = claude([{ id: 'seven-day', usedPercent: 100, resetAtMs: NOW + HOUR_MS }]);
    expect(resolveQuotaExhaustion('claude', undefined, NOW)).toBeNull();
    expect(resolveQuotaExhaustion('claude', { ...spent, status: 'loading' }, NOW)).toBeNull();
    expect(resolveQuotaExhaustion('claude', { ...spent, status: 'error' }, NOW)).toBeNull();
  });

  test('an account-wide window at zero exhausts the account until it resets', () => {
    const quota = claude([
      { id: 'five-hour', usedPercent: 0, resetAtMs: null },
      { id: 'seven-day', usedPercent: 100, resetAtMs: NOW + 9 * HOUR_MS },
    ]);
    expect(resolveQuotaExhaustion('claude', quota, NOW)).toEqual({
      recoversAtMs: NOW + 9 * HOUR_MS,
    });
  });

  test('a model-scoped window at zero leaves the account usable', () => {
    const quota = claude([
      { id: 'five-hour', usedPercent: 20, resetAtMs: NOW + HOUR_MS },
      { id: 'seven-day-opus', usedPercent: 100, resetAtMs: NOW + DAY_MS },
      { id: 'seven-day-fable', usedPercent: 100, resetAtMs: NOW + DAY_MS },
    ]);
    expect(resolveQuotaExhaustion('claude', quota, NOW)).toBeNull();
  });

  test('a window whose reset already passed no longer blocks', () => {
    const quota = claude([{ id: 'five-hour', usedPercent: 100, resetAtMs: NOW - MINUTE_MS }]);
    expect(resolveQuotaExhaustion('claude', quota, NOW)).toBeNull();
  });

  test('the account returns only once every blocking window in the pool has reset', () => {
    const quota = claude([
      { id: 'five-hour', usedPercent: 100, resetAtMs: NOW + HOUR_MS },
      { id: 'seven-day', usedPercent: 104, resetAtMs: NOW + 3 * DAY_MS },
    ]);
    expect(resolveQuotaExhaustion('claude', quota, NOW)?.recoversAtMs).toBe(NOW + 3 * DAY_MS);
  });

  test('a blocking window without a reset instant leaves recovery unknown', () => {
    const quota = claude([
      { id: 'five-hour', usedPercent: 100, resetAtMs: NOW + HOUR_MS },
      { id: 'seven-day', usedPercent: 100, resetAtMs: null },
    ]);
    expect(resolveQuotaExhaustion('claude', quota, NOW)).toEqual({ recoversAtMs: null });
  });

  test('unknown usage is never read as exhausted', () => {
    const quota = claude([{ id: 'seven-day', usedPercent: null, resetAtMs: NOW + HOUR_MS }]);
    expect(resolveQuotaExhaustion('claude', quota, NOW)).toBeNull();
  });

  test('Codex code-review and model limits do not exhaust the account', () => {
    const windows = (weeklyUsed: number) => ({
      status: 'success',
      windows: [
        { id: 'five-hour', usedPercent: 10, resetAtMs: NOW + HOUR_MS },
        { id: 'weekly', usedPercent: weeklyUsed, resetAtMs: NOW + 2 * DAY_MS },
        { id: 'code-review-weekly', usedPercent: 100, resetAtMs: NOW + DAY_MS },
        { id: 'gpt-5-3-codex-spark-weekly-0', usedPercent: 100, resetAtMs: NOW + DAY_MS },
      ],
    });
    expect(resolveQuotaExhaustion('codex', windows(50), NOW)).toBeNull();
    expect(resolveQuotaExhaustion('codex', windows(100), NOW)).toEqual({
      recoversAtMs: NOW + 2 * DAY_MS,
    });
  });

  test('grouped quotas are exhausted only when every group is blocked', () => {
    const group = (remainingFraction: number, resetAtMs: number) => ({
      id: `g-${resetAtMs}`,
      label: 'group',
      buckets: [{ id: 'b', label: 'b', remainingFraction, resetAtMs }],
    });
    const partial = {
      status: 'success',
      groups: [group(0, NOW + HOUR_MS), group(0.4, NOW + DAY_MS)],
    };
    const full = {
      status: 'success',
      groups: [group(0, NOW + 5 * HOUR_MS), group(0, NOW + 2 * HOUR_MS)],
    };
    expect(resolveQuotaExhaustion('antigravity', partial, NOW)).toBeNull();
    // Capacity returns as soon as the first group recovers.
    expect(resolveQuotaExhaustion('antigravity', full, NOW)?.recoversAtMs).toBe(NOW + 2 * HOUR_MS);
    expect(resolveQuotaExhaustion('plugin', { ...full, summary: [] }, NOW)?.recoversAtMs).toBe(
      NOW + 2 * HOUR_MS
    );
  });

  test('reads every provider shape', () => {
    expect(
      resolveQuotaExhaustion(
        'devin',
        {
          status: 'success',
          windows: [
            { id: 'daily', remainingPercent: 0, resetAtMs: NOW + HOUR_MS, periodHours: 24 },
          ],
        },
        NOW
      )
    ).toEqual({ recoversAtMs: NOW + HOUR_MS });

    const resetAt = Math.floor((NOW + 2 * HOUR_MS) / 1000);
    expect(
      resolveQuotaExhaustion(
        'meta',
        { status: 'success', data: { windows: [{ id: 'weekly', usedPercent: 100, resetAt }] } },
        NOW
      )
    ).toEqual({ recoversAtMs: resetAt * 1000 });

    expect(
      resolveQuotaExhaustion(
        'kimi',
        {
          status: 'success',
          rows: [{ id: 'summary', used: 50, limit: 50, resetAtMs: NOW + DAY_MS }],
        },
        NOW
      )
    ).toEqual({ recoversAtMs: NOW + DAY_MS });

    const xai = (periodType: string) => ({
      status: 'success',
      billing: { periodType, usagePercent: 100, resetAtMs: NOW + DAY_MS },
    });
    expect(resolveQuotaExhaustion('xai', xai('weekly'), NOW)).toEqual({
      recoversAtMs: NOW + DAY_MS,
    });
    // The monthly figure is a billing cycle, not a rate window.
    expect(resolveQuotaExhaustion('xai', xai('monthly'), NOW)).toBeNull();
  });
});

describe('formatRecoveryDuration', () => {
  const t = ((key: string, params?: Record<string, number>) =>
    `${key.replace('quota_management.', '')}${params ? JSON.stringify(params) : ''}`) as TFunction;

  test('uses the two coarsest units, truncating rather than rounding up', () => {
    expect(formatRecoveryDuration(t, 2 * DAY_MS + 4 * HOUR_MS + 59 * MINUTE_MS)).toBe(
      'duration_day_hour{"days":2,"hours":4}'
    );
    expect(formatRecoveryDuration(t, 9 * HOUR_MS + 45 * MINUTE_MS + 59_000)).toBe(
      'duration_hour_minute{"hours":9,"minutes":45}'
    );
    expect(formatRecoveryDuration(t, 12 * MINUTE_MS)).toBe('duration_minute{"minutes":12}');
    expect(formatRecoveryDuration(t, 30_000)).toBe('duration_less_than_minute');
  });
});
