import test from "node:test";
import assert from "node:assert/strict";
import { createTeddyRiver } from "../shared/world/teddy-river.js";
test("Teddy river is long, continuous, downhill and ends in the lake", () => {
  const r = createTeddyRiver();
  assert(r.riverLength > 850);
  let prev = r.sample(0).position;
  for (let d = 0.5; d < r.length; d += 0.5) {
    const { position: p, tangent: t } = r.sample(d);
    assert(p.distanceTo(prev) < 0.7, "discontinuous route");
    assert(p.y <= prev.y + 0.015, "upstream climb");
    assert(t.toArray().every(Number.isFinite));
    prev = p;
  }
  assert(r.sample(r.length).position.y < 1);
  assert.equal(r.stage(r.riverLength + 5), "waterfall");
  assert.equal(r.stage(r.length), "arrived");
});
