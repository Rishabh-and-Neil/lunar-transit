// Guided ~60-second tutorial overlay on top of a local solo match (MatchConfig.tutorial = true).
import { useEffect, useRef, useState } from "react";
import type { AbilityId, EquipmentId, PublicMatchSnapshot } from "@sm/shared";
import { useGameStore } from "../state/gameStore";
import { ownsEquipment, viewerShip } from "../state/selectors";
import { commands } from "../network/commands";
import { returnToMenu, setTutorialTimeScale } from "../network/session";
import { playSfx } from "../audio/sfx";

const TUTORIAL_LOADOUT: EquipmentId[] = ["whipple-shield", "chemical-booster", "solar-sail", "repair-drone"];

type Cond = (s: PublicMatchSnapshot) => boolean;

interface Step {
  id: string;
  title: string;
  body: string;
  focus?: string; // data-tour key to highlight
  /** Button label; omitted when the step waits for a condition. */
  next?: string;
  /** Advances automatically when true. */
  until?: Cond;
  /** Auto-advance after this many ms (also shows Next). */
  autoMs?: number;
  onEnter?: () => void;
  onNext?: () => void;
  position?: "left" | "bottom" | "center";
  /** Simulation time-warp while this step is shown (only while the ship is still flying). */
  warp?: number;
}

const TASK_WARP = 10;

const used = (id: AbilityId): Cond => (s) => (viewerShip(s)?.stats.abilitiesUsed[id] ?? 0) > 0;
const onMoon: Cond = (s) => {
  const p = viewerShip(s)?.phase;
  return p === "lunar-task" || p === "task-complete" || s.status === "finished";
};

function buildSteps(): Step[] {
  return [
    {
      id: "welcome",
      title: "Welcome, flight director",
      body: "Your goal: fly from Earth to the Moon as fast as possible, survive space hazards, then complete a lunar science task. Let's run a quick mission.",
      next: "Let's go",
      position: "center",
    },
    {
      id: "equip",
      title: "Budget, mass & power",
      body: "You start with 1,000 credits. Attachments add abilities but also mass (slower) and power draw (limited capacity). We installed a sensible loadout: Whipple Shield, Bipropellant Booster, Solar Sail and a Repair Drone. Unspent credits fly with you.",
      focus: "budget",
      onEnter: () => {
        const ship = viewerShip(useGameStore.getState().snapshot);
        for (const id of TUTORIAL_LOADOUT) {
          if (ship && !ownsEquipment(ship, id)) commands.buy(id);
        }
        playSfx("purchase");
      },
      next: "Launch 🚀",
      onNext: () => commands.ready(true),
      position: "left",
    },
    {
      id: "launch",
      title: "Launch sequence",
      body: "Systems check complete. Hold on…",
      until: (s) => s.status === "active",
      position: "center",
    },
    {
      id: "health",
      title: "Hull integrity",
      body: "Hazards chip away at your hull. At 0 HP the mission is lost. Shielding attachments reduce damage of their type.",
      focus: "health",
      autoMs: 6000,
      next: "Next",
      position: "left",
    },
    {
      id: "credits",
      title: "Credits",
      body: "Credits pay for in-flight abilities and repairs. Spend wisely — there's no income unless you carry a Deep Space Transponder.",
      focus: "credits",
      autoMs: 6000,
      next: "Next",
      position: "left",
    },
    {
      id: "progress",
      title: "Route progress",
      body: "Your ship follows the translunar route automatically. Lighter ships with more thrust arrive sooner.",
      focus: "progress",
      autoMs: 6000,
      next: "Next",
      position: "left",
    },
    {
      id: "thrust",
      title: "Try a Thruster Burn",
      body: "Press 1 (or tap the 🚀 button) for +45% speed. Every ability costs credits and has a cooldown.",
      focus: "ability-thruster-burn",
      until: used("thruster-burn"),
      position: "left",
    },
    {
      id: "hazard",
      title: "Hazard warnings",
      body: "A red banner warns before a hazard strikes. Press 3 for Deflector Surge to cut incoming damage by 60% for 10 seconds.",
      focus: "ability-deflector-surge",
      until: used("deflector-surge"),
      next: "Next",
      position: "left",
    },
    {
      id: "repair",
      title: "Repairs",
      body: "Your Repair Drone (F) heals the hull over a few seconds. Each repair costs more than the last, and the drone needs to cool down.",
      focus: "repair",
      autoMs: 8000,
      next: "Next",
      position: "left",
    },
    {
      id: "clock",
      title: "Overtime & auto-simulation",
      body: "Main flight lasts 3:00. In overtime (3:00–4:00) abilities cost half but do half. After 4:00 the autopilot flies 6× faster and buys boosts for you — every surviving ship arrives.",
      focus: "clock",
      autoMs: 9000,
      next: "Next",
      position: "left",
    },
    {
      id: "task",
      title: "Lunar task",
      body: "When you reach the Moon, a science task appears: antenna pointing, power budgets, orbit burns, surface spectra or terrain maps. Attempts are unlimited — the clock stops when you succeed.",
      until: (s) => s.status === "finished",
      position: "bottom",
      warp: TASK_WARP,
    },
    {
      id: "done",
      title: "Mission accomplished!",
      body: "You're ready for a real mission. Try Solo to set a personal best, or challenge a friend online.",
      next: "Back to main menu",
      onNext: () => returnToMenu(),
      position: "center",
    },
  ];
}

