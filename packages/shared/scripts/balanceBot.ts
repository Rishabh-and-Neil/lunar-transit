import { createMatch, applyCommand, startCountdown, advance, canActivateAbility } from "../src/simulation/engine";
import type { MatchState, EquipmentId, AbilityId, Difficulty } from "../src/types";
let n=0;
function run(label: string, equip: EquipmentId[], use: AbilityId[], diff: Difficulty, seed: number) {
  let s: MatchState = createMatch({ id:"m", mode:"solo", difficulty: diff, seed, players:[{id:"p1",name:"a",role:"solo"}]});
  for (const e of equip) { const r = applyCommand(s,{type:"PURCHASE_EQUIPMENT",playerId:"p1",equipmentId:e,commandId:"c"+(n++)}); if(!r.ok) console.log("buy fail",e,r.reason); s=r.state; }
  s = advance(startCountdown(s), 3000);
  while (s.status==="active" && s.spacecraft[0].phase!=="lunar-task") {
    for (const a of use) if (canActivateAbility(s,"p1",a).ok) { s = applyCommand(s,{type:"ACTIVATE_ABILITY",playerId:"p1",abilityId:a,commandId:"c"+(n++)}).state; }
    if (s.spacecraft[0].hasRepairDrone && s.spacecraft[0].health<70) { const r=applyCommand(s,{type:"ACTIVATE_REPAIR",playerId:"p1",commandId:"c"+(n++)}); if(r.ok) s=r.state; }
    s = advance(s, 50);
  }
  const sh = s.spacecraft[0];
  return { label, diff, seed, arrive: ((sh.arrivedAtMs??NaN)/1000).toFixed(1), phase: sh.phase, hp: sh.health.toFixed(0), credits: sh.credits.toFixed(0), dmg: sh.stats.damageTaken.toFixed(0), hz: sh.stats.hazardsEncountered };
}
const rows=[];
for (const diff of ["normal","hard"] as Difficulty[]) for (const seed of [1,2,3]) {
  rows.push(run("speed-noboost", ["chemical-booster","solar-sail","ion-thruster","solar-array"], [], diff, seed));
  rows.push(run("smart", ["whipple-shield","thermal-blanket","solar-sail"], ["gravity-assist","deflector-surge","thruster-burn","hull-patch"], diff, seed));
  rows.push(run("smart+drone", ["whipple-shield","radiation-vault","repair-drone"], ["gravity-assist","deflector-surge","hull-patch","thruster-burn"], diff, seed));
}
console.table(rows);
