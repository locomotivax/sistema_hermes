import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export async function run({
  defaultScenario,
  simulate,
  validateScenario,
  populationAt,
  resultCsv,
}) {
  const modes = ["car", "moto", "bus", "bike", "walk", "other"];
  const p = {
    k: 5,
    rate: 2,
    shares: {
      car: 0.4,
      moto: 0.1,
      bus: 0.3,
      bike: 0.05,
      walk: 0.1,
      other: 0.05,
    },
    hourly: Object.fromEntries(modes.map((m) => [m, Array(24).fill(1 / 24)])),
    occupancy: { car: 1.5, moto: 1.1 },
    comparables: [],
  };
  const routing = Object.fromEntries(modes.map((m) => [m, { rio: 0.25 }]));
  const b = {
    manifest: {
      schemaVersion: "1.0",
      modelVersion: "test",
      runId: "fixture",
      referenceDate: "2026-10-03",
      horizon: 2036,
      gaps: [],
    },
    population: 20000,
    households: 8000,
    projects: [
      {
        id: "future",
        units: 100,
        deliveryDate: "2028-01-01",
        occupancyAtReference: null,
      },
      {
        id: "old",
        units: 100,
        deliveryDate: "2025-01-01",
        occupancyAtReference: null,
      },
      {
        id: "pending",
        units: 50,
        deliveryDate: null,
        occupancyAtReference: null,
      },
    ],
    movements: [{ id: "rio", name: "Rio Pequeno" }],
    parameters: [3, 5, 10].map((k) => ({ ...p, k })),
    routing,
    routingVariants: {},
    baseline: {
      rio: Array.from({ length: 24 }, () => ({
        car: 10,
        moto: 5,
        bus: null,
        bike: 1,
      })),
    },
  };
  let s = defaultScenario(b);
  s = { ...s, selectedProjectIds: [], extraPopulation: 0 };
  let r = simulate(b, s);
  assert.deepEqual(r.now, r.after);
  assert.equal(r.delta.car, 0);
  assert.equal(r.totalMotor, null);
  s = { ...s, extraPopulation: 5000 };
  r = simulate(b, s);
  assert.equal(r.population, 5000);
  assert.equal(
    Object.values(r.peopleTrips).reduce((a, b) => a + b, 0),
    10000,
  );
  assert.ok(Math.abs(r.delta.car - ((5000 * 2 * 0.4) / 1.5) * 0.25) < 1e-9);
  const a = simulate(b, { ...s, carToBus: 0.25, carToBike: 0.1 });
  assert.ok(a.delta.car < r.delta.car);
  assert.equal(
    Object.values(a.peopleTrips).reduce((a, b) => a + b, 0),
    10000,
  );
  assert.ok(a.peopleTrips.bus > r.peopleTrips.bus);
  assert.ok(a.peopleTrips.bike > r.peopleTrips.bike);
  const bus = simulate(b, { ...s, additionalBusesPerHour: 2 });
  assert.equal(bus.delta.bus, 34);
  assert.equal(
    bus.hourly.reduce((a, h) => a + h.delta.bus, 0),
    34,
  );
  assert.equal(bus.delta.car, r.delta.car);
  assert.equal(bus.after.bus, null);
  const shift = simulate(b, { ...s, peakShift: 0.5 });
  assert.ok(Math.abs(shift.delta.car - r.delta.car) < 1e-9);
  assert.ok(shift.hourly[8].delta.car < r.hourly[8].delta.car);
  assert.ok(shift.hourly[10].delta.car > r.hourly[10].delta.car);
  assert.equal(simulate(b, { ...s, year: 2026 }).population, 0);
  assert.equal(
    simulate(b, { ...s, year: 2026, additionalBusesPerHour: 4 }).delta.bus,
    0,
  );
  const ps = {
    ...s,
    selectedProjectIds: ["future", "old", "pending"],
    extraPopulation: 0,
  };
  assert.equal(populationAt(b, ps, 2027).population, 0);
  assert.equal(populationAt(b, ps, 2030).population, 250);
  assert.equal(populationAt(b, ps, 2030).excluded, 1);
  assert.equal(populationAt(b, ps, 2030).pending, 1);
  assert.equal(
    populationAt(
      b,
      { ...ps, projectOverrides: { future: { occupancy: 1 } } },
      2027,
    ).population,
    0,
  );
  const both = simulate(b, { ...ps, extraPopulation: 5000 });
  const replace = simulate(b, {
    ...ps,
    extraPopulation: 5000,
    populationMode: "replace",
  });
  assert.equal(both.population, 5250);
  assert.equal(replace.population, 5000);
  const partiallyOccupied = {
    ...ps,
    selectedProjectIds: ["old"],
    projectOverrides: { old: { occupancyAtReference: 0.6 } },
  };
  assert.equal(populationAt(b, partiallyOccupied, 2030).population, 100);
  assert.throws(() =>
    validateScenario(b, { ...s, modalShares: { ...s.modalShares, car: 0.9 } }),
  );
  assert.throws(() => validateScenario(b, { ...s, runId: "other" }));
  assert.throws(() => validateScenario(b, { ...s, extraPopulation: NaN }));
  assert.throws(() =>
    validateScenario(b, { ...s, carToBus: 0.8, carToBike: 0.8 }),
  );
  assert.throws(() =>
    validateScenario(b, {
      ...s,
      projectOverrides: { future: { deliveryDate: "2029-02-30" } },
    }),
  );
  assert.deepEqual(simulate(b, s), simulate(b, JSON.parse(JSON.stringify(s))));
  assert.ok(resultCsv(r).includes("execucao"));
  assert.ok(
    !resultCsv(simulate(b, { ...s, name: "=malicious()" })).includes(
      ';"=malicious()"',
    ),
  );
  const unknown = structuredClone(b);
  unknown.baseline.rio[0].car = null;
  assert.equal(simulate(unknown, s).now.car, null);
  assert.equal(simulate(unknown, s).totalMotor, null);
  try {
    const real = JSON.parse(await readFile("public/data/study.json", "utf8"));
    const realScenario = defaultScenario(real),
      r1 = simulate(real, realScenario),
      r2 = simulate(real, JSON.parse(JSON.stringify(realScenario)));
    assert.deepEqual(r1, r2);
    assert.equal(r1.population, 0);
    assert.equal(r1.delta.car, 0);
    assert.ok(real.manifest.sources.some((s) => s.sha256?.length === 64));
    console.log(
      "Actual published bundle: deterministic, baseline preserved, provenance present.",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  console.log(
    "Model tests passed: conservation, occupancy, deduplication, transfers, bus service, peaks, chronology, missing data, import, CSV and reproducibility.",
  );
}
