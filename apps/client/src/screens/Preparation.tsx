import { useState } from "react";
import {
  ATTACHMENTS,
  ATTACHMENT_CATEGORIES,
  ATTACHMENT_EDUCATION,
  NASA_SOURCES,
  REPAIR,
  SPACECRAFT,
  type AttachmentCategory,
  type AttachmentId,
  type EquipmentId,
} from "@sm/shared";
import { useShallow } from "zustand/react/shallow";
import { ShipPreview } from "../scene/ShipPreview";
import { useGameStore } from "../state/gameStore";
import {
  equipmentCost,
  equipmentMass,
  equipmentPower,
  estimateArrivalMs,
  estimateSpeed,
  formatClock,
  purchaseHint,
  type PurchaseHint,
  viewerPlayer,
  viewerShip,
} from "../state/selectors";
import { commands } from "../network/commands";
import { returnToMenu, setSoloDifficulty } from "../network/session";
import { playSfx } from "../audio/sfx";
import { Credits, Meter } from "../hud/ui";
import { useAnimatedNumber } from "../hud/hooks";
import { DifficultyPicker, ROLE_INFO } from "./Lobby";

type Tab = AttachmentCategory | "repair";

const TAB_META: Record<Tab, { label: string; icon: string; blurb: string }> = {
  shielding: { label: "Shielding", icon: "🛡️", blurb: "Reduce damage from impacts, radiation and heat." },
  propulsion: { label: "Propulsion", icon: "🔥", blurb: "Thrust bonuses multiply — but mass slows you down." },
  instruments: { label: "Instruments", icon: "📡", blurb: "Power, warnings, income and task hints." },
  repair: { label: "Repair", icon: "🛠️", blurb: "A drone that heals the hull mid-flight." },
};

const NO_HINT: PurchaseHint = { owned: false, canBuy: false };

function isPending(key: string) {
  return (s: ReturnType<typeof useGameStore.getState>) => Object.values(s.pending).some((p) => p.key === key);
}

function attachmentEffects(id: AttachmentId): string[] {
  const a = ATTACHMENTS[id];
  const out: string[] = [];
  if (a.thrustBonus) out.push(`Thrust ×${(1 + a.thrustBonus).toFixed(2)}`);
  if (a.damageReduction)
    for (const [k, v] of Object.entries(a.damageReduction)) if (v) out.push(`−${Math.round(v * 100)}% ${k}`);
  if (a.slowResistance) out.push(`−${Math.round(a.slowResistance * 100)}% slows`);
  if (a.powerCapacityBonus) out.push(`+${a.powerCapacityBonus} power cap`);
  if (a.creditIncomePerSec) out.push(`+${a.creditIncomePerSec} ◈/s`);
  if (a.hazardWarningBonusMs) out.push(`+${a.hazardWarningBonusMs / 1000}s warning`);
  if (a.taskHint) out.push("Task hint");
  return out;
}

function sourceTitle(id: string): string {
  return NASA_SOURCES.find((s) => s.id === id)?.title ?? id;
}

