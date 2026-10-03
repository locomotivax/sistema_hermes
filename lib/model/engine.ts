import {
  MODES,
  scenarioSchema,
  type Flow,
  type Modal,
  type Parameters,
  type Scenario,
  type ScenarioResult,
  type StudyBundle,
} from "./contracts";

const empty = (): Flow => ({ car: 0, moto: 0, bus: null, bike: null });
export function defaultScenario(b: StudyBundle): Scenario {
  const p = b.parameters.find((p) => p.k === 5)!;
  return {
    schemaVersion: "1.0",
    modelVersion: b.manifest.modelVersion,
    runId: b.manifest.runId,
    name: "Empreendimentos selecionados",
    year: 2030,
    extraPopulation: 0,
    populationMode: "additional",
    residentsPerUnit: b.population / b.households || 2.5,
    occupancyMonths: 24,
    selectedProjectIds: b.projects.map((p) => p.id),
    projectOverrides: {},
    k: 5,
    modalShares: { ...p.shares },
    carOccupancy: p.occupancy.car,
    motoOccupancy: p.occupancy.moto,
    carToBus: 0,
    carToBike: 0,
    peakShift: 0,
    additionalBusesPerHour: 0,
  };
}
export function validateScenario(b: StudyBundle, input: unknown): Scenario {
  const s = scenarioSchema.parse(input);
  if (
    s.modelVersion !== b.manifest.modelVersion ||
    s.runId !== b.manifest.runId
  )
    throw new Error(
      "O cenário pertence a outra versão da pesquisa. Recrie-o com os dados atuais.",
    );
  if (
    s.selectedProjectIds.some((id) => !b.projects.some((p) => p.id === id)) ||
    Object.keys(s.projectOverrides).some(
      (id) => !b.projects.some((p) => p.id === id),
    )
  )
    throw new Error("Empreendimento desconhecido no cenário.");
  return s;
}
export function populationAt(b: StudyBundle, s: Scenario, year: number) {
  const date =
    year === 2026
      ? new Date(b.manifest.referenceDate + "T00:00:00Z")
      : new Date(`${year}-12-31T00:00:00Z`);
  const ref = new Date(b.manifest.referenceDate + "T00:00:00Z");
  let population = 0,
    pending = 0,
    pendingUnits = 0,
    excluded = 0;
  for (const p of b.projects) {
    if (!s.selectedProjectIds.includes(p.id)) continue;
    const o = s.projectOverrides[p.id] || {},
      units = o.units ?? p.units,
      delivery = o.deliveryDate ?? p.deliveryDate;
    if (units === null || !delivery) {
      pending++;
      pendingUnits += units ?? 0;
      continue;
    }
    const d = new Date(delivery + "T00:00:00Z");
    const reference = o.occupancyAtReference ?? p.occupancyAtReference;
    if (d <= ref && reference === null) {
      excluded++;
      continue;
    }
    const curve = (at: Date) =>
      Math.max(
        0,
        Math.min(
          1,
          (at.getTime() - d.getTime()) /
            ((365.25 / 12) * 86400000 * s.occupancyMonths),
        ),
      );
    const base = reference ?? 0;
    const occupied = curve(date) * (o.occupancy ?? 1);
    // The reference is immutable: changing occupancy does not create growth in 2026.
    if (year > 2026)
      population += units * s.residentsPerUnit * Math.max(0, occupied - base);
  }
  return { population, pending, pendingUnits, excluded };
}
function reduceFlows(flows: Flow[]): Flow {
  const out = empty();
  for (const mode of ["car", "moto", "bus", "bike"] as const)
    out[mode] = flows.some((f) => f[mode] === null)
      ? null
      : flows.reduce((a, f) => a + f[mode]!, 0);
  return out;
}
function minus(a: Flow, b: Flow): Flow {
  const out = empty();
  for (const m of ["car", "moto", "bus", "bike"] as const)
    out[m] = a[m] === null || b[m] === null ? null : a[m]! - b[m]!;
  return out;
}
function motor(f: Flow): number | null {
  return f.car === null || f.moto === null ? null : f.car + f.moto;
}
function shifted(profile: number[], proportion: number) {
  const out = [...profile],
    peaks = [7, 8, 9, 17, 18, 19];
  for (const h of peaks) {
    const transferred = profile[h] * proportion;
    out[h] -= transferred;
    out[h < 12 ? 10 : 20] += transferred;
  }
  return out;
}
function compute(
  b: StudyBundle,
  s: Scenario,
  year: number,
  p: Parameters,
  routing = b.routing,
  rateFactor = 1,
) {
  const state = populationAt(b, s, year);
  const manual =
    s.extraPopulation *
    Math.max(0, Math.min(1, (year - 2026) / Math.max(1, s.year - 2026)));
  const n =
    year === 2026
      ? 0
      : s.populationMode === "replace"
        ? manual
        : state.population + manual;
  const daily = Object.fromEntries(
    MODES.map((m) => [m, n * p.rate * rateFactor * s.modalShares[m]]),
  ) as Modal;
  const toBus = daily.car * s.carToBus,
    toBike = daily.car * s.carToBike;
  daily.car -= toBus + toBike;
  daily.bus += toBus;
  daily.bike += toBike;
  const byMovement = b.movements.map((m) => {
    const original =
      b.baseline[m.id] ??
      Array.from({ length: 24 }, () => ({
        car: null,
        moto: null,
        bus: null,
        bike: null,
      }));
    const now = original.map((f) => ({ ...f }));
    const after = now.map((f) => ({ ...f }));
    for (const mode of ["car", "moto"] as const) {
      const occupancy = mode === "car" ? s.carOccupancy : s.motoOccupancy;
      const profile = shifted(p.hourly[mode], s.peakShift);
      const cross = routing[mode]?.[m.id];
      for (let h = 0; h < 24; h++) {
        if (cross === undefined || after[h][mode] === null) {
          after[h][mode] = null;
          continue;
        }
        // Modal transfers apply to the incremental population, not unobserved background travellers.
        after[h][mode]! += (daily[mode] / occupancy) * profile[h] * cross;
      }
    }
    // Baseline bus/bicycle flows stay null when there is no observation.
    if (year > 2026)
      for (let h = 6; h < 23; h++)
        if (after[h].bus !== null)
          after[h].bus! += s.additionalBusesPerHour / b.movements.length;
    if (routing.bike?.[m.id] !== undefined)
      for (let h = 0; h < 24; h++)
        if (after[h].bike !== null)
          after[h].bike! += daily.bike * p.hourly.bike[h] * routing.bike[m.id];
    return { ...m, now, after };
  });
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const now = reduceFlows(byMovement.map((m) => m.now[hour])),
      after = reduceFlows(byMovement.map((m) => m.after[hour]));
    const delta = minus(after, now);
    delta.bus =
      year > 2026 && hour >= 6 && hour < 23 ? s.additionalBusesPerHour : 0;
    return { hour, now, after, delta };
  });
  const now = reduceFlows(hourly.map((h) => h.now)),
    after = reduceFlows(hourly.map((h) => h.after));
  const delta = minus(after, now);
  // Added service is a known increment even when the unknown baseline prevents a total.
  delta.bus = year > 2026 ? s.additionalBusesPerHour * 17 : 0;
  const bikeCross = Object.values(routing.bike ?? {}).reduce(
    (a, c) => a + c,
    0,
  );
  if (delta.bike === null && bikeCross > 0) delta.bike = daily.bike * bikeCross;
  return {
    n,
    state,
    daily,
    byMovement,
    hourly,
    now,
    after,
    delta,
    motorDelta: motor(delta) === null ? null : motor(delta)! + delta.bus!,
  };
}
export function simulate(b: StudyBundle, input: unknown): ScenarioResult {
  const s = validateScenario(b, input),
    p = b.parameters.find((p) => p.k === s.k)!;
  const c = compute(b, s, s.year, p);
  const sensitivity = b.parameters.map((p) => {
    const pp = {
      ...s,
      modalShares: p.shares,
      carOccupancy: p.occupancy.car,
      motoOccupancy: p.occupancy.moto,
    };
    return {
      label: `${p.k} zonas semelhantes`,
      motorDelta: compute(b, pp, s.year, p).motorDelta,
    };
  });
  for (const [label, routing] of Object.entries(b.routingVariants))
    sensitivity.push({
      label,
      motorDelta: compute(b, s, s.year, p, routing).motorDelta,
    });
  for (const factor of [0.8, 1.2])
    sensitivity.push({
      label: `Taxa de viagens ${factor === 0.8 ? "−20%" : "+20%"} (hipótese)`,
      motorDelta: compute(b, s, s.year, p, b.routing, factor).motorDelta,
    });
  for (const factor of [0.8, 1.2])
    sensitivity.push({
      label: `Ocupação de veículos ${factor === 0.8 ? "−20%" : "+20%"} (limitada a 1–8 carro / 1–2 moto)`,
      motorDelta: compute(
        b,
        {
          ...s,
          carOccupancy: Math.min(8, Math.max(1, s.carOccupancy * factor)),
          motoOccupancy: Math.min(2, Math.max(1, s.motoOccupancy * factor)),
        },
        s.year,
        p,
      ).motorDelta,
    });
  const known = sensitivity
    .map((a) => a.motorDelta)
    .filter((n): n is number => n !== null);
  if (c.motorDelta !== null) known.push(c.motorDelta);
  const warnings = [...b.manifest.gaps];
  if (c.state.pending)
    warnings.push(
      `${c.state.pending} projetos aguardam unidades ou data de entrega; não entram na população projetada.`,
    );
  if (c.state.excluded)
    warnings.push(
      `${c.state.excluded} projetos anteriores à referência aguardam ocupação de referência e foram excluídos do incremento.`,
    );
  if (s.additionalBusesPerHour > 0 && s.carToBus === 0)
    warnings.push(
      "Ônibus adicionais aumentam o fluxo; não foi pressuposta transferência de viagens de carro.",
    );
  if (s.additionalBusesPerHour > 0)
    warnings.push(
      "Oferta adicional de ônibus dividida igualmente entre aproximações, das 6h às 23h: hipótese de operação, sem dados de linhas ou capacidade de passageiros.",
    );
  if (s.extraPopulation > b.population * 0.25)
    warnings.push(
      "Incremento superior a 25% da população de referência: extrapolação elevada.",
    );
  if (Object.keys(s.projectOverrides).length)
    warnings.push(
      "Cronogramas/unidades editados são hipóteses do cenário, não novos registros oficiais.",
    );
  return {
    schemaVersion: "1.0",
    modelVersion: b.manifest.modelVersion,
    runId: b.manifest.runId,
    scenario: s,
    population: c.n,
    projectPopulation: c.state.population,
    pendingProjects: c.state.pending,
    excludedProjects: c.state.excluded,
    pendingUnits: c.state.pendingUnits,
    now: c.now,
    after: c.after,
    delta: c.delta,
    partialMotorTotal: motor(c.after),
    totalMotor:
      b.coverage?.motorTotalComplete !== true
        ? null
        : c.after.bus === null || motor(c.after) === null
          ? null
          : motor(c.after)! + c.after.bus,
    interval: known.length ? [Math.min(...known), Math.max(...known)] : null,
    peopleTrips: c.daily,
    peopleTripsByPurpose: Object.fromEntries(
      Object.entries(p.purposeShares ?? { "Não detalhada": 1 }).map(
        ([purpose, share]) => [purpose, c.n * p.rate * share],
      ),
    ),
    hourly: c.hourly,
    movements: c.byMovement.map((m) => {
      const now = reduceFlows(m.now),
        after = reduceFlows(m.after),
        delta = minus(after, now);
      delta.bus = c.delta.bus! / b.movements.length;
      return { id: m.id, name: m.name, now, after, delta };
    }),
    annual: Array.from({ length: 11 }, (_, i) => {
      const c = compute(b, s, 2026 + i, p);
      return { year: 2026 + i, population: c.n, motorDelta: c.motorDelta };
    }),
    warnings,
    sensitivity,
  };
}
export function resultCsv(r: ScenarioResult): string {
  const rows = [
    [
      "execucao",
      "modelo",
      "cenario",
      "ano",
      "hora",
      "modo",
      "referencia",
      "projecao",
      "incremento",
      "premissas",
    ],
  ];
  for (const h of r.hourly)
    for (const mode of ["car", "moto", "bus", "bike"] as const)
      rows.push([
        r.runId,
        r.modelVersion,
        r.scenario.name,
        String(r.scenario.year),
        String(h.hour),
        mode,
        h.now[mode] === null ? "" : String(h.now[mode]),
        h.after[mode] === null ? "" : String(h.after[mode]),
        h.delta[mode] === null ? "" : String(h.delta[mode]),
        JSON.stringify(r.scenario),
      ]);
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' + v.replaceAll('"', '""').replace(/^[=+@-]/, "'$&") + '"',
          )
          .join(";"),
      )
      .join("\r\n")
  );
}
