export function setupRaceNameplates({ camera, mount, cars, nameOf, isDisconnected = () => false }) {
  const projected = camera.position.clone();
  const labels = cars.map((car) => {
    const label = document.createElement("span");
    label.className = "driver-nameplate";
    label.textContent = nameOf(car.driverId);
    const color = `#${(car.color ?? 0xffffff).toString(16).padStart(6, "0")}`;
    label.style.setProperty("--driver-color", color);
    mount.appendChild(label);
    return { car, label };
  });

  function update() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (const { car, label } of labels) {
      projected.set(car.x, 1.72, car.z);
      const distance = camera.position.distanceTo(projected);
      projected.project(camera);
      const visible =
        car.group.visible &&
        projected.z > -1 && projected.z < 1 &&
        Math.abs(projected.x) < 1.08 && Math.abs(projected.y) < 1.08 &&
        distance < 72;
      label.hidden = !visible;
      label.classList.toggle("driver-nameplate--disconnected", isDisconnected(car.driverId));
      if (!visible) continue;
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      const scale = Math.max(0.72, Math.min(1, 28 / Math.max(distance, 1)));
      label.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%) scale(${scale})`;
      label.style.opacity = String(Math.max(0.42, Math.min(1, 1.18 - distance / 90)));
    }
  }

  return { update };
}
