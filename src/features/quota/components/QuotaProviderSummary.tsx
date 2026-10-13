/**
 * 提供商七天额度总览。一个账号一段，段内只画这个账号的七天余量。
 */

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ResolvedTheme } from '@/types';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import type { ProviderQuotaSummary, ProviderSummaryWindow } from '../providerSummary';
import styles from './QuotaProviderSummary.module.scss';

export type QuotaProviderSummaryProps = {
  summaries: ProviderQuotaSummary[];
  resolvedTheme: ResolvedTheme;
  nowMs: number;
};

function resolveWindowLabel(window: ProviderSummaryWindow, t: TFunction): string | null {
  if (window.labelKey) {
    const translated = t(window.labelKey, window.labelParams ?? {});
    if (translated && translated !== window.labelKey) return translated;
  }
  const fallback = window.label?.trim();
  return fallback ? fallback : null;
}

function fillClass(ratio: number): string {
  if (ratio >= QUOTA_PROGRESS_HIGH_THRESHOLD) return styles.fillHigh;
  if (ratio >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return styles.fillMedium;
  return styles.fillLow;
}

export function QuotaProviderSummary({
  summaries,
  resolvedTheme,
  nowMs,
}: QuotaProviderSummaryProps) {
  const { t, i18n } = useTranslation();
  if (summaries.length === 0) return null;

  return (
    <section className={styles.grid} aria-label={t('quota_management.summary_label')}>
      {summaries.map((summary) => {
        const providerLabel = getTypeLabel(t, summary.type);
        const iconSrc = getAuthFileIcon(summary.type, resolvedTheme);
        const windowLabel = summary.window ? resolveWindowLabel(summary.window, t) : null;
        const statusLabel =
          summary.window === null
            ? summary.availability === 'loading'
              ? t('quota_management.summary_loading')
              : summary.availability === 'idle'
                ? t('quota_management.summary_unloaded')
                : null
            : windowLabel;
        const remaining = summary.window?.remainingPercent ?? null;
        const capacity = summary.window?.capacityPercent ?? summary.credentialCount * 100;
        const remainingText = remaining === null ? '--' : `${Math.round(remaining)}%`;
        const capacityText = t('quota_management.summary_of', { capacity });
        const resetAtMs = summary.window?.resetAtMs ?? null;
        const relative =
          resetAtMs === null
            ? null
            : formatRelativeInstant(resetAtMs, nowMs, i18n.resolvedLanguage);
        const absolute = resetAtMs === null ? null : formatInstantShort(resetAtMs);

        return (
          <article key={summary.type} className={styles.card}>
            <div className={styles.head}>
              <div className={styles.identity}>
                <span
                  className={styles.iconWrap}
                  style={
                    isThemeSurfaceIconProvider(summary.type)
                      ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                      : undefined
                  }
                >
                  {iconSrc ? (
                    <img src={iconSrc} alt="" className={styles.icon} />
                  ) : (
                    <span className={styles.iconFallback}>
                      {providerLabel.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className={styles.name} title={providerLabel}>
                  {providerLabel}
                </span>
              </div>
              <span className={styles.count}>
                {t('quota_management.summary_credentials', { count: summary.credentialCount })}
              </span>
            </div>

            {statusLabel && <p className={styles.window}>{statusLabel}</p>}

            <p className={styles.ratio}>
              <span className={styles.remaining}>{remainingText}</span>
              <span className={styles.capacity}>{capacityText}</span>
            </p>

            <div className={styles.segments} role="group" aria-label={windowLabel ?? providerLabel}>
              {summary.accounts.map((account) => {
                const percent =
                  account.remaining === null ? null : Math.min(100, Math.max(0, account.remaining));
                const percentText = percent === null ? '--' : `${Math.round(percent)}%`;
                return (
                  <div
                    key={account.key}
                    className={styles.segment}
                    role={percent === null ? undefined : 'meter'}
                    aria-label={percent === null ? undefined : account.label}
                    aria-valuemin={percent === null ? undefined : 0}
                    aria-valuemax={percent === null ? undefined : 100}
                    aria-valuenow={percent === null ? undefined : Math.round(percent)}
                    aria-valuetext={percent === null ? undefined : percentText}
                    title={`${account.label} ${percentText}`}
                  >
                    {percent !== null && (
                      <div
                        className={`${styles.fill} ${fillClass(percent)}`}
                        style={{ width: `${Math.round(percent * 100) / 100}%` }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {relative && absolute && (
              <p className={styles.reset}>
                <span>{relative}</span>
                <span className={styles.resetDot} aria-hidden="true">
                  ·
                </span>
                <span>{absolute}</span>
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
