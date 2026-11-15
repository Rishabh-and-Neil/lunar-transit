// First-visit welcome popup offering the guided tutorial. Shown once per browser.
import { useState } from "react";
import { Modal } from "../hud/ui";
import { startTutorial } from "../network/session";
import { playSfx } from "../audio/sfx";

const WELCOMED_KEY = "lt.welcomed.v1";

function hasBeenWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === "1";
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}

function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOMED_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Renders the welcome popup on a visitor's first ever visit; nothing afterwards. */
export function FirstVisitWelcome() {
  const [open, setOpen] = useState(() => !hasBeenWelcomed());
  if (!open) return null;

  const dismiss = () => {
    markWelcomed();
    setOpen(false);
  };
  const takeTutorial = () => {
    playSfx("click");
    dismiss();
    startTutorial();
  };

  return (
    <Modal title="Welcome, cadet" onClose={dismiss}>
      <div className="welcome">
        <p className="welcome-lede">
          Your mission: design a spacecraft on a budget, fly it from Earth to the Moon, and complete a science task when you land.
        </p>
        <p className="muted">
          New here? The guided tutorial walks you through equipment, the flight controls, hazards and the lunar task in about 60 seconds.
        </p>
        <div className="welcome-actions">
          <button className="btn btn-primary" onClick={takeTutorial} autoFocus>
            Start the tutorial
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              playSfx("click");
              dismiss();
            }}
          >
            Skip for now
          </button>
        </div>
        <p className="muted small">You can open the tutorial any time from the main menu.</p>
      </div>
    </Modal>
  );
}
