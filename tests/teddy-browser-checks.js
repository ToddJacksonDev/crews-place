export function addTeddyChecks(game) {
  const button = document.createElement("button");
  button.textContent = "Check Teddy River";
  button.style.cssText =
    "position:fixed;top:90px;left:20px;z-index:100;padding:12px";
  document.body.append(button);
  const panel = document.createElement("pre");
  panel.style.cssText =
    "position:fixed;top:140px;left:20px;z-index:100;background:white;color:black;padding:12px;max-width:500px;white-space:pre-wrap";
  document.body.append(panel);
  const ride = game.teddyWorld;
  const bears = document.createElement("button");
  bears.textContent = "Giant bears view";
  bears.style.cssText =
    "position:fixed;top:90px;right:20px;z-index:100;padding:12px";
  document.body.append(bears);
  bears.onclick = () => {
    ride.exitBoat();
    game.player.teleport(-80, -2160);
    game.setMode("paused");
    game.camera.position.set(-8, 27, -2135);
    game.camera.lookAt(-78, 20, -2210);
    game.renderer.render(game.scene, game.camera);
  };

  const assert = (ok, msg) => {
    if (!ok) throw Error(msg);
  };
  const key = (code) => {
    game.input.press(code);
    game.tick(1 / 60);
    game.input.release(code);
  };
  button.onclick = () => {
    try {
      game.setMode("playing");
      if (ride.boatBoarded) ride.exitBoat();
      game.player.teleport(ride.dockPos.x, ride.dockPos.z + 2);
      for (let i = 0; i < 35; i++) game.tick(1 / 60);
      assert(
        game.interactions.current?.id === "teddy-steamboat",
        "Dock prompt missing",
      );
      assert(
        ride.boat.position.distanceTo(ride.harborPos) < 0.01,
        "Boat is not waiting in the boarding pool",
      );
      assert(ride.boat.position.y < 1, "Boarding boat is above the visitor");
      key("KeyE");
      assert(ride.boatBoarded, "Board key failed");
      game.tick(1 / 60);
      assert(
        game.camera.position.distanceTo(ride.boat.position) > 25,
        "Camera too close",
      );
      key("KeyE");
      assert(!ride.boatBoarded && !game.player.inVehicle, "Exit key failed");
      assert(Math.abs(game.player.position.y) < 0.01, "Exit above ground");
      ride.board();
      const stages = new Set();
      for (let i = 0; i < 20000 && ride.distance < ride.route.length; i++) {
        ride.updateRide(1 / 60);
        stages.add(ride.route.stage(ride.distance));
        assert(
          ride.boat.position.toArray().every(Number.isFinite),
          "Nonfinite boat",
        );
      }
      assert(
        stages.has("waterfall") && stages.has("lake") && stages.has("arrived"),
        "Incomplete route",
      );
      assert(ride.boat.position.y < 1, "Boat never landed");
      ride.hud.querySelector(".teddy-exit").click();
      assert(!ride.boatBoarded && ride.hud.hidden, "Button exit failed");
      ride.board();
      assert(ride.distance === 0, "Replay failed");
      let previous = ride.boat.position.clone();
      for (let i = 0; i < 850; i++) {
        ride.updateRide(1 / 60);
        assert(
          ride.boat.position.distanceTo(previous) < 0.2,
          "Lift jumps instead of moving continuously",
        );
        previous.copy(ride.boat.position);
      }
      assert(
        ride.liftTime === 14 && ride.boat.position.y > 31,
        "Lift did not reach the river",
      );
      ride.distance = ride.route.riverLength - 10;
      ride.updateRide(1 / 60);
      ride.updateCamera(1);
      panel.textContent =
        "PASS: boat floating beside dock, continuous water lift, dock prompt, E boarding, wide camera, E exit, full river → waterfall → lake, button exit, replay.\nRoute: " +
        Math.round(ride.route.length) +
        " m";
    } catch (e) {
      panel.textContent = "FAIL: " + e.stack;
    }
  };
  for (const [name, distance] of [
    ["River view", 180],
    ["Waterfall view", ride.route.riverLength + 15],
    ["Lake view", ride.route.length],
  ]) {
    const b = document.createElement("button");
    b.textContent = name;
    b.style.cssText = "padding:10px;margin:3px";
    b.onclick = () => {
      if (!ride.boatBoarded) ride.board();
      ride.liftTime = 14;
      ride.distance = distance;
      ride.updateRide(1 / 60);
      ride.updateCamera(1);
    };
    button.after(b);
    b.style.position = "relative";
    b.style.zIndex = 100;
  }
}
