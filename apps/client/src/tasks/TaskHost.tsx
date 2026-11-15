import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LUNAR_TASKS, NASA_SOURCES } from "@sm/shared";
import type { PublicTaskInstance, TaskSubmission } from "@sm/shared";
import { cssVars, seededRandom } from "./taskTypes";
import "./tasks.css";

// Each minigame is code-split so only the assigned task is downloaded.
const SurfaceTask = lazy(() => import("./SurfaceTask").then((m) => ({ default: m.SurfaceTask })));
const CommsTask = lazy(() => import("./CommsTask").then((m) => ({ default: m.CommsTask })));
const PowerTask = lazy(() => import("./PowerTask").then((m) => ({ default: m.PowerTask })));
const OrbitTask = lazy(() => import("./OrbitTask").then((m) => ({ default: m.OrbitTask })));
const TerrainTask = lazy(() => import("./TerrainTask").then((m) => ({ default: m.TerrainTask })));

export interface TaskHostProps {
  task: PublicTaskInstance;
  attempts: number;
  completed: boolean;
  waitingFor?: string;
  onSubmit: (s: TaskSubmission) => void;
}

const SUBMIT_LABEL: Record<PublicTaskInstance["taskId"], string> = {
  "surface-analysis": "Submit Analysis",
  communications: "Lock Link",
  "power-calibration": "Apply Power Plan",
  "orbit-calibration": "Execute Burns",
  "terrain-mapping": "Submit Map",
};

/** Stable key for an instance so child state resets when a new task arrives. */
function instanceKey(task: PublicTaskInstance): string {
  const json = JSON.stringify(task);
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 31) + json.charCodeAt(i)) | 0;
  return `${task.taskId}:${(h >>> 0).toString(36)}`;
}

/** Accepts either a full message ("Waiting for your Engineer…") or just a name ("Ada"). */
function waitingMessage(w: string): string {
  return /^waiting\b/i.test(w.trim()) ? w : `Waiting for ${w} to finish their task…`;
}

function TaskBody(props: { task: PublicTaskInstance; onChange: (s: TaskSubmission | null) => void }) {
  const { task, onChange } = props;
  switch (task.taskId) {
    case "surface-analysis":
      return <SurfaceTask task={task} onChange={onChange} />;
    case "communications":
      return <CommsTask task={task} onChange={onChange} />;
    case "power-calibration":
      return <PowerTask task={task} onChange={onChange} />;
    case "orbit-calibration":
      return <OrbitTask task={task} onChange={onChange} />;
    case "terrain-mapping":
      return <TerrainTask task={task} onChange={onChange} />;
  }
}

function Celebration() {
  const pieces = useMemo(() => {
    const rnd = seededRandom("celebrate");
    const colors = ["var(--good, #3ddc97)", "var(--accent, #4fc3ff)", "var(--warn, #ffc24b)", "var(--accent-2, #ff6b3d)", "#ffffff"];
    return Array.from({ length: 36 }, (_, i) => {
      const angle = (i / 36) * Math.PI * 2 + rnd() * 0.3;
      const dist = 120 + rnd() * 160;
      return {
        i,
        style: cssVars({
          "--dx": `${Math.cos(angle) * dist}px`,
          "--dy": `${Math.sin(angle) * dist}px`,
          "--rot": `${Math.round(rnd() * 720 - 360)}deg`,
          "--delay": `${Math.round(rnd() * 180)}ms`,
          "--c": colors[i % colors.length],
        }),
      };
    });
  }, []);
  return (
    <div className="task-celebrate" aria-hidden="true">
      <div className="task-celebrate-ring" />
      <div className="task-celebrate-ring task-celebrate-ring--late" />
      {pieces.map((p) => (
        <span key={p.i} className="task-confetti" style={p.style} />
      ))}
    </div>
  );
}

