import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ABILITIES, BOOSTER_IDS, DETERRENT_IDS, REPAIR, type AbilityId } from "@sm/shared";
import { useGameStore } from "../state/gameStore";
import { abilityHint, opponentShip, purchaseHint, repairHint, viewerShip, type AbilityHint, type RepairHint } from "../state/selectors";
import { commands } from "../network/commands";
import { playSfx } from "../audio/sfx";
import { Ring } from "./ui";

const EMPTY_HINT: AbilityHint = { enabled: false, cost: 0, cooldownMs: 0, cooldownTotalMs: 1 };

function pendingKey(key: string) {
  return (s: ReturnType<typeof useGameStore.getState>) => Object.values(s.pending).some((p) => p.key === key);
}

export function activateAbility(abilityId: AbilityId): boolean {
  const snap = useGameStore.getState().snapshot;
  if (!snap) return false;
  const hint = abilityHint(snap, abilityId);
  if (!hint.enabled) {
    playSfx("error");
    return false;
  }
  const target = ABILITIES[abilityId].kind === "deterrent" ? opponentShip(snap)?.id : undefined;
  playSfx("ability");
  commands.ability(abilityId, target);
  return true;
}

export function activateRepair(): boolean {
  const snap = useGameStore.getState().snapshot;
  if (!snap) return false;
  if (!repairHint(snap).enabled) {
    playSfx("error");
    return false;
  }
  playSfx("ability");
  commands.repair();
  return true;
}

function AbilityButton({ id, flash }: { id: AbilityId; flash: number }) {
  const def = ABILITIES[id];
  const hint = useGameStore(useShallow((s) => (s.snapshot ? abilityHint(s.snapshot, id) : EMPTY_HINT)));
  const pending = useGameStore(pendingKey(`ability:${id}`));
  const overtime = useGameStore((s) => viewerShip(s.snapshot)?.phase === "overtime");
  const cdFrac = hint.cooldownMs > 0 ? Math.min(1, hint.cooldownMs / Math.max(1, hint.cooldownTotalMs)) : 0;
  return (
    <button
      className={`ability ${def.kind} ${hint.enabled ? "ready" : "disabled"} ${pending ? "pending" : ""} ${flash ? "pressed" : ""}`}
      aria-disabled={!hint.enabled}
      aria-label={`${def.name} (${def.hotkey})`}
      data-tour={`ability-${id}`}
      onClick={() => activateAbility(id)}
      key={flash}
    >
      <span className="ability-icon">{def.icon}</span>
      <span className="ability-key">{def.hotkey}</span>
      <span className={`ability-cost ${overtime ? "half" : ""}`}>◈{hint.cost}</span>
      {cdFrac > 0 && (
        <span className="ability-cd" style={{ ["--cd" as string]: `${cdFrac * 360}deg` }}>
          <span className="ability-cd-num">{Math.ceil(hint.cooldownMs / 1000)}</span>
        </span>
      )}
      {pending && <span className="ability-pending" />}
      <span className="tooltip" role="tooltip">
        <strong>
          {def.name} <kbd>{def.hotkey}</kbd>
        </strong>
        <span>{def.short}</span>
        <span className="muted">
          Cost ◈{hint.cost}
          {overtime ? " (overtime ½)" : ""} · Cooldown {def.cooldownMs / 1000}s{def.cooldownGroup ? " (shared stun)" : ""}
        </span>
        {!hint.enabled && hint.reason && <span className="tooltip-reason">⛔ {hint.reason}</span>}
      </span>
    </button>
  );
}

