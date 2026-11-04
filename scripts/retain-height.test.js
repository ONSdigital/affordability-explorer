import assert from "node:assert/strict";
import { test } from "node:test";
import { retainHeight } from "../src/lib/retain-height.js";

test("selected sections retain their height through loading, errors and shorter results", (t) => {
  let resize;
  let measuredHeight = 320;
  let observedNode;
  let disconnected = false;
  const originalObserver = globalThis.ResizeObserver;
  t.after(() => {
    if (originalObserver === undefined) {
      delete globalThis.ResizeObserver;
    } else {
      globalThis.ResizeObserver = originalObserver;
    }
  });
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resize = callback;
    }
    observe(node) {
      observedNode = node;
    }
    disconnect() {
      disconnected = true;
    }
  };
  const node = {
    style: { minHeight: "" },
    getBoundingClientRect: () => ({ height: measuredHeight }),
  };
  const action = retainHeight(node);
  assert.equal(observedNode, node);
  assert.equal(node.style.minHeight, "320px");

  for (const height of [40, 80, 280]) {
    measuredHeight = height;
    resize();
    assert.equal(node.style.minHeight, "320px");
  }

  measuredHeight = 360;
  resize();
  assert.equal(node.style.minHeight, "360px");

  action.update(false);
  assert.equal(node.style.minHeight, "");
  measuredHeight = 60;
  resize();
  assert.equal(node.style.minHeight, "");

  action.update(true);
  assert.equal(node.style.minHeight, "60px");
  measuredHeight = 320;
  resize();
  assert.equal(node.style.minHeight, "320px");

  action.destroy();
  assert.equal(disconnected, true);
  assert.equal(node.style.minHeight, "");

  measuredHeight = 40;
  const nextSelection = retainHeight(node);
  assert.equal(node.style.minHeight, "40px");
  nextSelection.destroy();
});
