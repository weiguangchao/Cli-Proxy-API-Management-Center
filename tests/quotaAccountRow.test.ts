import { describe, expect, mock, test } from 'bun:test';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { QUOTA_CLASS_KEYS } from '@/features/quota/types';
import type { CodexQuotaState } from '@/types';

// Bun does not compile SCSS modules; supply class names without replacing row behavior.
mock.module(
  join(import.meta.dir, '../src/features/quota/components/QuotaBody.module.scss'),
  () => ({ default: Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])) })
);

const { QuotaAccountRow } = await import('@/features/quota/components/QuotaAccountRow');
const translations = i18n.cloneInstance({ lng: 'en' });

function renderRow(
  quota: CodexQuotaState,
  { canRefresh = true, resetting = false, type = 'codex' as 'codex' | 'claude' } = {}
) {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: translations },
      createElement(QuotaAccountRow, {
        entry: { type, file: { name: 'quota-test.json', type } },
        quota,
        resolvedTheme: 'light',
        showProviderIcon: false,
        canRefresh,
        resetting,
        onRefresh: () => {},
        onReset: () => {},
      })
    )
  );
}

function buttonAttributes(markup: string, title: string) {
  const buttons = [...markup.matchAll(/<button\b([^>]*)>/g)].filter(([, attributes]) =>
    attributes.includes(`title="${title}"`)
  );
  expect(buttons).toHaveLength(1);
  return buttons[0][1];
}

describe('quota account reset action', () => {
  test.each([
    { count: 0, disabled: true },
    { count: null, disabled: true },
    { count: undefined, disabled: true },
    { count: 1, disabled: false },
  ])('keeps the Codex reset button visible with $count credits', ({ count, disabled }) => {
    const markup = renderRow({
      status: 'success',
      windows: [],
      rateLimitResetCreditsAvailableCount: count,
    });
    const reset = buttonAttributes(markup, translations.t('codex_quota.reset_button'));
    expect(reset.includes('disabled=""')).toBe(disabled);
    const refresh = buttonAttributes(markup, translations.t('auth_files.quota_refresh_hint'));
    expect(refresh).not.toContain('disabled=""');
  });

  test.each([
    { canRefresh: false, resetting: false },
    { canRefresh: true, resetting: true },
  ])('keeps existing reset guards for %j', (controls) => {
    const markup = renderRow(
      { status: 'success', windows: [], rateLimitResetCreditsAvailableCount: 1 },
      controls
    );
    expect(buttonAttributes(markup, translations.t('codex_quota.reset_button'))).toContain(
      'disabled=""'
    );
  });

  test('does not add the Codex reset action to other providers', () => {
    const markup = renderRow({ status: 'success', windows: [] }, { type: 'claude' });
    expect(markup).not.toContain(`title="${translations.t('codex_quota.reset_button')}"`);
  });
});
