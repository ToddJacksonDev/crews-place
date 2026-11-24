import * as THREE from "three";
import { box } from "./models.js";
import { MOUNTAINS, terrainBlocks, waterAt } from "./northern-terrain.js";
import {
  NORTH_AIRFIELD_SITE,
  PLANE_BOUNDS,
  PLANE_MAX_ALTITUDE,
  PLANE_WORLD_LIMIT,
} from "./airfield.js";

// Enemies wait until Skybird is north of the first peak, then come from the
// front in three passes of two. Their shots are intentionally wide.
export const ENEMY_PLANE_COUNT = 2;
export const WAVE_COUNT = 3;
export const PLAYER_HEALTH = 16;
export const ENEMY_HEALTH = 8;
const WAVE_GAP = 2.8;
export const FIRST_MOUNTAIN_PASS_Z = MOUNTAINS[0].z - MOUNTAINS[0].radius;
const PLAYER_HIT_RADIUS = 1.9;
const ENEMY_HIT_RADIUS = 3.4;
const GUN_CONVERGENCE = 28;
const UP = new THREE.Vector3(0, 1, 0);

export function passedFirstMountain(position) {
  return position.z < FIRST_MOUNTAIN_PASS_Z;
}

export function reachedFlightEnding(position) {
  const site = NORTH_AIRFIELD_SITE;
  return (
    Math.abs(position.x - site.x) <= 40 &&
    position.z <= site.runwayStart.z + 16 &&
    position.z >= site.runwayEnd.z - 80
  );
}

