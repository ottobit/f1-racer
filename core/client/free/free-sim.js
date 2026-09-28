// Free-drive simulation (#274): one car on the banked oval, no rivals, no
// session. Same physics as the race (player-physics.js); the only additions
// are the banked pose (height, pitch, roll) and a lateral-grip bonus while
// the car is on a banked road. Free of DOM and three.js, so Node can drive it.
import { setupPlayerPhysics } from "../race/player-physics.js?v=9";
import { steeringYaw } from "../race/steering.js?v=8";
import { createTrackBoundary, playerCarParams } from "../race/race-rules.js?v=3";
import { headingOf, nearestTrackInfo as nearestOnCenterline, sampleCenterline, sideNormal } from "../shared/track-geometry.js?v=39";
import { bankGripFactor, createBanking, poseOnSurface } from "./banking.js?v=1";

const CENTERLINE_SAMPLES = 480;
const START_INDEX = 0;

// `curve` is a closed three.js CatmullRomCurve3 through circuit.points;
// `input` and `steering` are the controls the physics reads (the page's own
// setupRaceInput objects, or plain ones in Node).
export function createFreeSim({ circuit, curve, effects, input = { forward: false, back: false, left: false, right: false }, steering = { value: 0 } }) {
  const centerline = sampleCenterline(curve, CENTERLINE_SAMPLES);
  const visualCenterline = sampleCenterline(curve, CENTERLINE_SAMPLES * 4);
  const trackLength = curve.getLength();
  const nearestTrackInfo = (x, z) => nearestOnCenterline(centerline, x, z);
  const banking = createBanking({
    centerline,
    trackWidth: circuit.width,
    maxBankDeg: circuit.maxBankDeg,
    sideNormal,
  });
  const car = playerCarParams(effects, false);
  const { grassLimit, applyTrackBoundary } = createTrackBoundary({
    trackWidth: circuit.width,
    runoffEffect: effects.runoff,
    nearestTrackInfo,
    kerbWidth: 0.3,
  });

  const start = centerline[START_INDEX];
  const state = {
    x: start.x, z: start.z, heading: headingOf(start), speed: 0,
    lateralSpeed: 0, yawRate: 0, damage: 0,
    drsActive: false, ersActive: false, totalProgress: 0,
    tyreCompound: "medium", tyreProgress: 0,
    wasOffTrack: false, trackLimitViolationsThisLap: 0,
    // Banked pose, updated every frame.
    y: 0, pitch: 0, roll: 0, bank: 0, surface: null,
  };
  // No wear in free drive; the bank adds lateral grip where the car sits on
  // the road (the surface of the previous step: one frame of lag).
  const tireGripFactor = (_progress, who) => (who.surface ? bankGripFactor(who.surface) : 1);
  const { integratePlayerMotion } = setupPlayerPhysics({
    car, state, input, steering,
    drsSpeedMultiplier: 1,
    ersSpeedMultiplier: 1,
    grassLimit,
    tireGripFactor,
    tyreSpeedFactor: () => 1,
    cautionSpeedMultiplier: () => 1,
    steeringYaw,
    nearestTrackInfo,
    applyTrackBoundary,
    slipstreamCars: [],
  });

  function updatePose(info) {
    const surface = banking.surfaceAt(state.x, state.z, info);
    const pose = poseOnSurface(surface, state.heading);
    state.surface = surface;
    state.y = surface.y;
    state.pitch = pose.pitch;
    state.roll = pose.roll;
    state.bank = surface.bankAngle;
  }
  updatePose(nearestTrackInfo(state.x, state.z));

  // Advances the car by dt seconds and refreshes its banked pose.
  function step(dt) {
    const info = integratePlayerMotion(dt);
    updatePose(info);
    return info;
  }

  return { state, input, steering, car, centerline, visualCenterline, banking, trackLength, grassLimit, nearestTrackInfo, step };
}
