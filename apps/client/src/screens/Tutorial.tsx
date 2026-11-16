// Guided, hands-on tutorial: the player builds their own ship, launches, handles a real hazard,
// repairs, and solves the lunar task — with the simulation paused while each explanation is read.
import { useEffect, useRef, useState } from "react";
import { ATTACHMENTS, HAZARDS, type AbilityId, type LunarTaskId, type PublicMatchSnapshot } from "@sm/shared";
import { useGameStore } from "../state/gameStore";
import { formatClock, ownsEquipment, viewerShip } from "../state/selectors";
import { returnToMenu, setTutorialPaused, setTutorialTimeScale, startSolo } from "../network/session";
import { playSfx } from "../audio/sfx";

type Snap = PublicMatchSnapshot;
type Cond = (s: Snap, mem: Memory) => boolean;
type Text = string | ((s: Snap | null, mem: Memory) => string);

/** Facts remembered across steps (e.g. which hazard we coached the player through). */
interface Memory {
  hazardId?: string;
  hazardType?: string;
}

interface Step {
  id: string;
  title: Text;
  body: Text;
  /** CSS selectors to spotlight. */
  focus?: string[];
  /** Continue button label; without it the step waits for `until`. */
  next?: string;
  until?: Cond;
  /** Freeze the simulation while this card is shown. */
  pause?: boolean;
  /** Fast-forward the simulation (only while the ship is flying). */
  warp?: number;
  position?: "left" | "right" | "center" | "corner";
  /** What the player should do, shown as a highlighted instruction. */
  todo?: Text;
}

const tour = (k: string) => `[data-tour="${k}"]`;
const used = (id: AbilityId): Cond => (s) => (viewerShip(s)?.stats.abilitiesUsed[id] ?? 0) > 0;
const flyingPhase = (s: Snap | null) => {
  const p = s ? viewerShip(s)?.phase : undefined;
  return p === "main-flight" || p === "overtime" || p === "simulation";
};
const onMoon = (s: Snap) => {
  const p = viewerShip(s)?.phase;
  return p === "lunar-task" || p === "task-complete" || s.status === "finished";
};
/** A damaging hazard warning currently shown for our ship. */
function incomingHazard(s: Snap) {
  const ship = viewerShip(s);
  return s.hazards.find((h) => h.shipId === ship?.id && !h.resolved && h.strikesInMs > 600 && h.type !== "nav-anomaly");
}
const ownsCategory = (s: Snap, cat: "propulsion" | "shielding") =>
  (viewerShip(s)?.attachments ?? []).some((a) => ATTACHMENTS[a].category === cat);

const TASK_HELP: Record<LunarTaskId, string> = {
  "surface-analysis":
    "Click each surface region to read its spectrometer values. Select every region that meets BOTH targets (TiO₂ and FeO) listed in the Spectrometer panel, then submit.",
  communications:
    "Drag on the sky dome (or use the sliders and arrows) to swing the antenna beam onto the 🌍 Earth marker. When the signal meter is nearly full, press Lock link.",
  "power-calibration":
    "Set each subsystem's slider: critical systems need full power, the rest need at least their minimum, and the total must stay under the power budget gauge.",
  "orbit-calibration":
    "A burn at periapsis changes the far side (apoapsis); a burn at apoapsis changes periapsis. Adjust both burns until both readouts turn green, then submit.",
  "terrain-mapping":
    "Drag each tile onto the map (or tap a tile, then a cell). Match each tile's elevation to the cell shading, and use the clues to break ties. Fill every cell, then submit.",
};