function EquipmentCard(props: {
  id: EquipmentId;
  name: string;
  icon: string;
  short: string;
  effects: string[];
  educationKey?: AttachmentId | "repair-drone";
}) {
  const { id } = props;
  const hint = useGameStore(useShallow((s) => (s.snapshot ? purchaseHint(s.snapshot, id) : NO_HINT)));
  const buying = useGameStore(isPending(`buy:${id}`));
  const selling = useGameStore(isPending(`sell:${id}`));
  const ready = useGameStore((s) => viewerPlayer(s.snapshot)?.ready ?? false);
  const [open, setOpen] = useState(false);
  const edu = props.educationKey ? ATTACHMENT_EDUCATION.find((e) => e.attachmentId === props.educationKey) : undefined;
  if (hint === NO_HINT) return null;
  const owned = hint.owned;
  const busy = buying || selling;
  const cost = equipmentCost(id);
  const power = equipmentPower(id);
  const mass = equipmentMass(id);
  const sellBlocked = id === "repair-drone" && useGameStore.getState().snapshot?.spacecraft.some((s) => s.repairUpgraded);

  return (
    <div className={`eq-card ${owned ? "owned" : ""} ${!owned && !hint.canBuy ? "locked" : ""} ${open ? "open" : ""}`}>
      <div className="eq-top">
        <span className="eq-icon">{props.icon}</span>
        <div className="eq-title">
          <strong>{props.name}</strong>
          <span className="eq-short">{props.short}</span>
        </div>
        <Credits value={cost} className="eq-cost" />
      </div>
      <div className="eq-specs">
        <span title="Mass">⚖ {mass}</span>
        <span title="Power draw" className={power > 0 ? "" : "muted"}>
          ⚡ {power}
        </span>
        {props.effects.map((e) => (
          <span key={e} className="eq-chip">
            {e}
          </span>
        ))}
      </div>
      {edu && (
        <button className="eq-learn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "▾ Hide science" : "▸ The real science"}
        </button>
      )}
      {edu && open && (
        <div className="eq-edu">
          <p>{edu.explanation}</p>
          <p>
            <b>Principle:</b> {edu.realWorldPrinciple}
          </p>
          <p className="muted">
            <b>In game:</b> {edu.gameplayAbstraction}
          </p>
          {edu.sourceIds.length > 0 && <p className="eq-src">Source: {edu.sourceIds.map(sourceTitle).join(" · ")}</p>}
        </div>
      )}
      <div className="eq-actions">
        {owned ? (
          <>
            <span className="owned-badge">✓ Installed</span>
            <button
              className="btn btn-small btn-ghost"
              disabled={busy || ready || !!sellBlocked}
              title={sellBlocked ? "Sell the Repair Upgrade first" : ready ? "Un-ready to change equipment" : "Full refund"}
              onClick={() => {
                playSfx("sell");
                commands.sell(id);
              }}
            >
              {selling ? "…" : "Sell"}
            </button>
          </>
        ) : (
          <button
            className="btn btn-small btn-primary"
            disabled={!hint.canBuy || busy}
            title={hint.reason}
            onClick={() => {
              playSfx("purchase");
              commands.buy(id);
            }}
          >
            {buying ? "Installing…" : hint.canBuy ? "Install" : hint.reason ?? "Unavailable"}
          </button>
        )}
      </div>
    </div>
  );
}

function ShopTab({ tab }: { tab: Tab }) {
  if (tab === "repair") {
    return (
      <div className="eq-grid">
        <EquipmentCard
          id="repair-drone"
          name="Repair Drone"
          icon="🤖"
          short={`Heal ${REPAIR.base.heal} HP over ${REPAIR.base.durationMs / 1000}s · cooldown ${REPAIR.base.cooldownMs / 1000}s`}
          effects={[`Repairs cost ${REPAIR.baseCost}, ${REPAIR.baseCost + REPAIR.costStep}, ${REPAIR.baseCost + 2 * REPAIR.costStep}…`]}
          educationKey="repair-drone"
        />
        <EquipmentCard
          id="repair-upgrade"
          name="Repair Upgrade"
          icon="⚙️"
          short={`Heal ${REPAIR.upgraded.heal} HP in ${REPAIR.upgraded.durationMs / 1000}s · cooldown ${REPAIR.upgraded.cooldownMs / 1000}s`}
          effects={["Also purchasable in flight"]}
        />
      </div>
    );
  }
  const ids = (Object.keys(ATTACHMENTS) as AttachmentId[]).filter((id) => ATTACHMENTS[id].category === tab);
  return (
    <div className="eq-grid">
      {ids.map((id) => {
        const a = ATTACHMENTS[id];
        return <EquipmentCard key={id} id={id} name={a.name} icon={a.icon} short={a.short} effects={attachmentEffects(id)} educationKey={id} />;
      })}
    </div>
  );
}

