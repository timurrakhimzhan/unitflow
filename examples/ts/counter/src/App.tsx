import { View } from "@unitflow/react";
import { CounterModel } from "./model";

export const CounterApp = View.make(CounterModel, (unit) => {
  const { count, doubled, parity, step } = unit.view;

  return (
    <main className="counter-shell">
      <section className="counter-panel">
        <div className="counter-display">
          <span className="counter-kicker">Counter</span>
          <strong>{count}</strong>
          <span>{parity} / doubled {doubled}</span>
        </div>

        <div className="counter-actions" aria-label="Counter actions">
          <button type="button" onClick={() => unit.decrement()}>
            -{step}
          </button>
          <button type="button" onClick={() => unit.reset()}>
            Reset
          </button>
          <button type="button" onClick={() => unit.increment()}>
            +{step}
          </button>
        </div>

        <label className="step-control">
          <span>Step</span>
          <input
            min={1}
            max={12}
            type="range"
            value={step}
            onChange={(event) => unit.setStep(Number(event.currentTarget.value))}
          />
          <output>{step}</output>
        </label>
      </section>
    </main>
  );
});
