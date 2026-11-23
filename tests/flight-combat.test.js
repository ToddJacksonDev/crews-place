import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  AIRFIELD_SITE,
  FlyablePlane,
} from "../shared/world/airfield.js";
import {
  ENEMY_PLANE_COUNT,
  FIRST_MOUNTAIN_PASS_Z,
  FlightCombat,
  PLAYER_HEALTH,
  WAVE_COUNT,
  passedFirstMountain,
  reachedFlightEnding,
} from "../shared/world/flight-combat.js";
import { NORTH_AIRFIELD_SITE } from "../shared/world/world-layout.js";

function fakePlane(x, y, z, heading = Math.PI) {
  const model = new THREE.Group();
  model.position.set(x, y, z);
  model.rotation.y = heading;
  model.userData.gunMounts = [
    new THREE.Vector3(-2.48, 0.96, 1.7),
    new THREE.Vector3(2.48, 0.96, 1.7),
  ];
  return { model, airborne: true, heading };
}

function playerStub() {
  return {
    model: { visible: true },
    position: new THREE.Vector3(),
    heading: 0,
    inVehicle: false,
    teleport(x, z) {
      this.position.set(x, 0, z);
    },
    sync() {},
  };
}

test("enemies stay away until Skybird passes the first mountain", () => {
  assert.equal(passedFirstMountain({ z: FIRST_MOUNTAIN_PASS_Z }), false);
  assert.equal(passedFirstMountain({ z: FIRST_MOUNTAIN_PASS_Z - 1 }), true);
  const combat = new FlightCombat(new THREE.Group());
  const plane = fakePlane(-24, 42, -400);
  const before = combat.update(1 / 30, plane);
  assert.equal(before.warning, false);
  assert.equal(
    combat.enemies.filter((enemy) => enemy.alive).length,
    0,
  );
  plane.model.position.z = FIRST_MOUNTAIN_PASS_Z - 8;
  const spawned = combat.update(1 / 30, plane);
  assert.equal(spawned.warning, true);
  assert.equal(
    combat.enemies.filter((enemy) => enemy.alive).length,
    ENEMY_PLANE_COUNT,
  );
  const again = combat.update(1 / 30, plane);
  assert.equal(again.warning, false);
  assert.equal(combat.enemies.filter((enemy) => enemy.alive).length, 2);
  const forward = new THREE.Vector3(0, 0, -1);
  for (const enemy of combat.enemies) {
    const ahead = enemy.position.clone().sub(plane.model.position).dot(forward);
    assert.ok(ahead > 40, "enemy spawned behind Skybird");
  }
});

test("Skybird has a machine gun on each wing and they fire while enemies live", () => {
  const skybird = new FlyablePlane(new THREE.Group());
  assert.equal(skybird.model.userData.gunMounts.length, 2);
  assert.ok(skybird.model.userData.gunMounts[0].x < 0);
  assert.ok(skybird.model.userData.gunMounts[1].x > 0);
  const combat = new FlightCombat(new THREE.Group());
  const plane = fakePlane(-24, 42, FIRST_MOUNTAIN_PASS_Z - 8);
  combat.update(1 / 30, plane);
  const firing = combat.update(0.2, plane);
  assert.equal(firing.warning, false);
  assert.ok(combat.bullets.some((bullet) => bullet.team === "player"));
});

test("a direct hit can shoot Skybird down and the flight restarts on the home strip", () => {
  const parent = new THREE.Group();
  const combat = new FlightCombat(parent);
  const plane = new FlyablePlane(parent);
  plane.enter(playerStub());
  plane.model.position.set(-20, 42, -700);
  plane.airborne = true;
  plane.heading = Math.PI;
  plane.model.rotation.set(0, Math.PI, 0);
  combat.update(1 / 60, plane);
  assert.equal(combat.state, "fighting");
  combat.playerHealth = 1;
  const mesh = new THREE.Mesh();
  parent.add(mesh);
  combat.bullets.push({
    team: "enemy",
    mesh,
    position: plane.model.position.clone(),
    previous: plane.model.position.clone(),
    direction: new THREE.Vector3(),
    speed: 0,
    life: 1,
  });
  const result = combat.update(1 / 60, plane);
  assert.equal(result.shotDown, true);
  assert.equal(combat.state, "idle");
  assert.equal(
    combat.enemies.every((enemy) => !enemy.alive),
    true,
  );
  plane.reset();
  assert.equal(plane.model.position.x, AIRFIELD_SITE.runwayStart.x);
  assert.equal(plane.model.position.z, AIRFIELD_SITE.runwayStart.z);
  assert.equal(plane.model.position.y, 0);
  assert.equal(plane.airborne, false);
  assert.equal(plane.occupied, true);
});

