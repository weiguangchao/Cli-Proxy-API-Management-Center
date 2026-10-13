/**
 * The provider card is the 7-day remaining of each account.
 * A tighter model window (Claude Fable, a Codex extra weekly limit) must not
 * replace that window or get painted into the segments.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaProviderSummary } from '@/features/quota/components/QuotaProviderSummary';
import { buildProviderSummaries } from '@/features/quota/providerSummary';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type { AuthFileItem } from '@/types';

const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);

const entry = (type: QuotaProviderType, name: string): QuotaFileEntry => ({
  type,
  file: { name } as AuthFileItem,
});

const quotaFor = (states: Record<string, unknown>) => (item: QuotaFileEntry) =>
  states[item.file.name];

describe('buildProviderSummaries', () => {
  test('uses each Claude account 7-day remaining and ignores a tighter Fable window', () => {
    const entries = [entry('claude', 'a'), entry('claude', 'b'), entry('claude', 'c')];
    const summaries = buildProviderSummaries(
      entries,
      quotaFor({
        a: claude({ sevenDay: 4, fable: 80, reset: NOW + DAY_MS }),
        b: claude({ sevenDay: 10, fable: 90, reset: NOW + 2 * DAY_MS }),
        c: claude({ sevenDay: 20, fable: 95, reset: NOW + 3 * DAY_MS }),
      }),
      NOW
    );

    // used 4/10/20 → remaining 96/90/80. Fable is tighter and must not win.
    expect(summaries[0]?.window).toMatchObject({
      id: 'seven-day',
      labelKey: 'claude_quota.seven_day',
      remainingPercent: 266,
      capacityPercent: 300,
      resetAtMs: NOW + DAY_MS,
    });
    expect(summaries[0]?.accounts.map((account) => account.remaining)).toEqual([96, 90, 80]);
  });

  test('uses the Codex account weekly limit, not a model weekly window', () => {
    const summaries = buildProviderSummaries(
      [entry('codex', 'a'), entry('codex', 'b')],
      quotaFor({
        a: {
          status: 'success',
          windows: [
            {
              id: 'five-hour',
              labelKey: 'codex_quota.primary_window',
              usedPercent: 70,
              resetAtMs: NOW + HOUR_MS,
              periodHours: 5,
            },
            {
              id: 'spark-weekly-0',
              labelKey: 'codex_quota.additional_secondary_window',
              labelParams: { name: 'Spark' },
              usedPercent: 90,
              resetAtMs: NOW + DAY_MS,
              periodHours: 168,
            },
            {
              id: 'weekly',
              labelKey: 'codex_quota.secondary_window',
              usedPercent: 3,
              resetAtMs: NOW + 6 * DAY_MS,
              periodHours: 168,
            },
          ],
        },
        b: {
          status: 'success',
          windows: [
            {
              id: 'weekly',
              labelKey: 'codex_quota.secondary_window',
              usedPercent: 10,
              resetAtMs: NOW + 5 * DAY_MS,
              periodHours: 168,
            },
          ],
        },
      }),
      NOW
    );

    expect(summaries[0]?.window).toMatchObject({
      id: 'weekly',
      labelKey: 'codex_quota.secondary_window',
      remainingPercent: 187,
      capacityPercent: 200,
      resetAtMs: NOW + 5 * DAY_MS,
    });
    expect(summaries[0]?.accounts.map((account) => account.remaining)).toEqual([97, 90]);
  });

  test('keeps an unloaded account as its own empty segment', () => {
    const summaries = buildProviderSummaries(
      [entry('claude', 'loaded'), entry('claude', 'idle')],
      quotaFor({
        loaded: claude({ sevenDay: 8, fable: 40, reset: NOW + DAY_MS }),
      }),
      NOW
    );

    expect(summaries[0]?.accounts.map((account) => account.remaining)).toEqual([92, null]);
    expect(summaries[0]?.window).toMatchObject({
      remainingPercent: 92,
      capacityPercent: 100,
    });
  });

  test('keeps a weekly xAI reset when the percent is unknown', () => {
    const summaries = buildProviderSummaries(
      [entry('xai', 'grok')],
      quotaFor({
        grok: {
          status: 'success',
          billing: {
            periodType: 'weekly',
            usagePercent: null,
            resetAtMs: NOW + 2 * DAY_MS,
            periodHours: 168,
          },
        },
      }),
      NOW
    );

    expect(summaries[0]?.accounts.map((account) => account.remaining)).toEqual([null]);
    expect(summaries[0]?.window).toMatchObject({
      id: 'weekly',
      labelKey: 'xai_quota.weekly_limit',
      remainingPercent: null,
      capacityPercent: 100,
      resetAtMs: NOW + 2 * DAY_MS,
    });
  });
});

describe('QuotaProviderSummary', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  test('renders one segment per account for the 7-day window, not Fable', () => {
    const summaries = buildProviderSummaries(
      [entry('claude', 'a'), entry('claude', 'b')],
      quotaFor({
        a: claude({ sevenDay: 4, fable: 80, reset: NOW + DAY_MS }),
        b: claude({ sevenDay: 55, fable: 10, reset: NOW + 2 * DAY_MS }),
      }),
      NOW
    );
    const markup = renderToStaticMarkup(
      createElement(QuotaProviderSummary, {
        summaries,
        resolvedTheme: 'dark',
        nowMs: NOW,
      })
    );

    expect(markup).toContain('7-day limit');
    expect(markup).not.toContain('Fable');
    expect(markup).toContain('aria-valuenow="96"');
    expect(markup).toContain('aria-valuenow="45"');
    expect(markup.match(/role="meter"/g)).toHaveLength(2);
  });
});

function claude(spec: { sevenDay: number; fable: number; reset: number }) {
  return {
    status: 'success' as const,
    windows: [
      {
        id: 'five-hour',
        labelKey: 'claude_quota.five_hour',
        usedPercent: 60,
        resetAtMs: NOW + HOUR_MS,
        periodHours: 5,
      },
      {
        id: 'seven-day',
        labelKey: 'claude_quota.seven_day',
        usedPercent: spec.sevenDay,
        resetAtMs: spec.reset,
        periodHours: 168,
      },
      {
        id: 'seven-day-fable',
        labelKey: 'claude_quota.seven_day_fable',
        usedPercent: spec.fable,
        resetAtMs: spec.reset,
        periodHours: 168,
      },
    ],
  };
}
