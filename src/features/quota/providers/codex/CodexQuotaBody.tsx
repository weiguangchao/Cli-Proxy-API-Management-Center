/**
 * Codex 额度渲染体：套餐 chip 行（elite=Pro 20x 液态铂金 / premium=金卡）、
 * 重置积分明细、用量窗口水位条。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodexQuotaState } from '@/types';
import {
  normalizePlanType,
  resolvePlanTier,
  PREMIUM_CODEX_PLAN_TYPES,
  PRO_MAX_CODEX_PLAN_TYPES,
  buildResetDisplay,
  parseIsoToMs,
} from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { QuotaResetDetails } from '../../components/QuotaResetDetails';
import { collectQuotaRowInstants, pickUrgentRowId, resetCreditRowId } from '../../resetSchedule';
import type { QuotaBodyProps, QuotaClassMap } from '../../types';

const getPlanValueClass = (planType: string | null, classes: QuotaClassMap): string => {
  // elite/premium 顺序契约由 resolvePlanTier 承载（tests/quotaPlanTier.test.ts 守护）。
  const tier = resolvePlanTier(planType);
  if (tier === 'elite') return classes.elitePlanValue;
  if (tier === 'premium') return classes.premiumPlanValue;
  return classes.codexPlanValue;
};

export function CodexQuotaBody({ quota, classes, layout }: QuotaBodyProps<CodexQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const locale = i18n.resolvedLanguage;
  // Windows and reset credits compete for the same emphasis, but only during
  // the final hour before the reset or expiry.
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('codex', quota), now),
    [quota, now]
  );
  const windows = quota.windows ?? [];
  const planType = quota.planType ?? null;
  const rateLimitResetCreditsAvailableCount = quota.rateLimitResetCreditsAvailableCount ?? null;
  const rateLimitResetCredits = quota.rateLimitResetCredits ?? [];
  const rateLimitResetCreditsError = quota.rateLimitResetCreditsError ?? '';

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (PRO_MAX_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_promax');
    if (normalized === 'self_serve_business_prolite') {
      return t('codex_quota.plan_business_premium');
    }
    if (normalized === 'pro') return t('codex_quota.plan_pro');
    if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
      return t('codex_quota.plan_prolite');
    }
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const planValueClass = getPlanValueClass(planType, classes);

  const planChip = planLabel && (
    <span className={classes.codexPlanItem}>
      <span className={classes.codexPlanLabel}>{t('codex_quota.plan_label')}</span>
      <span className={planValueClass}>{planLabel}</span>
    </span>
  );

  const resetCreditDetails = (
    <>
      {(rateLimitResetCreditsAvailableCount !== null || rateLimitResetCredits.length > 0) && (
        <QuotaResetDetails
          count={rateLimitResetCreditsAvailableCount}
          expiresAt={rateLimitResetCredits
            .filter((credit) => credit.status === 'available')
            .map((credit) => parseIsoToMs(credit.expiresAt))}
          classes={classes}
          soon={rateLimitResetCredits.some(
            (credit, index) => resetCreditRowId(credit, index) === soonestRowId
          )}
        />
      )}
      {rateLimitResetCreditsAvailableCount !== 0 && rateLimitResetCreditsError && (
        <div className={classes.codexResetCreditsError}>
          {t('codex_quota.reset_credits_expiry_failed', {
            message: rateLimitResetCreditsError,
          })}
        </div>
      )}
    </>
  );

  const windowRows =
    windows.length === 0 ? (
      <div className={classes.quotaMessage}>{t('codex_quota.empty_windows')}</div>
    ) : (
      windows.map((window, index) => {
        const used = window.usedPercent;
        const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
        const remaining =
          clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
        const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
        const windowLabel = window.labelKey
          ? t(window.labelKey, window.labelParams as Record<string, string | number>)
          : window.label;
        const resetDisplay = buildResetDisplay(window.resetLabel, window.resetAtMs, now, locale);

        const soon = window.id === soonestRowId;

        return (
          <div
            key={window.id}
            className={classes.quotaRow}
            title={soon ? t('quota_management.soonest_row_hint') : undefined}
          >
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{windowLabel}</span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>{percentLabel}</span>
                {resetDisplay && (
                  <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                )}
              </div>
            </div>
            <QuotaMeter percent={remaining} classes={classes} index={index} />
          </div>
        );
      })
    );

  if (layout) {
    return layout({
      plan: planLabel && <span className={planValueClass}>{planLabel}</span>,
      details: resetCreditDetails,
      windows: windowRows,
    });
  }

  return (
    <>
      {planChip && <div className={classes.codexPlan}>{planChip}</div>}
      {resetCreditDetails}
      {windowRows}
    </>
  );
}