function blocked(position) {
  return (
    terrainBlocks(position.x, position.y, position.z) ||
    (position.y < 2.5 && waterAt(position.x, position.z))
  );
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function localPoint(object, local) {
  return local
    .clone()
    .multiply(object.scale)
    .applyQuaternion(object.quaternion)
    .add(object.position);
}

function addPropeller(parent, x, y, z) {
  const propeller = new THREE.Group();
  propeller.position.set(x, y, z);
  parent.add(propeller);
  box(propeller, 0, 0, 0, 0.12, 1.25, 0.06, 0x4a3038);
  box(propeller, 0, 0, 0.02, 1.25, 0.12, 0.06, 0x4a3038);
  return propeller;
}

function makeEnemyPlane() {
  const plane = new THREE.Group();
  plane.name = "enemy-plane";
  const body = 0xd4536a;
  const wing = 0xf0b3c0;
  box(plane, 0, 0.7, 0, 0.9, 0.85, 4.4, body);
  box(plane, 0, 1.02, -0.2, 0.7, 0.48, 1.3, 0xf7d5dc);
  box(plane, 0, 0.72, 0.15, 5.2, 0.14, 0.95, wing);
  box(plane, 0, 0.9, -1.7, 2.1, 0.12, 0.62, wing);
  box(plane, 0, 1.35, -1.85, 0.12, 1.05, 0.55, body);
  const propellers = [];
  for (const x of [-1.35, 1.35]) {
    box(plane, x, 0.66, 0.4, 0.5, 0.55, 1.15, 0xc4475c);
    propellers.push(addPropeller(plane, x, 0.68, 1.05));
  }
  const gunMounts = [];
  for (const x of [-2.05, 2.05]) {
    box(plane, x, 0.82, 0.82, 0.12, 0.12, 0.7, 0x6a2434);
    gunMounts.push(new THREE.Vector3(x, 0.82, 1.22));
  }
  plane.userData.propellers = propellers;
  plane.userData.gunMounts = gunMounts;
  plane.scale.setScalar(1.25);
  return plane;
}

export class FlightCombat {
  constructor(parent) {
    this.parent = parent;
    this.time = 0;
    this.state = "idle";
    this.wave = 0;
    this.waveGap = 0;
    this.waveForward = new THREE.Vector3(0, 0, -1);
    this.waveRight = new THREE.Vector3(1, 0, 0);
    this.waveSpeed = 16;
    this.playerHealth = PLAYER_HEALTH;
    this.gunTimer = 0;
    this.bullets = [];
    this.bulletGeometry = new THREE.BoxGeometry(0.16, 0.16, 1.45);
    this.playerBulletMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe38a,
    });
    this.enemyBulletMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8d7a,
    });
    this.hitGlow = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff8a8a,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      }),
    );
    this.hitGlow.visible = false;
    parent.add(this.hitGlow);
    this.bursts = [];
    this.burstGeometry = new THREE.SphereGeometry(1.65, 10, 8);
    this.enemies = [0, 1].map((index) => {
      const group = makeEnemyPlane();
      group.visible = false;
      parent.add(group);
      return {
        index,
        side: index === 0 ? -1 : 1,
        group,
        position: new THREE.Vector3(),
        heading: Math.PI,
        health: ENEMY_HEALTH,
        cooldown: 2,
        passHeading: 0,
        age: 0,
        alive: false,
      };
    });
  }

  endFlight() {
    this.state = "idle";
    this.wave = 0;
    this.waveGap = 0;
    this.playerHealth = PLAYER_HEALTH;
    this.gunTimer = 0;
    this.hideEnemies();
    this.clearBullets();
    this.clearBursts();
    this.hitGlow.visible = false;
  }

  update(dt, plane) {
    this.time += dt;
    this.updateBursts(dt);
    const result = { warning: false, escaped: false, shotDown: false };
    const position = plane.model.position;
    if (this.state === "escaped") {
      if (position.z > FIRST_MOUNTAIN_PASS_Z + 80) this.state = "idle";
      this.fadeHit(dt);
      return result;
    }
    if (this.state === "idle") {
      if (plane.airborne && passedFirstMountain(position)) {
        this.beginEncounter(plane);
        result.warning = true;
      } else {
        this.fadeHit(dt);
        return result;
      }
    }
    this.steerEnemies(dt, plane);
    this.firePlayerGuns(dt, plane);
    this.fireEnemyGuns(dt, plane);
    if (this.resolveBullets(dt, plane)) {
      result.shotDown = true;
      this.endFlight();
      return result;
    }
    this.advanceWave(dt, plane);
    if (reachedFlightEnding(position)) {
      result.escaped = true;
      this.state = "escaped";
      this.hideEnemies();
      this.clearBullets();
    }
    this.fadeHit(dt);
    return result;
  }

  beginEncounter(plane) {
    this.state = "fighting";
    this.playerHealth = PLAYER_HEALTH;
    this.gunTimer = 0;
    this.wave = 0;
    this.waveGap = 0;
    this.spawnWave(plane);
  }

  spawnWave(plane) {
    this.wave += 1;
    this.waveGap = 0;
    const forward = new THREE.Vector3(
      Math.sin(plane.heading),
      0,
      Math.cos(plane.heading),
    );
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    this.waveForward.copy(forward);
    this.waveRight.copy(right);
    // A fast Skybird still gets a few seconds to fire before the pair arrives.
    this.waveSpeed = Math.max(10, 26 - Math.max(0, plane.speed ?? 0));
    const passHeading = Math.atan2(-forward.x, -forward.z);
    for (const enemy of this.enemies) {
      const spot = this.spawnAhead(
        plane.model.position,
        forward,
        right,
        enemy,
        enemy.index === 0 ? 156 : 190,
      );
      enemy.position.copy(spot);
      enemy.heading = passHeading;
      enemy.passHeading = passHeading;
      enemy.health = ENEMY_HEALTH;
      enemy.cooldown = 0.55 + enemy.index * 0.3;
      enemy.age = 0;
      enemy.alive = true;
      enemy.group.visible = true;
      enemy.group.position.copy(enemy.position);
      enemy.group.rotation.set(0, enemy.heading, 0);
    }
  }

  advanceWave(dt, plane) {
    if (this.state !== "fighting") return;
    if (reachedFlightEnding(plane.model.position)) return;
    if (this.enemies.some((enemy) => enemy.alive)) {
      this.waveGap = 0;
      return;
    }
    if (this.wave >= WAVE_COUNT) return;
    this.waveGap += dt;
    if (this.waveGap >= WAVE_GAP) this.spawnWave(plane);
  }

  // Far enough to come out of the northern haze, but only along open sky.
  // A peak in front pulls the pair sideways into the pass instead of hiding
  // them behind the mountain.
  spawnAhead(origin, forward, right, enemy, wanted) {
    const laterals = [enemy.side * 11, enemy.side * 22, enemy.side * 36];
    for (let distance = wanted; distance >= 84; distance -= 14) {
      for (const lateral of laterals) {
        const candidate = origin
          .clone()
          .addScaledVector(forward, distance)
          .addScaledVector(right, lateral);
        candidate.y = THREE.MathUtils.clamp(origin.y + enemy.side * 3, 22, 64);
        const clear = this.openSpawn(candidate, enemy.side);
        if (Math.abs(clear.x) > 78) continue;
        const ahead = clear.clone().sub(origin).dot(forward);
        if (ahead < 70) continue;
        const gate = origin
          .clone()
          .addScaledVector(forward, 36)
          .addScaledVector(right, Math.sign(lateral) * 12);
        gate.y = clear.y;
        if (blocked(clear) || !this.laneClear(origin, clear)) continue;
        if (!this.laneClear(clear, gate)) continue;
        return clear;
      }
    }
    const fallback = origin
      .clone()
      .addScaledVector(forward, 84)
      .addScaledVector(right, enemy.side * 11);
    fallback.y = THREE.MathUtils.clamp(origin.y, 22, 64);
    return this.openSpawn(fallback, enemy.side);
  }

  laneClear(from, to) {
    for (let step = 1; step <= 8; step++) {
      if (blocked(from.clone().lerp(to, step / 8))) return false;
    }
    return true;
  }

  openSpawn(position, side) {
    const point = position.clone();
    point.x = THREE.MathUtils.clamp(point.x, -80, 80);
    point.z = THREE.MathUtils.clamp(
      point.z,
      PLANE_BOUNDS.minZ + 6,
      PLANE_BOUNDS.maxZ - 6,
    );
    for (let i = 0; i < 10 && blocked(point); i++) {
      point.x += side * 5;
      point.y = Math.min(62, point.y + 3);
    }
    return point;
  }

  steerEnemies(dt, plane) {
    const playerPos = plane.model.position;
    const forward = this.waveForward;
    const right = this.waveRight;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.age += dt;
      const ahead = enemy.position.clone().sub(playerPos).dot(forward);
      // Once a plane has flown past the nose, it leaves. It does not turn
      // around and sit behind Skybird.
      if (ahead < -18 || enemy.age > 32) {
        this.retireEnemy(enemy);
        continue;
      }
      const lane = playerPos
        .clone()
        .addScaledVector(forward, -28)
        .addScaledVector(right, enemy.side * 12);
      lane.y = THREE.MathUtils.clamp(
        playerPos.y + enemy.side * 2,
        16,
        PLANE_MAX_ALTITUDE - 8,
      );
      const desired = Math.atan2(
        lane.x - enemy.position.x,
        lane.z - enemy.position.z,
      );
      const nextHeading =
        enemy.heading +
        THREE.MathUtils.clamp(
          angleDelta(enemy.heading, desired),
          -1.2 * dt,
          1.2 * dt,
        );
      if (Math.abs(angleDelta(enemy.passHeading, nextHeading)) < 0.9)
        enemy.heading = nextHeading;
      const next = enemy.position.clone();
      next.x += Math.sin(enemy.heading) * this.waveSpeed * dt;
      next.z += Math.cos(enemy.heading) * this.waveSpeed * dt;
      next.y = THREE.MathUtils.damp(enemy.position.y, lane.y, 2, dt);
      if (!blocked(next)) enemy.position.copy(next);
      else {
        const slide = next.clone().addScaledVector(right, enemy.side * 6);
        if (!blocked(slide)) enemy.position.copy(slide);
      }
      enemy.position.x = THREE.MathUtils.clamp(
        enemy.position.x,
        -PLANE_WORLD_LIMIT + 4,
        PLANE_WORLD_LIMIT - 4,
      );
      enemy.position.z = THREE.MathUtils.clamp(
        enemy.position.z,
        PLANE_BOUNDS.minZ + 4,
        PLANE_BOUNDS.maxZ - 4,
      );
      enemy.group.position.copy(enemy.position);
      enemy.group.rotation.set(
        0,
        enemy.heading,
        Math.sin(this.time * 0.8 + enemy.side) * 0.08,
      );
      for (const propeller of enemy.group.userData.propellers)
        propeller.rotation.z -= dt * (14 + this.waveSpeed);
    }
  }

  firePlayerGuns(dt, plane) {
    if (!plane.airborne || !plane.model.userData.gunMounts) return;
    if (!this.enemies.some((enemy) => enemy.alive)) return;
    this.gunTimer -= dt;
    if (this.gunTimer > 0) return;
    this.gunTimer = 0.12;
    const target = this.aimTarget(plane);
    for (const mount of plane.model.userData.gunMounts)
      this.fire(plane.model, mount, "player", 0, 0, target);
  }

  aimTarget(plane) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
      plane.model.quaternion,
    );
    let best = null;
    let bestDot = 0.78;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const toEnemy = enemy.position.clone().sub(plane.model.position);
      const distance = toEnemy.length();
      if (distance < 8 || distance > 220) continue;
      const dot = forward.dot(toEnemy.normalize());
      if (dot > bestDot) {
        bestDot = dot;
        best = enemy.position;
      }
    }
    return best;
  }

  fireEnemyGuns(dt, plane) {
    const playerPos = plane.model.position;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.cooldown -= dt;
      if (enemy.cooldown > 0) continue;
      const toPlayer = playerPos.clone().sub(enemy.position);
      const distance = toPlayer.length();
      if (distance < 12 || distance > 58) continue;
      const forward = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(enemy.group.quaternion)
        .normalize();
      if (forward.dot(toPlayer.normalize()) < 0.84) continue;
      enemy.cooldown = 1.75;
      // Aim ahead of Skybird, then push the shot wide so most of them miss.
      const lead = new THREE.Vector3(
        Math.sin(plane.heading),
        0,
        Math.cos(plane.heading),
      ).multiplyScalar((plane.speed ?? 0) * (distance / 46) * 0.45);
      const aim = playerPos.clone().add(lead);
      const swing = Math.sin(this.time * 1.35 + enemy.side * 1.4);
      const bob = Math.cos(this.time * 1.15 + enemy.index) * 0.045;
      for (const mount of enemy.group.userData.gunMounts) {
        const yaw = swing * 0.16 + Math.sign(mount.x) * 0.07;
        this.fire(enemy.group, mount, "enemy", yaw, bob, aim);
      }
    }
  }

  fire(host, mount, team, yawSpread, pitchSpread, aimAt) {
    if (this.bullets.length > 80) return;
    const muzzle = localPoint(host, mount);
    const direction = new THREE.Vector3(0, 0, 1);
    const inward =
      -Math.sign(mount.x || 1) *
      Math.atan2(Math.abs(mount.x), GUN_CONVERGENCE);
    direction.applyAxisAngle(UP, inward + yawSpread);
    direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitchSpread);
    direction.applyQuaternion(host.quaternion).normalize();
    if (aimAt && team === "player") {
      const toTarget = aimAt.clone().sub(muzzle).normalize();
      direction.lerp(toTarget, 0.86).normalize();
    } else if (aimAt) {
      const toTarget = aimAt.clone().sub(muzzle).normalize();
      const side = new THREE.Vector3().crossVectors(toTarget, UP);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      const lift = new THREE.Vector3().crossVectors(side, toTarget).normalize();
      direction
        .copy(toTarget)
        .addScaledVector(side, yawSpread)
        .addScaledVector(lift, pitchSpread)
        .normalize();
    }
    const mesh = new THREE.Mesh(
      this.bulletGeometry,
      team === "player" ? this.playerBulletMaterial : this.enemyBulletMaterial,
    );
    mesh.castShadow = false;
    mesh.position.copy(muzzle);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    this.parent.add(mesh);
    this.bullets.push({
      team,
      mesh,
      position: muzzle.clone(),
      previous: muzzle.clone(),
      direction,
      speed: team === "player" ? 72 : 46,
      life: team === "player" ? 3.1 : 1.7,
    });
  }

  resolveBullets(dt, plane) {
    let shotDown = false;
    for (const bullet of this.bullets) {
      bullet.life -= dt;
      bullet.previous.copy(bullet.position);
      bullet.position.addScaledVector(bullet.direction, bullet.speed * dt);
      bullet.mesh.position.copy(bullet.position);
      if (bullet.life <= 0 || blocked(bullet.position)) {
        bullet.life = 0;
        continue;
      }
      if (bullet.team === "player") {
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          if (
            !segmentHits(
              bullet.previous,
              bullet.position,
              enemy.position,
              ENEMY_HIT_RADIUS,
            )
          )
            continue;
          enemy.health -= 1;
          bullet.life = 0;
          if (enemy.health <= 0) this.defeatEnemy(enemy);
          break;
        }
      } else if (
        segmentHits(
          bullet.previous,
          bullet.position,
          plane.model.position,
          PLAYER_HIT_RADIUS,
        )
      ) {
        bullet.life = 0;
        this.playerHealth -= 1;
        this.hitGlow.visible = true;
        this.hitGlow.position.copy(plane.model.position);
        this.hitGlow.material.opacity = 0.45;
        if (this.playerHealth <= 0) shotDown = true;
      }
    }
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (this.bullets[i].life > 0) continue;
      this.bullets[i].mesh.removeFromParent();
      this.bullets.splice(i, 1);
    }
    return shotDown;
  }

  defeatEnemy(enemy) {
    this.explode(enemy.position);
    this.retireEnemy(enemy);
  }

  explode(position) {
    const colors = [0xfff0a8, 0xff9a3c, 0xff5c6a];
    const pieces = [];
    for (let i = 0; i < 9; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.burstGeometry, material);
      mesh.castShadow = false;
      const dir = new THREE.Vector3(
        Math.sin(i * 1.4),
        0.3 + (i % 3) * 0.28,
        Math.cos(i * 1.4),
      ).normalize();
      mesh.position.copy(position);
      mesh.scale.setScalar(2.2);
      this.parent.add(mesh);
      pieces.push({ mesh, material, dir, speed: 14 + (i % 4) * 4 });
    }
    this.bursts.push({ pieces, life: 1, duration: 1 });
  }

  updateBursts(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.life -= dt;
      const fade = Math.max(0, burst.life / burst.duration);
      for (const piece of burst.pieces) {
        piece.mesh.position.addScaledVector(piece.dir, piece.speed * dt);
        piece.mesh.scale.setScalar(2.2 + (1 - fade) * 2.4);
        piece.material.opacity = fade;
        if (burst.life <= 0) {
          piece.mesh.removeFromParent();
          piece.material.dispose();
        }
      }
      if (burst.life <= 0) this.bursts.splice(i, 1);
    }
  }

  clearBursts() {
    for (const burst of this.bursts) {
      for (const piece of burst.pieces) {
        piece.mesh.removeFromParent();
        piece.material.dispose();
      }
    }
    this.bursts.length = 0;
  }

  retireEnemy(enemy) {
    enemy.alive = false;
    enemy.group.visible = false;
  }

  hideEnemies() {
    for (const enemy of this.enemies) {
      enemy.alive = false;
      enemy.group.visible = false;
    }
  }

  clearBullets() {
    for (const bullet of this.bullets) bullet.mesh.removeFromParent();
    this.bullets.length = 0;
  }

  fadeHit(dt) {
    if (!this.hitGlow.visible) return;
    this.hitGlow.material.opacity = Math.max(
      0,
      this.hitGlow.material.opacity - dt * 1.8,
    );
    if (this.hitGlow.material.opacity === 0) this.hitGlow.visible = false;
  }
}

function segmentHits(a, b, center, radius) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + aby * aby + abz * abz;
  if (lengthSq < 1e-8) return a.distanceTo(center) <= radius;
  const t = THREE.MathUtils.clamp(
    ((center.x - a.x) * abx + (center.y - a.y) * aby + (center.z - a.z) * abz) /
      lengthSq,
    0,
    1,
  );
  const dx = a.x + abx * t - center.x;
  const dy = a.y + aby * t - center.y;
  const dz = a.z + abz * t - center.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}