function ShipStatsPanel() {
  const ship = useGameStore((s) => viewerShip(s.snapshot));
  const credits = useAnimatedNumber(ship?.credits ?? 0);
  if (!ship) return null;
  const d = ship.derived;
  const speed = estimateSpeed(d.thrustMultiplier, d.mass);
  const arrival = estimateArrivalMs(speed);
  const baseArrival = estimateArrivalMs(estimateSpeed(1, SPACECRAFT.baseMass));
  const delta = arrival - baseArrival;
  const overPower = d.powerUsed > d.powerCapacity;
  const reductions = (["impact", "radiation", "thermal"] as const).map((k) => ({ k, v: d.damageReduction[k] ?? 0 }));
  return (
    <div className="ship-stats">
      <Meter
        label="Budget"
        value={ship.credits}
        max={SPACECRAFT.startingCredits}
        display={<Credits value={credits} />}
        tone={ship.credits < 150 ? "warn" : "good"}
        hint="Unspent credits carry into flight for abilities and repairs."
      />
      <Meter label="Mass" value={d.mass} max={260} display={`${Math.round(d.mass)} u`} tone={d.mass > 170 ? "orange" : "accent"} hint="Heavier ships fly slower." />
      <Meter
        label="Power"
        value={d.powerUsed}
        max={d.powerCapacity}
        display={`${Math.round(d.powerUsed)} / ${Math.round(d.powerCapacity)} W`}
        overflow={overPower}
        tone={d.powerUsed / Math.max(1, d.powerCapacity) > 0.85 ? "warn" : "accent"}
      />
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-label">Cruise speed</span>
          <span className="stat-value">{speed.toFixed(2)}</span>
          <span className="stat-sub">units/s · thrust ×{d.thrustMultiplier.toFixed(2)}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Est. arrival</span>
          <span className="stat-value">{formatClock(arrival)}</span>
          <span className={`stat-sub ${delta < -500 ? "good" : delta > 500 ? "bad" : ""}`}>
            {Math.abs(delta) < 500 ? "baseline" : `${delta < 0 ? "−" : "+"}${formatClock(Math.abs(delta))} vs. bare hull`}
          </span>
        </div>
      </div>
      <div className="shield-row">
        {reductions.map(({ k, v }) => (
          <span key={k} className={`shield-chip ${v > 0 ? "on" : ""}`}>
            {k === "impact" ? "💥" : k === "radiation" ? "☢️" : "🌡️"} {Math.round(v * 100)}%
          </span>
        ))}
        {d.slowResistance > 0 && <span className="shield-chip on">💨 {Math.round(d.slowResistance * 100)}%</span>}
        {d.creditIncomePerSec > 0 && <span className="shield-chip on">◈ +{d.creditIncomePerSec}/s</span>}
        {d.hazardWarningBonusMs > 0 && <span className="shield-chip on">✨ +{d.hazardWarningBonusMs / 1000}s</span>}
        {d.taskHint && <span className="shield-chip on">🔬 hint</span>}
      </div>
      <p className="muted small">Estimates use base cruise speed only; abilities, hazards and the clock decide the real race.</p>
    </div>
  );
}

