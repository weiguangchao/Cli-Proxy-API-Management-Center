import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/utils/quota';
import { QuotaResetDetails } from '../../components/QuotaResetDetails';
import type { QuotaClassMap } from '../../types';

interface ClaudeResetGrantDetailsProps {
  count: number | null;
  grants: readonly AnthropicResetGrant[];
  classes: QuotaClassMap;
}

export function ClaudeResetGrantDetails({ count, grants, classes }: ClaudeResetGrantDetailsProps) {
  return (
    <QuotaResetDetails
      count={count}
      expiresAt={grants
        .filter((grant) => grant.resetsLeft > 0)
        .map((grant) => parseIsoToMs(grant.endsAt))}
      classes={classes}
    />
  );
}
