import { TEAM_LIVERIES, liveryById } from "./driver-themes.js?v=27";

export const GARAGE_KEY = "f1racer-garage-v1";
export const DEFAULT_SETUP = { frontWing:"balanced", rearWing:"balanced", floor:"balanced", brakes:"balanced", suspension:"balanced", livery:"fenice" };
export const GARAGE_LIVERIES = TEAM_LIVERIES;
export const GARAGE_PARTS = {
  frontWing:{ label:"Ala anteriore", variants:{
    low:{label:"Low drag", speed:2, downforce:-2, stability:-1},
    balanced:{label:"Balanced"},
    high:{label:"High downforce", speed:-2, downforce:3, stability:1}
  }},
  rearWing:{ label:"Ala posteriore", variants:{
    low:{label:"Low drag", speed:3, downforce:-2, traction:-1, stability:-2},
    balanced:{label:"Balanced"},
    high:{label:"High downforce", speed:-3, downforce:3, traction:2, stability:3}
  }},
  floor:{ label:"Fondo / diffusore", variants:{
    low:{label:"Low drag", speed:2, downforce:-2},
    balanced:{label:"Balanced"},
    high:{label:"High load", speed:-1, downforce:4, traction:1, runoff:-2}
  }},
  brakes:{ label:"Freni", variants:{
    stable:{label:"Stabili", braking:-1, stability:3},
    balanced:{label:"Balanced"},
    aggressive:{label:"Aggressivi", braking:4, stability:-2}
  }},
  suspension:{ label:"Sospensioni", variants:{
    soft:{label:"Morbide", stability:1, traction:2, runoff:3, downforce:-1},
    balanced:{label:"Balanced"},
    stiff:{label:"Rigide", stability:3, downforce:2, traction:-1, runoff:-2}
  }}
};
export function loadGarageSetup(){
  try {
    const setup = {...DEFAULT_SETUP,...JSON.parse(localStorage.getItem(GARAGE_KEY)||"{}")};
    if (!GARAGE_LIVERIES.some((livery) => livery.id === setup.livery)) setup.livery = DEFAULT_SETUP.livery;
    return setup;
  } catch(e){ return {...DEFAULT_SETUP}; }
}
export function saveGarageSetup(setup){ try { localStorage.setItem(GARAGE_KEY,JSON.stringify(setup)); } catch(e){} }
export function setupEffects(setup=loadGarageSetup()){
  const e={speed:0,downforce:0,braking:0,stability:0,traction:0,runoff:0};
  for(const [part,id] of Object.entries(setup)){ const v=GARAGE_PARTS[part]?.variants[id]||{}; for(const k of Object.keys(e)) e[k]+=v[k]||0; }
  return e;
}
export function selectedGarageLivery(setup=loadGarageSetup()){
  return liveryById(setup.livery);
}