function buildSteps(): Step[] {
  return [
    // ---------------------------------------------------------------- preparation (you build the ship)
    {
      id: "welcome",
      title: "Welcome, flight director",
      body: "In this guided mission you'll build a spacecraft, launch it, survive a space hazard and finish a science task on the Moon. The game pauses whenever there's something to read.",
      next: "Let's go",
      position: "center",
    },
    {
      id: "budget",
      position: "right",
      title: "Your three constraints",
      body: "You have 1,000 credits. Every part you install costs credits, adds MASS (a heavier ship flies slower) and uses POWER (capped at 60 W unless you add a Solar Array). You can't afford everything — that's the game.",
      focus: [tour("budget")],
      next: "Got it",
    },
    {
      id: "shield",
      position: "right",
      title: "Protect the ship",
      body: "Hazards like micrometeoroids and debris damage your hull. A Whipple Shield blocks impact damage — but it adds mass. Tip: hover over any part to read its real science at the bottom of the list.",
      todo: "Open the Shielding tab and install the Whipple Shield.",
      focus: [tour("tab-shielding"), tour("eq-whipple-shield")],
      until: (s) => {
        const sh = viewerShip(s);
        return !!sh && ownsEquipment(sh, "whipple-shield");
      },
    },
    {
      id: "engine",
      position: "right",
      title: "Add some speed",
      body: "Notice MASS went up and EST. ARRIVAL got later. Propulsion wins that time back: the Solar Sail is light, the Bipropellant Booster is strong but heavy, the Ion Thruster is efficient but power-hungry.",
      todo: "Open Propulsion and install any engine — watch EST. ARRIVAL drop.",
      focus: [tour("tab-propulsion")],
      until: (s) => ownsCategory(s, "propulsion"),
    },
    {
      id: "drone",
      position: "right",
      title: "Bring a repair kit",
      body: "A Repair Drone lets you heal the hull mid-flight. Each repair costs a few more credits than the last.",
      todo: "Open the Repair tab and install the Repair Drone.",
      focus: [tour("tab-repair"), tour("eq-repair-drone")],
      until: (s) => viewerShip(s)?.hasRepairDrone ?? false,
    },
    {
      id: "launch",
      position: "right",
      title: "Keep some credits",
      body: (s) =>
        `You have ${viewerShip(s)?.credits ?? 0} credits left. Unspent credits aren't wasted — they pay for boosts, shields and repairs during the flight.`,
      todo: "Press Launch mission.",
      focus: [tour("launch")],
      until: (s) => s.status !== "preparation",
    },

    // ---------------------------------------------------------------- flight
    {
      id: "countdown",
      title: "Launch sequence",
      body: "Systems check… 3, 2, 1.",
      until: (s) => s.status === "active" && s.elapsedMs > 600,
      position: "center",
    },
    {
      id: "dashboard",
      title: "Your flight dashboard",
      body: "The ship flies the Earth-to-Moon route by itself — your job is to manage it. Top left: HULL (0 means mission lost) and CREDITS. Top centre: the MISSION CLOCK and your ROUTE PROGRESS with speed and ETA.",
      focus: [tour("health"), tour("credits"), tour("clock"), tour("progress")],
      pause: true,
      next: "Resume flight",
    },
    {
      id: "thrust",
      title: "Use a booster",
      body: "Boosters cost credits and then cool down (watch the sweep on the button). Thruster Burn gives +45% speed for 8 seconds.",
      todo: "Press 1 (or click 🚀) for a Thruster Burn.",
      focus: [tour("ability-thruster-burn")],
      until: used("thruster-burn"),
    },
    {
      id: "scan",
      title: "Watch for hazards",
      body: "Space throws hazards at you: solar flares, radiation belts, debris and more. A red warning banner appears a few seconds before each one hits. Keep an eye on the top of the screen…",
      warp: 3,
      until: (s) => !!incomingHazard(s),
    },
    {
      id: "hazard",
      title: (s, m) => `⚠ ${m.hazardType ? HAZARDS[m.hazardType as keyof typeof HAZARDS].name : "Hazard"} incoming!`,
      body: "Game paused. Deflector Surge cuts incoming damage by 60% for 10 seconds — perfect for a warned hit. Your Whipple Shield helps against impacts too.",
      todo: "Press 3 (or click 🔰) for Deflector Surge.",
      focus: [tour("hazard"), tour("ability-deflector-surge")],
      pause: true,
      until: used("deflector-surge"),
    },
    {
      id: "impact",
      title: "Brace for impact…",
      body: "Shields up. Watch your hull.",
      until: (s, m) => !s.hazards.some((h) => h.id === m.hazardId && !h.resolved),
      position: "center",
    },
    {
      id: "debrief",
      title: "Damage report",
      body: (s, m) => {
        const hit = s?.hazards.find((h) => h.id === m.hazardId);
        const dealt = hit?.damageDealt;
        return `${dealt !== undefined ? `The hit did ${dealt} damage. ` : ""}The MISSION LOG on the right records every hit and how much your shields blocked. Without shielding and the surge, that hit would have hurt a lot more.`;
      },
      focus: [tour("log"), tour("health")],
      pause: true,
      next: "Resume flight",
    },
    {
      id: "repair",
      title: "Patch the hull",
      body: (s) => {
        const sh = s ? viewerShip(s) : undefined;
        const full = sh ? sh.health >= sh.maxHealth : false;
        return full
          ? "Your hull is at full health — nice shielding! When it isn't, your Repair Drone heals it over a few seconds. Try it anyway to see how it works."
          : "Your Repair Drone heals the hull over a few seconds. Each repair costs more than the last, and the drone has to cool down.";
      },
      todo: "Press F (or click 🤖) to repair.",
      focus: [tour("repair")],
      // advance once the drone has finished healing, so the player sees it work
      until: (s) => {
        const sh = viewerShip(s);
        return (sh?.repairsUsed ?? 0) > 0 && !sh?.repair;
      },
      next: "Skip",
    },
    {
      id: "clock",
      title: "The race against the clock",
      body: "The main flight is 3:00. Then comes 1:00 of OVERTIME, where abilities cost half but do half as much. After 4:00, autopilot brings any surviving ship to the Moon. The faster you arrive and finish the science, the better your time.",
      focus: [tour("clock")],
      pause: true,
      next: "Fly to the Moon",
    },
    {
      id: "cruise",
      title: "Fast-forwarding to the Moon",
      body: "In a real mission you'd keep managing boosts and hazards the whole way. For the tutorial, we'll skip ahead.",
      warp: 10,
      until: (s) => onMoon(s),
      position: "center",
    },

    // ---------------------------------------------------------------- on the Moon
    {
      id: "task",
      title: (s) => {
        const t = s?.tasks.find((x) => x.instance)?.taskId;
        return t ? `Lunar science: ${t.replace(/-/g, " ")}` : "Lunar science task";
      },
      body: "You've landed! The panel on the left explains the real science behind this task. Attempts are unlimited, but the clock keeps running until you succeed.",
      todo: (s) => {
        const t = s?.tasks.find((x) => x.instance)?.taskId;
        return t ? TASK_HELP[t] : "Solve the task, then submit.";
      },
      until: (s) => s.status === "finished",
      position: "corner",
    },
    {
      id: "done",
      title: "Mission accomplished! 🌕",
      body: (s) => {
        const o = s?.outcome;
        const time = o && "totalMs" in o ? ` in ${formatClock(o.totalMs)}` : "";
        return `You built a ship, survived a hazard and completed lunar science${time}. In a real mission, every choice is yours: try a different loadout and see how your time changes. Online, race a friend in 1v1 or crew a ship together in co-op.`;
      },
      next: "Start a real mission",
      position: "center",
    },
  ];
}

