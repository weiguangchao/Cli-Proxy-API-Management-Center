import { useLayoutEffect, useRef, useState } from 'react';
import { observeQuotaSkeletonColumns } from '../skeletonColumns';

export function useQuotaSkeletonColumns(loading: boolean) {
  const windowsRef = useRef<HTMLDivElement>(null);
  const [skeletonWindowCount, setSkeletonWindowCount] = useState(1);

  useLayoutEffect(() => {
    const element = windowsRef.current;
    if (!loading || !element) return;

    return observeQuotaSkeletonColumns(element, setSkeletonWindowCount);
  }, [loading]);

  return { windowsRef, skeletonWindowCount };
}