export function TutorialOverlay() {
  const steps = useRef(buildSteps()).current;
  const [idx, setIdx] = useState(0);
  const snap = useGameStore((s) => s.snapshot);
  const step = steps[Math.min(idx, steps.length - 1)];
  const enteredRef = useRef<number>(-1);

  // Run onEnter once per step, and highlight focus element.
  useEffect(() => {
    if (enteredRef.current !== idx) {
      enteredRef.current = idx;
      step.onEnter?.();
    }
    if (step.focus) document.documentElement.setAttribute("data-tour-focus", step.focus);
    else document.documentElement.removeAttribute("data-tour-focus");
    return () => document.documentElement.removeAttribute("data-tour-focus");
  }, [idx, step]);

  // Time-warp the local sim (tutorial only) so the whole flight fits in about a minute.
  const flying = useGameStore((s) => {
    const p = viewerShip(s.snapshot)?.phase;
    return p === "main-flight" || p === "overtime" || p === "simulation";
  });
  const warp = flying && step.warp ? step.warp : 1;
  useEffect(() => {
    setTutorialTimeScale(warp);
  }, [warp]);
  useEffect(() => () => setTutorialTimeScale(1), []);

  // Condition-based advancing, plus jumps when the sim moves ahead of the script.
  useEffect(() => {
    if (!snap) return;
    const taskIdx = steps.findIndex((s) => s.id === "task");
    const doneIdx = steps.length - 1;
    if (snap.status === "finished" && idx < doneIdx) {
      setIdx(doneIdx);
      return;
    }
    if (onMoon(snap) && idx < taskIdx && snap.status === "active") {
      setIdx(taskIdx);
      return;
    }
    if (step.until && step.until(snap)) setIdx((i) => i + 1);
  }, [snap, idx, step, steps]);

  useEffect(() => {
    if (!step.autoMs) return;
    const id = window.setTimeout(() => setIdx((i) => (i === idx ? i + 1 : i)), step.autoMs);
    return () => window.clearTimeout(id);
  }, [idx, step.autoMs]);

  // On the Moon the task UI needs the space: shrink the card into a corner.
  const compact = step.id === "task" && !flying && snap?.status === "active";

  const next = () => {
    playSfx("click");
    step.onNext?.();
    if (step.id !== "done") setIdx((i) => Math.min(steps.length - 1, i + 1));
  };

  return (
    <div
      className={`tutorial-card pos-${compact ? "corner" : step.position ?? "left"} ${compact ? "compact" : ""}`}
      key={step.id}
      role="dialog"
      aria-label="Tutorial"
    >
      <div className="tut-progress">
        {steps.map((s, i) => (
          <span key={s.id} className={i < idx ? "done" : i === idx ? "on" : ""} />
        ))}
      </div>
      <div className="kicker">TUTORIAL · {idx + 1}/{steps.length}</div>
      <h3>{step.title}</h3>
      <p>{compact ? "Solve the task to finish the mission — the clock stops when you succeed." : step.body}</p>
      {warp > 1 && <p className="tut-warp">⏩ Autopilot fast-forward ×{warp} to the Moon…</p>}
      <div className="tut-actions">
        {step.id !== "done" && (
          <button className="btn btn-small btn-ghost" onClick={returnToMenu}>
            Skip tutorial
          </button>
        )}
        {step.next ? (
          <button className="btn btn-small btn-primary" onClick={next}>
            {step.next}
          </button>
        ) : (
          <span className="tut-wait">
            <span className="spinner small" /> waiting…
          </span>
        )}
      </div>
    </div>
  );
}
