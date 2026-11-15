import { useState } from "react";
import { ATTACHMENTS, DIFFICULTY, type Difficulty } from "@sm/shared";
import { bestKey, clearPersonalBests, loadPersonalBests, type BestMode } from "../state/personalBests";
import { formatClock } from "../state/selectors";
import { Modal } from "../hud/ui";

const MODES: { id: BestMode; label: string; icon: string }[] = [
  { id: "solo", label: "Solo Mission", icon: "🚀" },
  { id: "coop", label: "Co-op Mission", icon: "🤝" },
];

export function PersonalBestsModal({ onClose }: { onClose: () => void }) {
  const [table, setTable] = useState(loadPersonalBests);
  const [confirm, setConfirm] = useState(false);
  const any = Object.keys(table).length > 0;
  return (
    <Modal title="🏆 Personal Bests" onClose={onClose} wide>
      <p className="muted">Fastest validated mission times (launch → lunar task complete), stored on this device.</p>
      {MODES.map((m) => (
        <div key={m.id} className="pb-mode">
          <h3>
            {m.icon} {m.label}
          </h3>
          <div className="pb-grid">
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => {
              const r = table[bestKey(m.id, d)];
              return (
                <div key={d} className={`pb-cell ${r ? "has" : ""}`}>
                  <span className={`diff-badge diff-${d}`}>{DIFFICULTY[d].label}</span>
                  {r ? (
                    <>
                      <span className="pb-time">{formatClock(r.totalMs, true)}</span>
                      <span className="muted small">{new Date(r.date).toLocaleDateString()}</span>
                      <span className="small">
                        {r.damageTaken} dmg · ◈{r.creditsSpent} spent · {r.abilitiesUsed} abilities · {r.taskAttempts} task tries
                      </span>
                      {r.attachments.length > 0 && (
                        <span className="pb-loadout" title={r.attachments.map((a) => ATTACHMENTS[a]?.name ?? a).join(", ")}>
                          {r.attachments.map((a) => ATTACHMENTS[a]?.icon ?? "•").join(" ")}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="pb-empty">No record yet</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {any && (
        <div className="row end">
          <button
            className={`btn btn-small ${confirm ? "btn-danger" : "btn-ghost"}`}
            onClick={() => {
              if (!confirm) return setConfirm(true);
              clearPersonalBests();
              setTable({});
              setConfirm(false);
            }}
          >
            {confirm ? "Really erase all records?" : "Reset records"}
          </button>
        </div>
      )}
    </Modal>
  );
}
