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
import { AntigravityQuotaBody } from '@/features/quota/providers/antigravity/AntigravityQuotaBody';
import { sortAntigravityQuotaGroups } from '@/features/quota/providers/antigravity/data';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { KimiQuotaBody } from '@/features/quota/providers/kimi/KimiQuotaBody';
import { MetaQuotaBody } from '@/features/quota/providers/meta/MetaQuotaBody';
import { XaiQuotaBody } from '@/features/quota/providers/xai/XaiQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses, type QuotaBodySections } from '@/features/quota/types';
import { maskEmail } from '@/utils/format';
import { getQuotaAccountLabel } from '@/utils/quota/identity';
import { buildXaiBillingSummary } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type {
  AntigravityQuotaGroup,
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

describe('account column', () => {
  test('masks the email local part and keeps the domain', () => {
    expect(maskEmail('alice.wonderland@example.com')).toBe('ali***@example.com');
    expect(maskEmail('bob@example.org')).toBe('b***@example.org');
    expect(maskEmail('ab@example.net')).toBe('a***@example.net');
    expect(maskEmail('  carol@example.net ')).toBe('ca***@example.net');
    expect(maskEmail('a.b@c@example.com')).toBe('a.***@example.com');
    expect(maskEmail('not-an-email')).toBe('not***');
    expect(maskEmail('')).toBe('');
  });

  test('shows the masked email and never the file name when an email exists', () => {
    const file = {
      name: 'claude-a96c9d90-alice.wonderland@example.com-pro.json',
      email: 'alice.wonderland@example.com',
    } as AuthFileItem;
    expect(getQuotaAccountLabel(file)).toBe('ali***@example.com');
  });

  test('falls back to the file name, never to account secrets', () => {
    expect(getQuotaAccountLabel({ name: 'kimi-1.json' } as AuthFileItem)).toBe('kimi-1.json');
    expect(getQuotaAccountLabel({ name: 'k.json', email: '  ' } as AuthFileItem)).toBe('k.json');
    expect(getQuotaAccountLabel({ name: 'k.json', email: 42, account: 'sk-secret' } as never)).toBe(
      'k.json'
    );
  });
});

describe('provider body sections', () => {
  test('Claude puts the plan under the name, extra usage beside the actions', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      planType: 'plan_max20',
      extraUsage: {
        isEnabled: true,
        usedCredits: 150,
        monthlyLimit: 5000,
        utilization: null,
        currency: 'USD',
        disabledReason: null,
        userDisabled: null,
        spendLimitReached: null,
      },
      dollarWindows: [
        {
          key: 'independent_balance',
          limitDollars: 100,
          usedDollars: 5.04,
          remainingDollars: 94.96,
          utilization: 5.04,
          resetsAt: null,
        },
      ],
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
    expect(slotOf(markup, 'details')).toContain('$94.96 remaining');
    expect(slotOf(markup, 'details')).toContain('independent_balance');
    expect(slotOf(markup, 'windows')).not.toContain('independent_balance');
    expect(slotOf(markup, 'details')).not.toContain('quotaBar');
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

  test('xAI keeps used percentage in the list and disabled pay-as-you-go in details', () => {
    const markup = renderToStaticMarkup(
      createElement(XaiQuotaBody, {
        quota: {
          status: 'success',
          billing: buildXaiBillingSummary({
            creditUsagePercent: 37,
            currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY' },
            onDemandCap: { val: 0 },
          }),
        },
        classes,
        layout: slots,
      })
    );
    expect(slotOf(markup, 'windows')).toContain('Used 37%');
    expect(slotOf(markup, 'windows')).toContain('width:63%');
    expect(slotOf(markup, 'windows')).not.toContain('Pay as you go');
    expect(slotOf(markup, 'details')).toContain('Pay as you go');
    expect(slotOf(markup, 'details')).toContain('Disabled');
  });

  test.each([true, false])('Muse keeps subscription status %s in the list details', (active) => {
    const markup = renderToStaticMarkup(
      createElement(MetaQuotaBody, {
        quota: {
          status: 'success',
          data: {
            planName: 'Muse Pro',
            isSubscriptionActive: active,
            windows: [{ id: 'weekly', usedPercent: 25 }],
          },
        },
        classes,
        layout: slots,
      })
    );
    expect(slotOf(markup, 'plan')).toContain('Muse Pro');
    expect(slotOf(markup, 'details')).toContain(
      active ? 'Subscription active' : 'Subscription inactive'
    );
    expect(slotOf(markup, 'windows')).toContain('75% remaining');
  });

  test('Antigravity puts Gemini first and tags each group with its bucket count', () => {
    const group = (label: string, windows: string[]): AntigravityQuotaGroup => ({
      id: label,
      label,
      buckets: windows.map((window) => ({
        id: `${label}-${window}`,
        label: `${window} limit`,
        window,
        remainingFraction: 0.5,
      })),
    });
    const groups = sortAntigravityQuotaGroups([
      group('Claude and GPT Models', ['5h', 'weekly']),
      group('Image Models', ['weekly']),
      group('Gemini Models', ['weekly']),
    ]);
    expect(groups.map(({ label }) => label)).toEqual([
      'Gemini Models',
      'Claude and GPT Models',
      'Image Models',
    ]);

    const markup = renderToStaticMarkup(
      createElement(AntigravityQuotaBody, {
        quota: { status: 'success', groups },
        classes,
        layout: slots,
      })
    );
    const windows = slotOf(markup, 'windows');
    expect(windows.indexOf('Gemini models')).toBeLessThan(windows.indexOf('Claude and GPT models'));
    expect(windows.match(/data-buckets="\d+"/g)).toEqual([
      'data-buckets="1"',
      'data-buckets="2"',
      'data-buckets="1"',
    ]);
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
  const rowCss = () => Bun.file('src/features/quota/components/QuotaAccountRow.module.scss').text();

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

  test('shows the masked account label instead of the file name', async () => {
    const row = await source();
    expect(row).toContain('getQuotaAccountLabel(file)');
    expect(row).not.toContain('getQuotaDisplayName');
  });

  test('draws no divider under the last row of a provider group', async () => {
    const css = await rowCss();
    expect(css).toMatch(
      /\.row \{[\s\S]*?border-bottom: 1px solid[\s\S]*?&:last-child \{\s*border-bottom: 0;/
    );
  });

  test('stretches the idle load button over every column after the account', async () => {
    const row = await source();
    const css = await rowCss();
    expect(row).toContain("data-idle={status === 'idle' ? '' : undefined}");
    // Actions only exist once a fetch was attempted, so the idle row has nothing to its right.
    expect(row).toContain("{status !== 'idle' && (");
    expect(css).toMatch(/\.row\[data-idle\] \.windows \{\s*grid-column-end: -1;/);
  });

  test('spans Antigravity groups side by side only when the windows column fits them', async () => {
    const css = await bodyCss();
    expect(css).toContain('container: quota-windows / inline-size;');
    expect(css).toMatch(
      /@container quota-windows \(min-width: #\{\$n \* \$window-min \+ \(\$n - 1\) \* \$window-gap\}\)/
    );
    expect(css).toMatch(/\[data-buckets='#\{\$n\}'\] \{\s*grid-column: span \$n;/);
    // Side-by-side groups would misalign under the stacked-group divider.
    expect(css).toContain('&:not([data-buckets]) + &:not([data-buckets])');
  });

  test('dims exhausted rows but keeps the depleted limit at full brightness', async () => {
    const row = await source();
    const css = await bodyCss();
    expect(row).toContain("data-exhausted={exhaustion ? '' : undefined}");
    expect(css).toMatch(/\[data-exhausted\] \.listWindows \{[\s\S]*?opacity: 0\.4;/);
    expect(css).toMatch(/\.quotaRow:has\(\[data-depleted\]\) \{\s*opacity: 1;\s*filter: none;/);
  });
});
