export function retainHeight(node, enabled = true) {
  let lastHeight = 0;
  const originalMinHeight = node.style.minHeight;

  function measure() {
    if (!enabled) return;
    const nextHeight = node.getBoundingClientRect().height;
    node.style.minHeight = `${nextHeight}px`;
    lastHeight = nextHeight;
  }

  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(node);

  return {
    update(nextEnabled) {
      enabled = nextEnabled;
      if (!enabled) {
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
