import { useState } from "react";
import { useGameStore } from "../state/gameStore";
import { viewerPlayer } from "../state/selectors";
import { MissionClock } from "./MissionClock";
import { BudgetDisplay, EffectChips, HealthBar } from "./ShipStatus";
import { OpponentMap, RouteProgress } from "./RouteProgress";
import { AbilityPanel } from "./AbilityPanel";
import { EventFeed, HazardBanner } from "./HazardFeed";
import { ROLE_INFO } from "../screens/Lobby";

/** In-flight HUD. Panels hug the edges so the scene center stays clear. */
export function FlightHUD() {
  const role = useGameStore((s) => viewerPlayer(s.snapshot)?.role);
  const mode = useGameStore((s) => s.snapshot?.mode);
  const [feedOpen, setFeedOpen] = useState(true);
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-tl panel-glass">
          {mode === "coop" && role && (
            <div className="role-pill">
              {ROLE_INFO[role].icon} {ROLE_INFO[role].label}
            </div>
          )}
          <HealthBar />
          <BudgetDisplay />
          <EffectChips />
        </div>
        <div className="hud-tc">
          <MissionClock />
          <RouteProgress />
          <HazardBanner />
        </div>
        <div className="hud-tr">
          <OpponentMap />
          <div className={`feed-wrap ${feedOpen ? "" : "collapsed"}`}>
            <button className="feed-toggle" onClick={() => setFeedOpen((o) => !o)} aria-expanded={feedOpen}>
              MISSION LOG {feedOpen ? "▾" : "▸"}
            </button>
            {feedOpen && <EventFeed />}
          </div>
        </div>
      </div>
      <div className="hud-bottom">
        <AbilityPanel />
      </div>
    </div>
  );
}
