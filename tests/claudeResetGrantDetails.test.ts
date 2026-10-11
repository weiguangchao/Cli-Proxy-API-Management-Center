import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { ClaudeResetGrantDetails } from '@/features/quota/providers/claude/ClaudeResetGrantDetails';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { bindQuotaClasses, QUOTA_CLASS_KEYS } from '@/features/quota/types';
import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import type { CodexQuotaState } from '@/types';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);
const expiry = Date.now() + 11 * 86400_000;
const grant = (overrides: Partial<AnthropicResetGrant> = {}): AnthropicResetGrant => ({
  id: 'launch',
  label: 'Launch',
  resetsTotal: 3,
  resetsLeft: 2,
  startsAt: null,
  endsAt: new Date(expiry).toISOString(),
  clears: ['five_hour'],
  paused: false,
  usableNow: true,
  useRequiresLimit: true,
  percentUsed: {},
  ...overrides,
});
const render = (
  grants: readonly AnthropicResetGrant[],
  count: number | null = grants.reduce((sum, item) => sum + item.resetsLeft, 0)
) => renderToStaticMarkup(createElement(ClaudeResetGrantDetails, { count, grants, classes }));
const renderCodex = (quota: Partial<CodexQuotaState>) =>
  renderToStaticMarkup(
    createElement(CodexQuotaBody, {
      quota: { status: 'success', windows: [], ...quota },
      classes,
      layout: ({ details }) => details,
    })
  );

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('shared reset details', () => {
  test('prints a reset balance and one expiry in the requested numeric format', () => {
    const date = new Date(new Date().getFullYear() + 1, 9, 22, 2, 42);
    const markup = render([grant({ endsAt: date.toISOString() })]);
    expect(markup).toContain('Resets remaining');
    expect(markup).toContain('<span class="codexPlanValue">2</span>');
    expect(markup).toContain('Expiry time');
    expect(markup).toContain(`10/22, 02:42 (${resolveTimeZoneLabel(date)})`);
    expect(markup).toContain(`<time dateTime="${date.toISOString()}">`);
    expect(markup).not.toContain('codexResetCreditsTitle');
    expect(markup).not.toContain('quotaResetRelative');
    expect(markup).not.toContain('Launch');
  });

  test('zero resets render only the balance, even if stale dates remain', () => {
    for (const markup of [
      render([]),
      render([grant({ resetsLeft: 0 })]),
      render([grant()], 0),
      renderCodex({
        rateLimitResetCreditsAvailableCount: 0,
        rateLimitResetCredits: [
          {
            id: 'stale',
            status: 'available',
            grantedAt: '',
            expiresAt: new Date(expiry).toISOString(),
          },
        ],
        rateLimitResetCreditsError: 'stale read error',
      }),
    ]) {
      expect(markup).toContain('<span class="codexPlanValue">0</span>');
      expect(markup).not.toContain('Expiry');
      expect(markup).not.toContain('codexResetCredits');
      expect(markup).not.toContain('<time');
      expect(markup).not.toContain('stale read error');
    }
  });

  test('does not confuse an unread balance with zero', () => {
    expect(render([], null)).toContain('<span class="codexPlanValue">--</span>');
  });

  test('selects only the nearest future unspent grant without mutating input', () => {
    const nearest = new Date(expiry).toISOString();
    const grants = [
      grant({ id: 'unknown', endsAt: null }),
      grant({ id: 'later', endsAt: new Date(expiry + 86400_000).toISOString() }),
      grant({ id: 'spent', endsAt: new Date(expiry - 86400_000).toISOString(), resetsLeft: 0 }),
      grant({ id: 'expired', endsAt: '2020-01-01T00:00:00Z' }),
      grant({ id: 'invalid', endsAt: 'invalid' }),
      grant({ id: 'first', endsAt: nearest }),
    ];
    const original = structuredClone(grants);
    const markup = render(grants);
    expect(markup.match(/<time /g)).toHaveLength(1);
    expect(markup).toContain(`<time dateTime="${nearest}">`);
    expect(grants).toEqual(original);
  });

  test('Codex also ignores consumed and expired credits before selecting the nearest expiry', () => {
    const nearest = new Date(expiry).toISOString();
    const markup = renderCodex({
      rateLimitResetCreditsAvailableCount: 2,
      rateLimitResetCredits: [
        {
          id: 'later',
          status: 'available',
          grantedAt: '',
          expiresAt: new Date(expiry + 86400_000).toISOString(),
        },
        { id: 'expired', status: 'available', grantedAt: '', expiresAt: '2020-01-01T00:00:00Z' },
        {
          id: 'used',
          status: 'consumed',
          grantedAt: '',
          expiresAt: new Date(expiry - 86400_000).toISOString(),
        },
        { id: 'first', status: 'available', grantedAt: '', expiresAt: nearest },
      ],
    });
    expect(markup.match(/<time /g)).toHaveLength(1);
    expect(markup).toContain(`<time dateTime="${nearest}">`);
  });

  test('does not invent an expiry when all deadlines are absent, invalid or passed', () => {
    const markup = render([
      grant({ id: 'absent', endsAt: null }),
      grant({ id: 'invalid', endsAt: 'not-a-date' }),
      grant({ id: 'passed', endsAt: '2020-01-01T00:00:00Z' }),
    ]);
    expect(markup).not.toContain('<time');
    expect(markup).not.toContain('Expiry time');
  });

  test('keeps a future paused grant visible without implying usability', () => {
    const markup = render([grant({ paused: true, usableNow: false })]);
    expect(markup).toContain('<time');
    expect(markup).not.toContain('<button');
  });

  test('uses the selected expiry instant for its timezone offset across DST changes', () => {
    const year = new Date().getFullYear() + 1;
    const winter = new Date(year, 0, 15, 12).toISOString();
    const summer = new Date(year, 6, 15, 12).toISOString();
    const offset = spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (
      this: Date
    ) {
      return this.getMonth() === 0 ? 480 : 420;
    });
    try {
      expect(render([grant({ endsAt: winter })])).toContain('(GMT-8)');
      expect(render([grant({ endsAt: summer })])).toContain('(GMT-7)');
    } finally {
      offset.mockRestore();
    }
  });

  test.each(['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko'])(
    'renders identical count and expiry details for both providers in %s',
    async (lng) => {
      await i18n.changeLanguage(lng);
      try {
        for (const count of [0, 1, 3]) {
          const grants = [
            grant({
              id: 'later',
              resetsLeft: count,
              endsAt: new Date(expiry + 86400_000).toISOString(),
            }),
            grant({ id: 'first', resetsLeft: 0, endsAt: new Date(expiry).toISOString() }),
          ];
          const claude = render(grants, count);
          const codex = renderCodex({
            rateLimitResetCreditsAvailableCount: count,
            rateLimitResetCredits: grants.map((item) => ({
              id: item.id,
              status: item.resetsLeft > 0 ? 'available' : 'consumed',
              grantedAt: '',
              expiresAt: item.endsAt!,
            })),
          });
          expect(codex).toBe(claude);
          expect(claude).toContain(i18n.t('quota_management.resets_remaining'));
          if (count > 0) expect(claude).toContain(i18n.t('quota_management.reset_expiry'));
          expect(claude).not.toContain('quota_management.');
        }
      } finally {
        await i18n.changeLanguage('en');
      }
    }
  );
});
