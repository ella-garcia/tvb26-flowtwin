// Scenario controls shared by the risk board and the What-if page (state lives in AppContext, per company).
import { useApp } from "../../app/AppContext";
import { Button, FilterChip } from "../../keystone";
import "./optimization.css";

const HORIZONS = [2, 4, 12];

export function ScenarioControls({ onAll, compact }: { onAll?: (all: boolean) => void; compact?: boolean }) {
  const { scenario, setScenario } = useApp();
  return (
    <div className="opt-controls">
      {!compact && (
        <div className="ft-toolbar" role="group" aria-label="Time horizon">
          <span className="opt-label">Horizon</span>
          {HORIZONS.map((h) => <FilterChip key={h} pressed={scenario.weeks === h} onClick={() => setScenario({ weeks: h, overrides: {} })}>{`${h} weeks`}</FilterChip>)}
        </div>
      )}
      <label className="opt-slider" htmlFor={compact ? "opt-share-board" : "opt-share"}>
        <span className="opt-label">Suppliers that adopt their recommended optimizations</span>
        <input id={compact ? "opt-share-board" : "opt-share"} type="range" min={0} max={100} step={10} value={Math.round(scenario.share * 100)}
          onChange={(e) => setScenario({ share: Number(e.target.value) / 100, overrides: {} })} />
        <b className="ks-num">{Math.round(scenario.share * 100)}%</b>
      </label>
      <div className="ft-toolbar">
        <Button variant="primary" icon="sync" onClick={() => setScenario({ seed: scenario.seed + 1, overrides: {} })}>Randomize optimizations</Button>
        {onAll && <Button variant="secondary" onClick={() => onAll(true)}>All adopt</Button>}
        {onAll && <Button variant="secondary" onClick={() => onAll(false)}>None adopt</Button>}
      </div>
    </div>
  );
}