function RepairControl({ flash }: { flash: number }) {
  const hint = useGameStore(
    useShallow(
      (s): RepairHint =>
        s.snapshot
          ? repairHint(s.snapshot)
          : { available: false, enabled: false, cost: 0, cooldownMs: 0, cooldownTotalMs: 1, repairing: false, progress: 0 },
    ),
  );
  const pending = useGameStore(pendingKey("repair"));
  const upPending = useGameStore(pendingKey("buy:repair-upgrade"));
  const upgraded = useGameStore((s) => viewerShip(s.snapshot)?.repairUpgraded ?? false);
  const upHint = useGameStore(useShallow((s) => (s.snapshot ? purchaseHint(s.snapshot, "repair-upgrade") : { owned: false, canBuy: false })));
  if (!hint.available) return null;
  const ring = hint.repairing ? hint.progress : hint.cooldownMs > 0 ? 1 - hint.cooldownMs / Math.max(1, hint.cooldownTotalMs) : 1;
  return (
    <div className="repair-control" data-tour="repair">
      <button
        className={`ability repair ${hint.enabled ? "ready" : "disabled"} ${hint.repairing ? "repairing" : ""} ${pending ? "pending" : ""} ${flash ? "pressed" : ""}`}
        aria-disabled={!hint.enabled}
        aria-label="Repair (F)"
        onClick={() => activateRepair()}
        key={flash}
      >
        <Ring progress={ring} size={60} stroke={3} className={hint.repairing ? "ring-good" : "ring-accent"} />
        <span className="ability-icon">🤖</span>
        <span className="ability-key">F</span>
        <span className="ability-cost">◈{hint.cost}</span>
        {hint.cooldownMs > 0 && !hint.repairing && (
          <span className="ability-cd-num solo">{Math.ceil(hint.cooldownMs / 1000)}</span>
        )}
        <span className="tooltip" role="tooltip">
          <strong>
            Repair Drone <kbd>F</kbd>
          </strong>
          <span>
            Heal {upgraded ? REPAIR.upgraded.heal : REPAIR.base.heal} HP over {(upgraded ? REPAIR.upgraded.durationMs : REPAIR.base.durationMs) / 1000}s. Each repair costs
            more.
          </span>
          {hint.repairing && <span className="good">Repairing… {Math.round(hint.progress * 100)}%</span>}
          {!hint.enabled && hint.reason && !hint.repairing && <span className="tooltip-reason">⛔ {hint.reason}</span>}
        </span>
      </button>
      {!upgraded && (
        <button
          className="btn btn-small btn-upgrade"
          disabled={!upHint.canBuy || upPending}
          title={upHint.reason ?? `Faster, stronger repairs (◈${REPAIR.upgrade.cost})`}
          onClick={() => {
            playSfx("purchase");
            commands.buy("repair-upgrade");
          }}
        >
          {upPending ? "…" : `⬆ Upgrade ◈${REPAIR.upgrade.cost}`}
        </button>
      )}
    </div>
  );
}

const KEYMAP: Record<string, AbilityId | "repair"> = (() => {
  const m: Record<string, AbilityId | "repair"> = { f: "repair" };
  for (const id of [...BOOSTER_IDS, ...DETERRENT_IDS]) m[ABILITIES[id].hotkey.toLowerCase()] = id;
  return m;
})();

/** Global flight hotkeys: 1-5 boosters, Q W E R T deterrents, F repair. Returns press counters for visual feedback. */
function useHotkeys(): Record<string, number> {
  const [presses, setPresses] = useState<Record<string, number>>({});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const action = KEYMAP[e.key.toLowerCase()];
      if (!action) return;
      const snap = useGameStore.getState().snapshot;
      if (!snap || snap.mode !== "1v1") {
        if (action !== "repair" && ABILITIES[action].kind === "deterrent") return;
      }
      e.preventDefault();
      if (action === "repair") activateRepair();
      else activateAbility(action);
      setPresses((p) => ({ ...p, [action]: (p[action] ?? 0) + 1 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return presses;
}

export function AbilityPanel() {
  const mode = useGameStore((s) => s.snapshot?.mode);
  const presses = useHotkeys();
  return (
    <div className="ability-panel">
      <div className="ability-group" data-tour="boosters">
        <span className="group-label">BOOSTERS</span>
        <div className="ability-row">
          {BOOSTER_IDS.map((id) => (
            <AbilityButton key={id} id={id} flash={presses[id] ?? 0} />
          ))}
        </div>
      </div>
      {mode === "1v1" && (
        <div className="ability-group deterrents" data-tour="deterrents">
          <span className="group-label">DETERRENTS</span>
          <div className="ability-row">
            {DETERRENT_IDS.map((id) => (
              <AbilityButton key={id} id={id} flash={presses[id] ?? 0} />
            ))}
          </div>
        </div>
      )}
      <RepairControl flash={presses.repair ?? 0} />
    </div>
  );
}