function ReadyPanel() {
  const snap = useGameStore((s) => s.snapshot);
  const readyPending = useGameStore(isPending("ready"));
  if (!snap) return null;
  const me = viewerPlayer(snap);
  const multi = snap.mode !== "solo";
  return (
    <div className="ready-panel">
      {multi && (
        <div className="ready-list">
          {snap.players.map((p) => (
            <div key={p.id} className={`ready-row ${p.ready ? "is-ready" : ""}`}>
              <span>{ROLE_INFO[p.role].icon}</span>
              <span className="ready-name">
                {p.name}
                {p.id === snap.viewerId && <span className="tag">YOU</span>}
              </span>
              <span className="muted small">{ROLE_INFO[p.role].label}</span>
              {!p.connected && <span className="tag tag-bad">offline</span>}
              <span className="ready-state">{p.ready ? "READY" : "…"}</span>
            </div>
          ))}
        </div>
      )}
      <button
        className={`btn btn-xl ${me?.ready ? "btn-ghost" : "btn-go"}`}
        disabled={readyPending || !me}
        onClick={() => {
          playSfx(me?.ready ? "click" : "purchase");
          commands.ready(!me?.ready);
        }}
      >
        {readyPending ? "Transmitting…" : me?.ready ? (multi ? "Waiting for crew · Cancel ready" : "Cancel") : multi ? "Ready for launch" : "Launch mission"}
      </button>
    </div>
  );
}

export function Preparation() {
  const [tab, setTab] = useState<Tab>("propulsion");
  const mode = useGameStore((s) => s.snapshot?.mode ?? "solo");
  const difficulty = useGameStore((s) => s.snapshot?.difficulty ?? "normal");
  const tutorial = useGameStore((s) => s.snapshot?.tutorial ?? false);
  const attachments = useGameStore((s) => viewerShip(s.snapshot)?.attachments);
  const hasDrone = useGameStore((s) => viewerShip(s.snapshot)?.hasRepairDrone ?? false);
  const upgraded = useGameStore((s) => viewerShip(s.snapshot)?.repairUpgraded ?? false);
  const meReady = useGameStore((s) => viewerPlayer(s.snapshot)?.ready ?? false);
  const role = useGameStore((s) => viewerPlayer(s.snapshot)?.role);

  return (
    <div className="prep">
      <header className="prep-head">
        <button className="icon-btn" aria-label="Abort to menu" onClick={returnToMenu}>
          ←
        </button>
        <div>
          <div className="kicker">PRE-LAUNCH · {mode === "1v1" ? "ONLINE 1v1" : mode === "coop" ? "CO-OP" : tutorial ? "TUTORIAL" : "SOLO"}</div>
          <h2>Configure your spacecraft</h2>
        </div>
        <div className="prep-head-right">
          {mode === "solo" && !tutorial ? (
            <DifficultyPicker value={difficulty} disabled={meReady} onChange={setSoloDifficulty} />
          ) : (
            <span className={`diff-badge diff-${difficulty}`}>{difficulty.toUpperCase()}</span>
          )}
        </div>
      </header>
      {mode === "coop" && role && (
        <div className="coop-banner">
          {ROLE_INFO[role].icon} You are the <b>{ROLE_INFO[role].label}</b> — shared ship &amp; shared budget. Every purchase your partner makes shows up here
          instantly.
        </div>
      )}

      <div className="prep-body">
        <section className="panel prep-shop" data-tour="shop">
          <nav className="tabs" role="tablist">
            {(["shielding", "propulsion", "instruments", "repair"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`tab ${tab === t ? "tab-on" : ""}`}
                onClick={() => {
                  playSfx("click");
                  setTab(t);
                }}
              >
                <span>{TAB_META[t].icon}</span> {TAB_META[t].label}
              </button>
            ))}
          </nav>
          <p className="tab-blurb muted">{TAB_META[tab].blurb}</p>
          <div className="prep-shop-scroll">
            <ShopTab tab={tab} />
          </div>
          <p className="muted small">
            {ATTACHMENT_CATEGORIES.length * 4} attachments · selling during preparation refunds in full · base power capacity {SPACECRAFT.basePowerCapacity} W
          </p>
        </section>

        <section className="panel prep-ship" data-tour="budget">
          <div className="ship-preview-box">
            <ShipPreview attachments={attachments ?? []} hasRepairDrone={hasDrone} repairUpgraded={upgraded} />
            <div className="preview-label">LIVE CONFIGURATION</div>
          </div>
          <ShipStatsPanel />
          <ReadyPanel />
        </section>
      </div>
    </div>
  );
}
