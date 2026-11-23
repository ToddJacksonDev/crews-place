import * as THREE from "three";

export const TEDDY_DOCK = Object.freeze({ x: -125, z: -2260 });
export const HONEY_LAKE = Object.freeze({ x: -860, z: -2400, rx: 74, rz: 64 });
export function createTeddyRiver() {
  const river = new THREE.CatmullRomCurve3(
    [
      [-125, 32, -2260],
      [-165, 32, -2310],
      [-250, 31, -2340],
      [-325, 30, -2280],
      [-410, 29, -2270],
      [-470, 28, -2370],
      [-545, 27, -2440],
      [-635, 26, -2400],
      [-705, 25, -2330],
      [-790, 25, -2320],
      [-830, 25, -2340],
    ].map((p) => new THREE.Vector3(...p)),
    false,
    "centripetal",
  );
  river.arcLengthDivisions = 1500;
  const lip = river.getPoint(1);
  const fall = new THREE.CubicBezierCurve3(
    lip,
    lip.clone().add(new THREE.Vector3(-10, 0, -10)),
    new THREE.Vector3(-851, 2, -2373),
    new THREE.Vector3(-855, 0.2, -2388),
  );
  const lake = new THREE.CatmullRomCurve3([
    fall.getPoint(1),
    new THREE.Vector3(-861, 0.2, -2412),
    new THREE.Vector3(-883, 0.2, -2427),
    new THREE.Vector3(-905, 0.2, -2408),
  ]);
  const route = new THREE.CurvePath();
  route.add(river);
  route.add(fall);
  route.add(lake);
  const riverLength = river.getLength(),
    fallLength = fall.getLength(),
    length = route.getLength();
  return {
    river,
    fall,
    lake,
    riverLength,
    fallLength,
    length,
    sample(distance) {
      const u = THREE.MathUtils.clamp(distance / length, 0, 1);
      return { position: route.getPointAt(u), tangent: route.getTangentAt(u) };
    },
    stage(distance) {
      return distance < riverLength
        ? "river"
        : distance < riverLength + fallLength
          ? "waterfall"
          : distance < length
            ? "lake"
            : "arrived";
    },
  };
}

// A continuous bank-to-bank surface, with optional skirts down to the meadow.
export function riverRibbon(curve, width, color, offset = 0, skirts = false) {
  const positions = [],
    indices = [],
    count = 320;
  for (let i = 0; i <= count; i++) {
    const p = curve.getPointAt(i / count),
      t = curve.getTangentAt(i / count);
    const side = new THREE.Vector3(-t.z, 0, t.x)
      .normalize()
      .multiplyScalar(width / 2);
    for (const sign of [-1, 1])
      positions.push(p.x + side.x * sign, p.y + offset, p.z + side.z * sign);
    if (skirts)
      for (const sign of [-1, 1])
        positions.push(p.x + side.x * sign, 0, p.z + side.z * sign);
  }
  const stride = skirts ? 4 : 2;
  for (let i = 0; i < count; i++) {
    const a = i * stride,
      b = a + stride;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
    if (skirts)
      indices.push(
        a,
        a + 2,
        b,
        a + 2,
        b + 2,
        b,
        a + 1,
        b + 1,
        a + 3,
        a + 3,
        b + 1,
        b + 3,
      );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      roughness: skirts ? 1 : 0.32,
      side: THREE.DoubleSide,
    }),
  );
}