export function TaskHost(props: TaskHostProps) {
  const { task, attempts, completed, waitingFor, onSubmit } = props;
  const def = LUNAR_TASKS[task.taskId];
  const [submission, setSubmission] = useState<TaskSubmission | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const prevAttempts = useRef(attempts);
  const key = instanceKey(task);

  // Reset local UI state whenever a different task instance is shown.
  useEffect(() => {
    setSubmission(null);
    setPending(false);
    setFailed(false);
    setHintOpen(false);
  }, [key]);

  // A rise in attempts while not completed means the server rejected our submission.
  useEffect(() => {
    if (attempts > prevAttempts.current && !completed) {
      setFailed(true);
      setShaking(true);
    }
    prevAttempts.current = attempts;
    setPending(false);
  }, [attempts, completed]);

  useEffect(() => {
    if (completed) {
      setPending(false);
      setFailed(false);
    }
  }, [completed]);

  useEffect(() => {
    if (!shaking) return;
    const t = window.setTimeout(() => setShaking(false), 650);
    return () => window.clearTimeout(t);
  }, [shaking]);

  // Safety net: never leave the button stuck in "validating" if no response arrives.
  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setPending(false), 5000);
    return () => window.clearTimeout(t);
  }, [pending]);

  const handleChange = useCallback((s: TaskSubmission | null) => {
    setSubmission(s);
    setFailed(false);
  }, []);

  const submit = () => {
    if (!submission || pending || completed) return;
    setPending(true);
    onSubmit(submission);
  };

  const panelClass = ["task-host", failed ? "task-host--failed" : "", shaking ? "task-host--shake" : "", completed ? "task-host--done" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="task-overlay" role="region" aria-labelledby="task-title">
      <div className="task-layout">
      <ScienceSidebar taskId={task.taskId} />
      <section className={panelClass}>
        <header className="task-header">
          <div className="task-icon" aria-hidden="true">
            {def.icon}
          </div>
          <div className="task-heading">
            <p className="task-kicker">Lunar Task</p>
            <h2 id="task-title" className="task-title">
              {def.title}
            </h2>
          </div>
          <div className="task-attempts" title="Failed validation attempts">
            <span className="task-attempts-label">Attempts</span>
            <span className="task-attempts-value">{attempts}</span>
          </div>
        </header>

        <p className="task-instructions">{def.instructions}</p>

        {task.hint !== undefined && (
          <div className="task-info-row">
            <button
              type="button"
              className={`task-chip task-chip--hint${hintOpen ? " task-chip--active" : ""}`}
              aria-expanded={hintOpen}
              onClick={() => setHintOpen((o) => !o)}
            >
              <span aria-hidden="true">💡</span> {hintOpen ? "Hide hint" : "Hint"}
            </button>
          </div>
        )}
        {hintOpen && task.hint !== undefined && <p className="task-hint">{task.hint}</p>}

        <div className={`task-body${completed ? " task-body--locked" : ""}`} aria-disabled={completed}>
          <Suspense fallback={<div className="task-loading">Booting instrument…</div>}>
            <TaskBody key={key} task={task} onChange={handleChange} />
          </Suspense>
        </div>

        <footer className="task-footer">
          <div className="task-status" role="status" aria-live="polite">
            {completed ? (
              <span className="task-status-good">✔ Task complete{waitingFor ? "" : "!"}</span>
            ) : failed ? (
              <span className="task-status-bad">✖ Validation failed — try again</span>
            ) : pending ? (
              <span className="task-status-pending">Transmitting to mission control…</span>
            ) : submission ? (
              <span className="task-status-ready">Ready to submit</span>
            ) : (
              <span className="task-status-muted">Complete the task to enable submission</span>
            )}
          </div>
          <button
            type="button"
            className="task-submit"
            disabled={!submission || pending || completed}
            onClick={submit}
          >
            {pending ? "Validating…" : SUBMIT_LABEL[task.taskId]}
          </button>
        </footer>

        {completed && (
          <div className="task-success">
            <Celebration />
            <div className="task-success-card">
              <div className="task-success-badge" aria-hidden="true">
                ✔
              </div>
              <h3 className="task-success-title">Mission objective complete</h3>
              <p className="task-success-text">{def.title} validated by mission control.</p>
              {waitingFor && (
                <p className="task-success-waiting">
                  <span className="task-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {waitingMessage(waitingFor)}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

/** Always-visible explanation of the real science behind the current task, with its NASA sources. */
function ScienceSidebar(props: { taskId: PublicTaskInstance["taskId"] }) {
  const def = LUNAR_TASKS[props.taskId];
  const sources = def.sourceIds
    .map((id) => NASA_SOURCES.find((s) => s.id === id))
    .filter((s): s is (typeof NASA_SOURCES)[number] => s !== undefined);
  return (
    <aside className="task-science-panel" aria-label="The science behind this task">
      <p className="task-science-kicker">
        <span aria-hidden="true">🧪</span> The science
      </p>
      <h3 className="task-science-title">{def.title}</h3>
      <p className="task-science-text">{def.scienceExplanation}</p>
      {sources.length > 0 && (
        <div className="task-science-sources">
          <p className="task-science-sources-label">Based on NASA resources</p>
          <ul>
            {sources.map((s) => (
              <li key={s.id}>
                {s.officialUrl ? (
                  <a href={s.officialUrl} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

export default TaskHost;
