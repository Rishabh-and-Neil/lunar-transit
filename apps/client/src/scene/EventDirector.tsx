import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { GameEvent, HazardType, PublicMatchSnapshot } from "@sm/shared";
import { ABILITIES } from "@sm/shared";
import { renderBridge } from "../state/renderBridge";
import { HAZARD_COLORS } from "./constants";
import { fxBus } from "./fxBus";

const HIT_FLASH: Record<HazardType, number> = {
  micrometeoroid: 0.12,
  "solar-flare": 0.42,
  "radiation-belt": 0.3,
  "space-debris": 0.14,
  "thermal-spike": 0.32,
  "nav-anomaly": 0.22,
};

function dispatch(ev: GameEvent, snap: PublicMatchSnapshot): void {
  const viewer = snap.viewerShipId;
  switch (ev.kind) {
    case "hazard-hit": {
      fxBus.push(ev.shipId, ev.hazard);
      if (ev.shipId === viewer) {
        fxBus.kickShake(0.35 + Math.min(0.6, ev.damage / 25));
        fxBus.screenFlash(HAZARD_COLORS[ev.hazard], HIT_FLASH[ev.hazard]);
      }
      break;
    }
    case "ability": {
      const def = ABILITIES[ev.ability];
      if (def.kind === "deterrent") {
        const target = ev.targetShipId ?? snap.spacecraft.find((s) => s.id !== ev.shipId)?.id;
        if (target) {
          fxBus.push(target, ev.ability);
          if (target === viewer) {
            fxBus.kickShake(ev.ability === "debris-scatter" || ev.ability === "emp-pulse" ? 0.6 : 0.3);
            const c = ev.ability === "ion-jammer" ? "#3d7bff" : ev.ability === "comms-spoof" ? "#ff3d5a" : ev.ability === "tractor-lock" ? "#ff5fd2" : "#cdeeff";
            fxBus.screenFlash(c, 0.22);
          }
        }
      } else {
        fxBus.push(ev.shipId, ev.ability);
        if (ev.shipId === viewer && ev.ability === "gravity-assist") fxBus.screenFlash("#9fd8ff", 0.18);
      }
      break;
    }
    case "repair-start":
      fxBus.push(ev.shipId, "repair");
      break;
    case "repair-done":
      fxBus.push(ev.shipId, "repair-done");
      break;
    default:
      break;
  }
}

/** Watches snapshot events (by seq) and fans them out to per-ship FX queues. */
export function EventDirector() {
  const st = useRef({ matchId: "", lastSeq: -1 });
  useFrame(() => {
    const snap = renderBridge.curr;
    if (!snap) return;
    const s = st.current;
    let maxSeq = s.lastSeq;
    for (const e of snap.events) if (e.seq > maxSeq) maxSeq = e.seq;
    if (snap.id !== s.matchId) {
      // New match / first mount: don't replay history.
      s.matchId = snap.id;
      s.lastSeq = maxSeq;
      return;
    }
    if (maxSeq <= s.lastSeq) return;
    const fresh = snap.events.filter((e) => e.seq > s.lastSeq).sort((a, b) => a.seq - b.seq);
    for (const e of fresh) dispatch(e, snap);
    s.lastSeq = maxSeq;
  });
  return null;
}
