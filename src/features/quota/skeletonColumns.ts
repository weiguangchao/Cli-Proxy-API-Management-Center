/** Keep loading placeholders on the same resolved grid tracks as quota windows. */
export function observeQuotaSkeletonColumns(
  element: HTMLElement,
  onChange: (columns: number) => void
): () => void {
  const updateColumns = () => {
    const tracks = getComputedStyle(element).gridTemplateColumns.trim();
    onChange(tracks ? tracks.split(/\s+/).length : 1);
  };

  updateColumns();
  const observer = new ResizeObserver(updateColumns);
  observer.observe(element);

  return () => observer.disconnect();
}
