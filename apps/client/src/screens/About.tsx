import { NASA_SOURCES } from "@sm/shared";
import { Modal } from "../hud/ui";

export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="📚 About LUNAR TRANSIT" onClose={onClose} wide>
      <p>
        <b>LUNAR TRANSIT</b> is an educational browser race from Earth to the Moon. Configure a spacecraft within a mass, power and credit budget, survive hazards
        on the translunar route, and complete a lunar science task on arrival — solo, head-to-head, or as a two-person crew.
      </p>
      <div className="notice">
        <b>About the numbers:</b> attachment stats, ability costs, hazard damage, speeds and timings are <i>game-balance values</i>, not NASA data. The route is a
        stylised visualization of a translunar transfer and is not to scale. Concepts and explanations are inspired by NASA public education and mission-design
        resources listed below. This project is not affiliated with or endorsed by NASA.
      </div>
      <h3>Sources</h3>
      {NASA_SOURCES.length === 0 ? (
        <p className="muted">Source list unavailable in this build.</p>
      ) : (
        <ul className="sources">
          {NASA_SOURCES.map((s) => (
            <li key={s.id}>
              <span className="src-type">{s.sourceType.toUpperCase()}</span>
              {s.officialUrl ? (
                <a href={s.officialUrl} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
              ) : (
                <span>{s.title}</span>
              )}
              {s.version && <span className="muted small"> · {s.version}</span>}
              {s.accessedOn && <span className="muted small"> · accessed {s.accessedOn}</span>}
            </li>
          ))}
        </ul>
      )}
      <h3>Controls</h3>
      <div className="controls-grid">
        <span>
          <kbd>1</kbd>–<kbd>5</kbd> Boosters
        </span>
        <span>
          <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>T</kbd> Deterrents (1v1)
        </span>
        <span>
          <kbd>F</kbd> Repair drone
        </span>
        <span>
          <kbd>Esc</kbd> Close dialogs
        </span>
      </div>
    </Modal>
  );
}
