import * as THREE from "three";
import { box } from "./models.js";
import { MOUNTAINS, terrainBlocks, waterAt } from "./northern-terrain.js";
import {
  NORTH_AIRFIELD_SITE,
  PLANE_BOUNDS,
  PLANE_MAX_ALTITUDE,
  PLANE_WORLD_LIMIT,
} from "./airfield.js";

// Enemies wait until Skybird is north of the first peak. Their shots are
// intentionally wide so a steady flight is hard to lose.
export const ENEMY_PLANE_COUNT = 2;
export const PLAYER_HEALTH = 16;
export const ENEMY_HEALTH = 8;
export const FIRST_MOUNTAIN_PASS_Z = MOUNTAINS[0].z - MOUNTAINS[0].radius;
const PLAYER_HIT_RADIUS = 1.9;
const ENEMY_HIT_RADIUS = 2.35;
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
  plane.scale.setScalar(0.86);
  return plane;
}

export class FlightCombat {
  constructor(parent) {
    this.parent = parent;
    this.time = 0;
    this.state = "idle";
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
        phase: "approach",
        phaseTime: 0,
        alive: false,
      };
    });
  }

  endFlight() {
    this.state = "idle";
    this.playerHealth = PLAYER_HEALTH;
    this.gunTimer = 0;
    this.hideEnemies();
    this.clearBullets();
    this.hitGlow.visible = false;
  }

  update(dt, plane) {
    this.time += dt;
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
    const forward = new THREE.Vector3(
      Math.sin(plane.heading),
      0,
      Math.cos(plane.heading),
    );
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    for (const enemy of this.enemies) {
      const spawn = plane.model.position
        .clone()
        .addScaledVector(forward, -34 - enemy.index * 14)
        .addScaledVector(right, enemy.side * 18);
      spawn.y = THREE.MathUtils.clamp(plane.model.position.y, 18, 60);
      enemy.position.copy(this.openSpawn(spawn, enemy.side));
      enemy.heading = plane.heading;
      enemy.health = ENEMY_HEALTH;
      enemy.cooldown = 1.7 + enemy.index * 0.4;
      enemy.phase = "approach";
      enemy.phaseTime = 0;
      enemy.alive = true;
      enemy.group.visible = true;
      enemy.group.position.copy(enemy.position);
      enemy.group.rotation.set(0, enemy.heading, 0);
    }
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
    const forward = new THREE.Vector3(
      Math.sin(plane.heading),
      0,
      Math.cos(plane.heading),
    );
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.phaseTime += dt;
      let distance = enemy.position.distanceTo(playerPos);
      // A mountain can leave a plane behind. Bring it back into the chase.
      if (distance > 110) {
        const rejoin = playerPos
          .clone()
          .addScaledVector(forward, -32 - enemy.index * 8)
          .addScaledVector(right, enemy.side * 16);
        rejoin.y = THREE.MathUtils.clamp(playerPos.y, 20, 58);
        enemy.position.copy(this.openSpawn(rejoin, enemy.side));
        enemy.heading = plane.heading;
        enemy.phase = "approach";
        enemy.phaseTime = 0;
        enemy.cooldown = Math.max(enemy.cooldown, 1.1);
        distance = enemy.position.distanceTo(playerPos);
      }
      if (enemy.phase === "break") {
        if (enemy.phaseTime > 2.2) {
          enemy.phase = "approach";
          enemy.phaseTime = 0;
        }
      } else if (distance < 14) {
        enemy.phase = "break";
        enemy.phaseTime = 0;
      }
      const goal = playerPos.clone();
      if (enemy.phase === "break") {
        goal
          .addScaledVector(forward, -24)
          .addScaledVector(right, enemy.side * 34);
      } else {
        goal
          .addScaledVector(forward, 20)
          .addScaledVector(right, enemy.side * 9);
      }
      goal.y = THREE.MathUtils.clamp(
        playerPos.y + Math.sin(this.time * 0.7 + enemy.side) * 4,
        16,
        PLANE_MAX_ALTITUDE - 8,
      );
      const toGoal = goal.clone().sub(enemy.position);
      let desired = Math.atan2(toGoal.x, toGoal.z);
      if (enemy.phase === "approach" && distance < 56 && distance > 12) {
        const face = Math.atan2(
          playerPos.x - enemy.position.x,
          playerPos.z - enemy.position.z,
        );
        desired += angleDelta(desired, face) * 0.5;
      }
      enemy.heading += THREE.MathUtils.clamp(
        angleDelta(enemy.heading, desired),
        -1.5 * dt,
        1.5 * dt,
      );
      const speed = distance > 50 ? 33 : enemy.phase === "approach" ? 26 : 21;
      const next = enemy.position.clone();
      next.x += Math.sin(enemy.heading) * speed * dt;
      next.z += Math.cos(enemy.heading) * speed * dt;
      next.y = THREE.MathUtils.damp(enemy.position.y, goal.y, 2.2, dt);
      if (!blocked(next)) enemy.position.copy(next);
      else {
        const slide = next.clone();
        slide.x += enemy.side * 8;
        if (!blocked(slide)) enemy.position.copy(slide);
        else
          enemy.position.y = Math.min(
            PLANE_MAX_ALTITUDE - 8,
            enemy.position.y + 10 * dt,
          );
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
      const away = enemy.position.clone().sub(playerPos);
      const gap = away.length();
      if (gap < 8 && gap > 0.001) {
        away.setLength(8);
        const pushed = playerPos.clone().add(away);
        pushed.y = enemy.position.y;
        if (!blocked(pushed)) enemy.position.copy(pushed);
      }
      enemy.group.position.copy(enemy.position);
      enemy.group.rotation.set(
        0,
        enemy.heading,
        Math.sin(this.time * 0.8 + enemy.side) * 0.1,
      );
      for (const propeller of enemy.group.userData.propellers)
        propeller.rotation.z -= dt * (14 + speed);
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
      if (distance < 6 || distance > 75) continue;
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
      direction.lerp(toTarget, 0.62).normalize();
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
      life: team === "player" ? 1.15 : 1.7,
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
