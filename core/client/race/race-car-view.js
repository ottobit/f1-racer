import { buildCar as buildCarModel } from "../shared/car-model.js?v=30";

const DEFAULT_FRONT_WHEEL_STEER_ANGLE = 0.55;

export function buildRaceCar(color, { scale, environmentTexture, envMapIntensity = 0.65, detail = false } = {}) {
  const model = buildCarModel(color, {
    scale,
    detail,
    secondaryColor: typeof color === "object" ? color.secondary : undefined,
    accentColor: typeof color === "object" ? color.secondary : undefined,
  });
  if (environmentTexture) {
    model.group.traverse((object) => {
      if (object.isMesh) {
        object.material.envMap = environmentTexture;
        object.material.envMapIntensity = envMapIntensity;
      }
    });
  }
  return model;
}

export function applyCarToMesh(
  model,
  x,
  z,
  heading,
  speed,
  dt,
  steer = 0,
  frontWheelSteerAngle = DEFAULT_FRONT_WHEEL_STEER_ANGLE
) {
  model.group.position.set(x, 0, z);
  model.group.rotation.y = heading;

  const spin = (speed * dt) / model.wheelRadius;
  for (const wheel of model.wheels) wheel.rotation.x -= spin;

  if (model.steeringPivots) {
    model.steeringPivots.forEach((pivot) => {
      pivot.rotation.y = -steer * frontWheelSteerAngle;
    });
  }
  // The rim's top moves the way the front tyres point (#145): pivots turn
  // toward -x for positive steer, and +rotation.z tips the top toward -x.
  if (model.driverSteeringWheel) {
    model.driverSteeringWheel.rotation.z = steer * 0.55;
  }
}