function text(t: Text | undefined, s: Snap | null, mem: Memory): string {
  if (!t) return "";
  return typeof t === "function" ? t(s, mem) : t;
}

export function TutorialOverlay() {
  const steps = useRef(buildSteps()).current;
  const mem = useRef<Memory>({}).current;
  const [idx, setIdx] = useState(0);
  const snap = useGameStore((s) => s.snapshot);
  const step = steps[Math.min(idx, steps.length - 1)];
  const flying = flyingPhase(snap);

  // Spotlight the step's targets (re-applied as the UI mounts/changes).
  useEffect(() => {
    const sel = step.focus ?? [];
    const apply = () => {
      document.querySelectorAll(".tour-focus").forEach((e) => {
        if (!sel.some((q) => e.matches(q))) e.classList.remove("tour-focus");
      });
      for (const q of sel) document.querySelectorAll(q).forEach((e) => e.classList.add("tour-focus"));
    };
    apply();
    const id = window.setInterval(apply, 300);
    return () => {
      window.clearInterval(id);
      document.querySelectorAll(".tour-focus").forEach((e) => e.classList.remove("tour-focus"));
    };
  }, [step]);

  // Pause / fast-forward the local simulation for this step.
  useEffect(() => {
    setTutorialPaused(!!step.pause);
  }, [step]);
  const warp = flying && step.warp ? step.warp : 1;
  useEffect(() => {
    setTutorialTimeScale(warp);
  }, [warp]);
  useEffect(
    () => () => {
      setTutorialPaused(false);
      setTutorialTimeScale(1);
    },
    [],
  );

  // Advance on conditions; keep the script in sync if the sim gets ahead of it.
  useEffect(() => {
    if (!snap) return;
    const at = (id: string) => steps.findIndex((s) => s.id === id);
    if (snap.status === "finished" && idx < at("done")) return void setIdx(at("done"));
    if (onMoon(snap) && snap.status === "active" && idx < at("task")) return void setIdx(at("task"));
    if (step.id === "scan") {
      const h = incomingHazard(snap);
      if (h) {
        mem.hazardId = h.id;
        mem.hazardType = h.type;
        playSfx("warning");
      }
    }
    if (step.until && step.until(snap, mem)) setIdx((i) => i + 1);
  }, [snap, idx, step, steps, mem]);

  const next = () => {
    playSfx("click");
    if (step.id === "done") {
      startSolo();
      return;
    }
    setIdx((i) => Math.min(steps.length - 1, i + 1));
  };

  const pos = step.position ?? "left";
  const todo = text(step.todo, snap, mem);
  const waiting = !step.next && !!step.until;

  return (
    <div className={`tutorial-card tut-v2 pos-${pos === "corner" ? "corner" : pos} ${pos === "corner" ? "compact" : ""}`} key={step.id} role="dialog" aria-label="Tutorial">
      <div className="tut-progress">
        {steps.map((s, i) => (
          <span key={s.id} className={i < idx ? "done" : i === idx ? "on" : ""} />
        ))}
      </div>
      <div className="kicker">
        TUTORIAL · {idx + 1}/{steps.length}
        {step.pause && snap?.status === "active" && <span className="tut-paused">⏸ PAUSED</span>}
      </div>
      <h3>{text(step.title, snap, mem)}</h3>
      {pos !== "corner" && <p>{text(step.body, snap, mem)}</p>}
      {todo && (
        <p className="tut-todo">
          <span aria-hidden="true">👉</span> {todo}
        </p>
      )}
      {warp > 1 && <p className="tut-warp">⏩ Fast-forward ×{warp}</p>}
      <div className="tut-actions">
        {step.id !== "done" ? (
          <button className="btn btn-small btn-ghost" onClick={returnToMenu}>
            Skip tutorial
          </button>
        ) : (
          <button className="btn btn-small btn-ghost" onClick={returnToMenu}>
            Main menu
          </button>
        )}
        {step.next ? (
          <button className="btn btn-small btn-primary" onClick={next}>
            {step.next}
          </button>
        ) : waiting ? (
          <span className="tut-wait">
            <span className="spinner small" /> {todo ? "your move" : "waiting…"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
