// 3D model of a Vehicle (#339), kept apart from vehicle.js so the physics
// side stays free of three. One builder per vehicle kind; every builder
// returns buildCar()'s contract (car-model.js) — {group, wheels, ...}.
//
//   colors: livery (F1: number or {primary, secondary}; road: {primary, secondary?})
//   scale, detail: as the builders take them
//   environmentTexture: studio reflections (race and free drive)
//   showroom: the garage plinth model (F1 without its driver)
import { buildCar } from "./car-model.js?v=38";
import { buildRoadVehicle } from "./vehicle-models.js?v=6";
import { batchModel } from "./mesh-batch.js?v=1";

const BUILDERS = {
  f1: (vehicle, colors, { scale, detail, showroom }) => buildCar(colors, {
    scale,
    detail,
    showDriver: !showroom,
    // A two-tone livery also carries its accent (race-car-view.js did this).
    ...(typeof colors === "object" ? { secondaryColor: colors.secondary, accentColor: colors.secondary } : {}),
  }),
  road: (vehicle, colors, { scale, detail }) => buildRoadVehicle(vehicle.id, colors, { scale, detail }),
};

export function buildVehicleModel(vehicle, colors, { scale = 1, detail = false, environmentTexture = null, envMapIntensity = 0.65, showroom = false } = {}) {
  const model = BUILDERS[vehicle.kind](vehicle, colors, { scale, detail, showroom });
  // Every low-detail vehicle (#357): one mesh per material per group, so a
  // race grid costs a few draw calls per car whatever its kind. Groups
  // (wheels, steering, wings) keep their own transforms and animation.
  if (!detail) batchModel(model.group);
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
