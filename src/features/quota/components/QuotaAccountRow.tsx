/**
 * 额度列表行：脱敏邮箱 + 套餐 | 横排的用量窗口 | 细节 + 动作。
 *
 * - idle：账户列之后整行是一个点击加载按钮（上游直连有速率考虑，不自动拉取）；
 * - loading：幽灵窗口列骨架（aria-busy，文字等价视觉隐藏）；
 * - error：失败色条 + 刷新即重试；
 * - success：provider Body 以 layout 回调把三个分区交给本行排版。
 *
 * 动作区在 Body 子树之外：状态在 success / loading 间切换时按钮不重挂载，焦点得以保留。
 * 额度耗尽（exhaustion.ts）的行降亮度，并在套餐旁给出「n 小时后恢复」。
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaAccountLabel } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { bindQuotaClasses, type QuotaBodySections } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { formatRecoveryDuration, resolveQuotaExhaustion } from '../exhaustion';
import { useQuotaSkeletonColumns } from '../hooks/useQuotaSkeletonColumns';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { ClaudeResetGrantDetails } from '../providers/claude/ClaudeResetGrantDetails';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaAccountRow.module.scss';

/** 额度页列表外衣：QuotaBody 模块绑定成类型化契约（缺键在模块初始化即抛）。 */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export type QuotaAccountRowProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  resolvedTheme: ResolvedTheme;
  /** 分组标题已标明提供商时省略行内图标（插件行的真实提供商各不相同，始终显示）。 */
  showProviderIcon: boolean;
  canRefresh: boolean;
  resetting: boolean;
  /** 首屏级联入场延迟；null = 不入场（切 tab / 翻页 / 刷新新挂载的行）。 */
  entranceDelayMs?: number | null;
  onRefresh: () => void;
  onReset: () => void;
};

export function QuotaAccountRow(props: QuotaAccountRowProps) {
  const {
    entry,
    quota,
    resolvedTheme,
    showProviderIcon,
    canRefresh,
    resetting,
    entranceDelayMs,
    onRefresh,
    onReset,
  } = props;
  const { t } = useTranslation();
  const now = useNow();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;
  const accountLabel = getQuotaAccountLabel(file);

  // 挂载时捕获一次延迟：后续 props 变 null 不影响本行（React 19 禁渲染期读 ref）
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountEntranceDelayMs === null
      ? undefined
      : ({ '--row-delay': `${mountEntranceDelayMs}ms` } as CSSProperties);

  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const { windowsRef, skeletonWindowCount } = useQuotaSkeletonColumns(loading);
  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const exhaustion = useMemo(
    () => resolveQuotaExhaustion(entry.type, quota, now),
    [entry.type, quota, now]
  );
  const recoveryLabel = exhaustion
    ? exhaustion.recoversAtMs === null
      ? t('quota_management.exhausted')
      : t('quota_management.recovers_in', {
          duration: formatRecoveryDuration(t, exhaustion.recoversAtMs - now),
        })
    : null;

  const providerType =
    entry.type === 'plugin'
      ? String(
          file.quotaProvider ?? file['quota_provider'] ?? file.provider ?? file.type ?? 'plugin'
        )
      : entry.type;
  const iconSrc = getAuthFileIcon(providerType, resolvedTheme);
  const typeLabel = getTypeLabel(t, providerType);
  const errorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));
  // An unresolved claim retains its idempotent retry action, even after the balance reaches zero.
  const showClaudeReset =
    entry.type === 'claude' &&
    ((claudeReset.count ?? 0) > 0 || claudeReset.buttonLabel === 'retry');

  const claudeDetails = entry.type === 'claude' && status === 'success' && (
    <>
      <ClaudeResetGrantDetails
        count={claudeReset.count}
        grants={claudeReset.grants}
        classes={quotaClasses}
      />
      {claudeReset.message && (
        <div role="status" className={quotaClasses.codexResetCreditsError}>
          {t(`claude_reset.${claudeReset.message}`)}
        </div>
      )}
    </>
  );

  const renderColumns = ({ plan, details, windows }: QuotaBodySections) => (
    <>
      <div className={styles.identity}>
        {showProviderIcon && (
          <span
            className={styles.iconWrap}
            title={typeLabel}
            style={
              isThemeSurfaceIconProvider(providerType)
                ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                : undefined
            }
          >
            {iconSrc ? (
              <img src={iconSrc} alt="" className={styles.icon} />
            ) : (
              <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
            )}
          </span>
        )}
        <div className={styles.identityText}>
          <span className={styles.name} title={accountLabel}>
            {accountLabel}
          </span>
          {(plan || recoveryLabel) && (
            <span className={styles.subline}>
              {plan && <span className={`${styles.plan} ${bodyStyles.listPlan}`}>{plan}</span>}
              {recoveryLabel && <span className={styles.recovery}>{recoveryLabel}</span>}
            </span>
          )}
        </div>
      </div>
      <div ref={windowsRef} className={`${styles.windows} ${bodyStyles.listWindows}`}>
        {windows}
      </div>
      <div className={`${styles.details} ${bodyStyles.listDetails}`}>
        {claudeDetails}
        {details}
      </div>
    </>
  );

  const placeholderWindows =
    status === 'idle' ? (
      <button type="button" className={styles.idleBody} onClick={onRefresh} disabled={!canRefresh}>
        <IconRefreshCw size={14} aria-hidden="true" className={styles.idleGlyph} />
        <span>{t(`${adapter.i18nPrefix}.idle`)}</span>
      </button>
    ) : loading ? (
      <div className={styles.skeleton} aria-busy="true">
        <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
        {Array.from({ length: skeletonWindowCount }, (_, column) => (
          <div key={column} className={styles.skeletonWindow} aria-hidden="true">
            <span className={styles.skeletonLabel} />
            <span className={styles.skeletonTrack} />
          </div>
        ))}
      </div>
    ) : status === 'error' ? (
      <div className={styles.errorStrip} role="alert">
        {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
      </div>
    ) : (
      <div className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</div>
    );

  return (
    <article
      className={`${styles.row} ${mountEntranceDelayMs === null ? '' : styles.rowEnter}`}
      style={entranceStyle}
      data-exhausted={exhaustion ? '' : undefined}
      data-idle={status === 'idle' ? '' : undefined}
    >
      {status === 'success' && quota ? (
        <adapter.Body quota={quota} classes={quotaClasses} layout={renderColumns} />
      ) : (
        renderColumns({ plan: null, details: null, windows: placeholderWindows })
      )}

      {status !== 'idle' && (
        <div className={styles.actions}>
          {showClaudeReset && (
            <button
              type="button"
              className={styles.action}
              disabled={claudeReset.blocked}
              onClick={claudeReset.confirm}
              title={t(`claude_reset.${claudeReset.buttonLabel}`)}
            >
              <IconRefreshCw size={13} className={claudeReset.busy ? styles.spinning : undefined} />
              {t(`claude_reset.${claudeReset.buttonLabel}`)}
            </button>
          )}
          {showReset && (
            <button
              type="button"
              className={styles.action}
              onClick={onReset}
              disabled={!canRefresh || loading || resetting}
              title={t('codex_quota.reset_button')}
            >
              <IconRefreshCw size={13} className={resetting ? styles.spinning : undefined} />
              {t('codex_quota.reset_button')}
            </button>
          )}
          <button
            type="button"
            className={styles.action}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        </div>
      )}
    </article>
  );
}
