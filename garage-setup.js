import { liveryById } from "./driver-themes.js?v=27";
import { driverById } from "./driver-roster.js";

export const GARAGE_KEY = "f1racer-garage-v1";
export const DEFAULT_SETUP = { frontWing:"balanced", rearWing:"balanced", floor:"balanced", brakes:"balanced", suspension:"balanced" };
export const GARAGE_PARTS = {
  frontWing:{ label:"Ala anteriore", variants:{
    low:{label:"Scarica", speed:2, downforce:-2, stability:-1},
    balanced:{label:"Bilanciata"},
    high:{label:"Carica", speed:-2, downforce:3, stability:1}
  }},
  rearWing:{ label:"Ala posteriore", variants:{
    low:{label:"Scarica", speed:3, downforce:-2, traction:-1, stability:-2},
    balanced:{label:"Bilanciata"},
    high:{label:"Carica", speed:-3, downforce:3, traction:2, stability:3}
  }},
  floor:{ label:"Fondo / diffusore", variants:{
    low:{label:"Basso carico", speed:2, downforce:-2},
    balanced:{label:"Bilanciato"},
    high:{label:"Alto carico", speed:-1, downforce:4, traction:1, runoff:-2}
  }},
  brakes:{ label:"Freni", variants:{
    stable:{label:"Stabili", braking:-1, stability:3},
    balanced:{label:"Bilanciati"},
    aggressive:{label:"Aggressivi", braking:4, stability:-2}
  }},
  suspension:{ label:"Sospensioni", variants:{
    soft:{label:"Morbide", stability:1, traction:2, runoff:3, downforce:-1},
    balanced:{label:"Bilanciate"},
    stiff:{label:"Rigide", stability:3, downforce:2, traction:-1, runoff:-2}
  }}
};
export function loadGarageSetup(){
  try {
    const stored = JSON.parse(localStorage.getItem(GARAGE_KEY)||"{}");
    const setup = {...DEFAULT_SETUP};
    // Only known parts/variants survive: older saves also carried a `livery`.
    for (const part of Object.keys(GARAGE_PARTS)) if (GARAGE_PARTS[part].variants[stored[part]]) setup[part] = stored[part];
    return setup;
  } catch(e){ return {...DEFAULT_SETUP}; }
}
export function saveGarageSetup(setup){ try { localStorage.setItem(GARAGE_KEY,JSON.stringify(setup)); } catch(e){} }
export function setupEffects(setup=loadGarageSetup()){
  const e={speed:0,downforce:0,braking:0,stability:0,traction:0,runoff:0};
  for(const [part,id] of Object.entries(setup)){ const v=GARAGE_PARTS[part]?.variants[id]||{}; for(const k of Object.keys(e)) e[k]+=v[k]||0; }
  return e;
}
// The player races in their chosen driver's team colours, like the AI
// teammate sharing that livery; liveryById falls back to Fenice.
export function playerLivery(driverId){
  return liveryById(driverById(driverId).team);
}