test("reaching North Meadow ends the chase with one escape", () => {
  const combat = new FlightCombat(new THREE.Group());
  const plane = fakePlane(52, 28, FIRST_MOUNTAIN_PASS_Z - 8);
  assert.equal(combat.update(1 / 60, plane).warning, true);
  plane.model.position.set(
    NORTH_AIRFIELD_SITE.x,
    24,
    NORTH_AIRFIELD_SITE.runwayStart.z,
  );
  assert.equal(reachedFlightEnding(plane.model.position), true);
  const escaped = combat.update(1 / 60, plane);
  assert.equal(escaped.escaped, true);
  assert.equal(combat.state, "escaped");
  assert.equal(combat.enemies.every((enemy) => !enemy.group.visible), true);
  assert.equal(combat.update(1 / 60, plane).escaped, false);
  plane.model.position.z = -200;
  combat.update(1 / 60, plane);
  assert.equal(combat.state, "idle");
  plane.model.position.z = FIRST_MOUNTAIN_PASS_Z - 8;
  assert.equal(combat.update(1 / 60, plane).warning, true);
});

test("enemy planes shoot, and a steady flight still reaches the north field", () => {
  const combat = new FlightCombat(new THREE.Group());
  const plane = fakePlane(-22, 48, -620);
  plane.speed = 28;
  const step = 1 / 30;
  let enemyShots = 0;
  let escaped = false;
  for (let t = 0; t < 80 && !escaped; t += step) {
    const progress = THREE.MathUtils.clamp(
      (-620 - plane.model.position.z) / 1560,
      0,
      1,
    );
    plane.model.position.x = THREE.MathUtils.lerp(-22, 52, progress);
    plane.model.position.z -= 28 * step;
    const result = combat.update(step, plane);
    if (combat.bullets.some((bullet) => bullet.team === "enemy")) enemyShots += 1;
    assert.equal(result.shotDown, false, "health " + combat.playerHealth);
    escaped = result.escaped;
  }
  assert.equal(escaped, true);
  assert.ok(enemyShots > 0, "enemies never fired");
  assert.ok(combat.playerHealth > PLAYER_HEALTH / 2);
});

test("three waves of two planes come from the front and then stop", () => {
  const combat = new FlightCombat(new THREE.Group());
  const plane = fakePlane(-22, 48, -700);
  plane.speed = 0;
  const step = 1 / 30;
  const fronts = [];
  let lastWave = 0;
  let campedBehind = false;
  const forward = new THREE.Vector3(0, 0, -1);
  for (let t = 0; t < 45; t += step) {
    combat.update(step, plane);
    if (combat.wave !== lastWave) {
      lastWave = combat.wave;
      const ahead = combat.enemies
        .filter((enemy) => enemy.alive)
        .map((enemy) =>
          enemy.position.clone().sub(plane.model.position).dot(forward),
        );
      fronts.push(Math.min(...ahead));
    }
    for (const enemy of combat.enemies) {
      if (!enemy.alive) continue;
      const ahead = enemy.position.clone().sub(plane.model.position).dot(forward);
      if (ahead < -30) campedBehind = true;
    }
    assert.ok(combat.enemies.filter((enemy) => enemy.alive).length <= 2);
  }
  assert.equal(combat.wave, WAVE_COUNT);
  assert.equal(fronts.length, WAVE_COUNT);
  assert.ok(fronts.every((ahead) => ahead > 40));
  assert.equal(campedBehind, false);
  assert.equal(
    combat.enemies.filter((enemy) => enemy.alive).length,
    0,
  );
  combat.update(1, plane);
  assert.equal(combat.wave, WAVE_COUNT);
});

test("flying toward the incoming planes can shoot one down", () => {
  const combat = new FlightCombat(new THREE.Group());
  const plane = fakePlane(-22, 48, -700);
  plane.speed = 28;
  const step = 1 / 30;
  let destroyed = 0;
  for (let t = 0; t < 12; t += step) {
    plane.model.position.z -= 28 * step;
    const before = combat.enemies.map((enemy) => enemy.health);
    combat.update(step, plane);
    combat.enemies.forEach((enemy, index) => {
      if (before[index] > 0 && enemy.health <= 0) destroyed += 1;
    });
  }
  assert.ok(destroyed >= 1, "forward guns never hit an incoming plane");
});

test("standing still draws enemy fire without a quick shoot-down", () => {
  const combat = new FlightCombat(new THREE.Group());
  const plane = fakePlane(-22, 48, -700);
  plane.speed = 0;
  const step = 1 / 30;
  for (let t = 0; t < 25; t += step) {
    const result = combat.update(step, plane);
    assert.equal(result.shotDown, false);
  }
  assert.ok(combat.playerHealth < PLAYER_HEALTH);
  assert.ok(combat.playerHealth > 4);
});
