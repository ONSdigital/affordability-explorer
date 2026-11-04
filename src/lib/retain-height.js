export function retainHeight(node, enabled = true) {
  let height = 0;
  const originalMinHeight = node.style.minHeight;

  function measure() {
    if (!enabled) return;
    const nextHeight = node.getBoundingClientRect().height;
    if (nextHeight > height) {
      height = nextHeight;
      node.style.minHeight = `${height}px`;
    }
  }

  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(node);

  return {
    update(nextEnabled) {
      enabled = nextEnabled;
      if (!enabled) {
        height = 0;
        node.style.minHeight = originalMinHeight;
      } else {
        measure();
      }
    },
    destroy() {
      observer.disconnect();
      node.style.minHeight = originalMinHeight;
    },
  };
}
