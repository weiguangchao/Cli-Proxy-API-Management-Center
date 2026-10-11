/**
 * The quota page renders each credential as one list row: account | windows |
 * details. Provider bodies hand their three sections to the row through the
 * optional `layout` callback; without it they must keep stacking exactly as
 * the auth-file cards expect (quotaBodyRendering.test.ts pins that output).
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaMeter } from '@/features/quota/components/QuotaMeter';
import { groupQuotaEntries, type QuotaFileEntry } from '@/features/quota/logic';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { KimiQuotaBody } from '@/features/quota/providers/kimi/KimiQuotaBody';
import { XaiQuotaBody } from '@/features/quota/providers/xai/XaiQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses, type QuotaBodySections } from '@/features/quota/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type {
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
  XaiQuotaState,
} from '@/types';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);
const now = Date.now();

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

/** Renders each section into a tagged slot so assertions can tell them apart. */
const slots = ({ plan, details, windows }: QuotaBodySections): ReactNode =>
  createElement(
    'div',
    null,
    createElement('section', { 'data-slot': 'plan' }, plan),
    createElement('section', { 'data-slot': 'details' }, details),
    createElement('section', { 'data-slot': 'windows' }, windows)
  );

const slotOf = (markup: string, slot: string): string => {
  const match = markup.match(new RegExp(`<section data-slot="${slot}">(.*?)</section>`));
  if (!match) throw new Error(`missing slot ${slot}`);
  return match[1];
};

describe('groupQuotaEntries', () => {
  const entry = (name: string, type: QuotaFileEntry['type']): QuotaFileEntry => ({
    file: { name } as AuthFileItem,
    type,
  });
  const entries = [
    entry('a', 'claude'),
    entry('b', 'claude'),
    entry('c', 'codex'),
    entry('d', 'plugin'),
  ];

  test('puts each provider under one heading in the default order', () => {
    const groups = groupQuotaEntries(entries, 'default');
    expect(groups.map((group) => group.type)).toEqual(['claude', 'codex', 'plugin']);
    expect(groups[0].entries.map((item) => item.file.name)).toEqual(['a', 'b']);
  });

  test('keeps "soonest recovery" as one flat list so the ordering survives', () => {
    const interleaved = [entries[2], entries[0], entries[3], entries[1]];
    const groups = groupQuotaEntries(interleaved, 'soonest');
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBeNull();
    expect(groups[0].entries).toEqual(interleaved);
  });

  test('renders nothing for an empty page', () => {
    expect(groupQuotaEntries([], 'default')).toEqual([]);
    expect(groupQuotaEntries([], 'soonest')).toEqual([]);
  });
});

describe('provider body sections', () => {
  test('Claude puts the plan under the name, extra usage beside the actions', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      planType: 'plan_max20',
      extraUsage: { is_enabled: true, used_credits: 150, monthly_limit: 5000 } as never,
      windows: [
        {
          id: 'seven-day',
          label: '7-day limit',
          labelKey: 'claude_quota.seven_day',
          usedPercent: 2,
          resetLabel: '10-14 09:00',
          resetAtMs: now + 3 * DAY_MS,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(ClaudeQuotaBody, { quota, classes, layout: slots })
    );

    expect(slotOf(markup, 'plan')).toBe('<span class="codexPlanValue">Max 20x</span>');
    expect(slotOf(markup, 'details')).toContain('$1.50 / $50.00');
    expect(slotOf(markup, 'windows')).toContain('7-day limit');
    expect(slotOf(markup, 'windows')).toContain('98%');
    // The label belongs to the stacked chip only; the list prints the value alone.
    expect(markup).not.toContain('codexPlanLabel">Plan<');
  });

  test('Codex keeps its plan badge and moves reset credits to the details', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      planType: 'pro',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 40,
          resetLabel: '08-02 18:00',
          resetAtMs: now + 3 * HOUR_MS,
        },
      ],
      rateLimitResetCreditsAvailableCount: 1,
      rateLimitResetCredits: [
        {
          id: 'credit-1',
          status: 'available',
          grantedAt: new Date(now - DAY_MS).toISOString(),
          expiresAt: new Date(now + 11 * DAY_MS).toISOString(),
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(CodexQuotaBody, { quota, classes, layout: slots })
    );

    expect(slotOf(markup, 'plan')).toBe('<span class="elitePlanValue">Pro 200</span>');
    expect(slotOf(markup, 'details')).toContain('codexResetCredits');
    expect(slotOf(markup, 'details')).toContain('codexPlanItem');
    expect(slotOf(markup, 'windows')).toContain('5-hour limit');
    expect(slotOf(markup, 'windows')).not.toContain('codexResetCredits');
  });

  test('xAI paid-health keeps its premium badge and health message', () => {
    const quota = {
      status: 'success',
      billing: { mode: 'paid-health', planLabel: null, planTier: null },
    } as unknown as XaiQuotaState;
    const markup = renderToStaticMarkup(
      createElement(XaiQuotaBody, { quota, classes, layout: slots })
    );

    expect(slotOf(markup, 'plan')).toContain('premiumPlanValue');
    expect(slotOf(markup, 'details')).toBe('');
    expect(slotOf(markup, 'windows')).toContain('quotaMessage');
  });

  test('Kimi has windows only, empty state included', () => {
    const empty: KimiQuotaState = { status: 'success', rows: [] };
    const markup = renderToStaticMarkup(
      createElement(KimiQuotaBody, { quota: empty, classes, layout: slots })
    );
    expect(slotOf(markup, 'plan')).toBe('');
    expect(slotOf(markup, 'windows')).toContain('quotaMessage');
  });
});

describe('QuotaMeter', () => {
  test('marks a depleted limit so an exhausted row can keep it legible', () => {
    const depleted = renderToStaticMarkup(createElement(QuotaMeter, { percent: 0, classes }));
    const partial = renderToStaticMarkup(createElement(QuotaMeter, { percent: 0.4, classes }));
    const unknown = renderToStaticMarkup(createElement(QuotaMeter, { percent: null, classes }));

    expect(depleted).toContain('data-depleted=""');
    expect(partial).not.toContain('data-depleted');
    expect(unknown).not.toContain('data-depleted');
  });
});

describe('QuotaAccountRow contract', () => {
  // The row binds a stylesheet at import time, which bun cannot resolve to class
  // names (see quotaClassContract.test.ts), so its wiring is checked as source.
  const source = () => Bun.file('src/features/quota/components/QuotaAccountRow.tsx').text();
  const bodyCss = () => Bun.file('src/features/quota/components/QuotaBody.module.scss').text();

  test('lays out the body through its sections and keeps actions outside it', async () => {
    const row = await source();
    expect(row).toContain('layout={renderColumns}');
    // Actions are a sibling of the body, so a refresh does not remount the focused button.
    const bodyAt = row.indexOf('<adapter.Body');
    const actionsAt = row.indexOf('<div className={styles.actions}>');
    expect(bodyAt).toBeGreaterThan(-1);
    expect(actionsAt).toBeGreaterThan(bodyAt);
    expect(row.slice(bodyAt, actionsAt)).toContain(')}');
  });

  test('dims exhausted rows but keeps the depleted limit at full brightness', async () => {
    const row = await source();
    const css = await bodyCss();
    expect(row).toContain("data-exhausted={exhaustion ? '' : undefined}");
    expect(css).toMatch(/\[data-exhausted\] \.listWindows \{[\s\S]*?opacity: 0\.4;/);
    expect(css).toMatch(/\.quotaRow:has\(\[data-depleted\]\) \{\s*opacity: 1;\s*filter: none;/);
  });
});
