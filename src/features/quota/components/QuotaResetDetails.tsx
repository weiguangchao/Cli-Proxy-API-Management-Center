import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import type { QuotaClassMap } from '../types';

interface QuotaResetDetailsProps {
  count: number | null;
  expiresAt: readonly (number | null)[];
  classes: QuotaClassMap;
  soon?: boolean;
}

/** Shared reset balance and the nearest upcoming expiry, in the viewer's local timezone. */
export function QuotaResetDetails({ count, expiresAt, classes, soon }: QuotaResetDetailsProps) {
  const { t } = useTranslation();
  const now = useNow();
  const nextExpiry = expiresAt.reduce<number | null>(
    (next, expiry) =>
      expiry !== null && Number.isFinite(expiry) && expiry > now && (next === null || expiry < next)
        ? expiry
        : next,
    null
  );
  const expiryDate = count !== 0 && nextExpiry !== null ? new Date(nextExpiry) : null;
  const expiryLabel = expiryDate
    ? `${expiryDate.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })} (${resolveTimeZoneLabel(expiryDate)})`
    : null;

  return (
    <>
      <div className={classes.codexPlan}>
        <span className={classes.codexPlanItem}>
          <span className={classes.codexPlanLabel}>{t('quota_management.resets_remaining')}</span>
          <span className={classes.codexPlanValue}>{count ?? '--'}</span>
        </span>
      </div>
      {expiryDate && (
        <div className={classes.codexResetCredits}>
          <div
            className={
              soon
                ? `${classes.codexResetCreditRow} ${classes.codexResetCreditRowSoon}`
                : classes.codexResetCreditRow
            }
          >
            <span className={classes.codexResetCreditLabel}>
              {t('quota_management.reset_expiry')}{' '}
              <time dateTime={expiryDate.toISOString()}>{expiryLabel}</time>
            </span>
          </div>
        </div>
      )}
    </>
  );
}
