"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Bike,
  Bus,
  Car,
  Database,
  FlaskConical,
  Layers,
  Route,
  SlidersHorizontal,
  Upload,
  Info,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  MODES,
  type Mode,
  type Scenario,
  type ScenarioResult,
  type StudyBundle,
} from "@/lib/model/contracts";
import {
  defaultScenario,
  resultCsv,
  simulate,
  validateScenario,
} from "@/lib/model/engine";
import StudyMap from "./study-map";
const labels: Record<Mode, string> = {
  car: "Automóvel",
  moto: "Moto",
  bus: "Ônibus",
  bike: "Bicicleta",
  walk: "A pé",
  other: "Demais modos",
};
const colors: Record<Mode, string> = {
  car: "#20a3b8",
  moto: "#625ade",
  bus: "#ee9f38",
  bike: "#3b9c75",
  walk: "#718899",
  other: "#b5bbc3",
};
const fmt = (n: number | null | undefined, d = 0) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(n);
const motorDelta = (r: ScenarioResult | null) =>
  r && r.delta.car !== null && r.delta.moto !== null
    ? r.delta.car + r.delta.moto + (r.delta.bus ?? 0)
    : null;
function file(name: string, body: string, type = "application/json") {
  const u = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function Choice({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map(([v, t]) => (
            <SelectItem key={v} value={v}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
function Range({
  label,
  value,
  onChange,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div className="range-field">
      <div>
        <span>{label}</span>
        <strong>{fmt(value, 1)}%</strong>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={0}
        max={max}
        step={1}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}
function GridTable({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => (
              <TableCell key={j}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function Dashboard() {
  const [bundle, setBundle] = useState<StudyBundle | null>(null),
    [scenario, setScenario] = useState<Scenario | null>(null),
    [result, setResult] = useState<ScenarioResult | null>(null),
    [tab, setTab] = useState("overview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [hour, setHour] = useState(8),
    [highlight, setHighlight] = useState("");
  const worker = useRef<Worker | null>(null),
    id = useRef(0),
    upload = useRef<HTMLInputElement>(null),
    current = useRef(scenario);
  useEffect(() => {
    current.current = scenario;
  }, [scenario]);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/data/study.json", { signal: abort.signal })
      .then((r) => {
        if (!r.ok)
          throw new Error("Não foi possível carregar a execução publicada.");
        return r.json() as Promise<StudyBundle>;
      })
      .then((b: StudyBundle) => {
        let s = {
          ...defaultScenario(b),
          extraPopulation: 5000,
          name: "Mais 5 mil moradores",
        };
        try {
          const old = localStorage.getItem("fluxo-scenario-v1");
          if (old) s = validateScenario(b, JSON.parse(old));
        } catch {
          setNotice("A execução mudou. O cenário antigo foi descartado.");
        }
        setBundle(b);
        setScenario(s);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!bundle) return;
    try {
      const w = new Worker(new URL("../lib/model/worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      w.onmessage = (e) => {
        if (e.data.id !== id.current) return;
        setBusy(false);
        if (e.data.error) setError(e.data.error);
        else {
          setResult(e.data.result);
          setError("");
        }
      };
      w.onerror = () => {
        setBusy(false);
        setError(
          "Falha no processamento em segundo plano. Recarregue a página.",
        );
      };
    } catch {
      worker.current = null;
    }
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, [bundle]);
  useEffect(() => {
    if (!bundle || !scenario) return;
    const request = ++id.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBusy(true);
      setError("");
      try {
        validateScenario(bundle, scenario);
        try {
          localStorage.setItem("fluxo-scenario-v1", JSON.stringify(scenario));
        } catch {}
        if (worker.current)
          worker.current.postMessage({ id: request, bundle, scenario });
        else {
          setResult(simulate(bundle, scenario));
          setBusy(false);
        }
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Cenário inválido");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bundle, scenario]);
  useEffect(() => {
    if (!bundle) return;
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context) return;
    const life = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "simulate_traffic_scenario",
          description:
            "Recalcula e exibe um cenário local de população e ano. Não publica dados.",
          inputSchema: {
            type: "object",
            properties: {
              population: { type: "number", minimum: 0, maximum: 1000000 },
              year: { type: "integer", minimum: 2026, maximum: 2036 },
            },
            required: ["population", "year"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: (v: { population: number; year: number }) => {
            if (
              !current.current ||
              typeof v?.population !== "number" ||
              typeof v?.year !== "number"
            )
              throw new Error("População e ano são obrigatórios");
            const s = validateScenario(bundle, {
                ...current.current,
                extraPopulation: v.population,
                year: v.year,
              }),
              r = simulate(bundle, s);
            setScenario(s);
            return {
              runId: r.runId,
              population: r.population,
              year: s.year,
              increment: r.delta,
            };
          },
        },
        { signal: life.signal },
      ),
    ).catch(() => {});
    return () => life.abort();
  }, [bundle]);
  const update = (p: Partial<Scenario>) =>
    setScenario((s) => (s ? { ...s, ...p } : s));
  const visible = busy || error ? null : result,
    p = bundle?.parameters.find((p) => p.k === scenario?.k),
    h = visible?.hourly[hour];
  const hourly =
    visible?.hourly.map((h) => ({
      hour: `${h.hour}h`,
      now:
        h.now.car === null || h.now.moto === null
          ? null
          : h.now.car + h.now.moto,
      after:
        h.after.car === null || h.after.moto === null
          ? null
          : h.after.car + h.after.moto,
    })) ?? [];
  const setMode = (mode: Mode, value: number) => {
    if (!scenario) return;
    const n = Math.min(1, Math.max(0, value / 100)),
      rest = 1 - scenario.modalShares[mode];
    update({
      modalShares: Object.fromEntries(
        MODES.map((m) => [
          m,
          m === mode
            ? n
            : rest > 0
              ? (scenario.modalShares[m] / rest) * (1 - n)
              : (1 - n) / 5,
        ]),
      ) as Scenario["modalShares"],
    });
  };
  const override = (project: string, key: string, value: string) => {
    if (!scenario) return;
    const o = { ...scenario.projectOverrides[project] };
    if (!value) delete o[key as keyof typeof o];
    else if (key === "deliveryDate") o.deliveryDate = value;
    else if (key === "units") o.units = Number(value);
    else o[key as "occupancy" | "occupancyAtReference"] = Number(value) / 100;
    update({
      projectOverrides: { ...scenario.projectOverrides, [project]: o },
    });
  };
  async function read(f: File | undefined) {
    if (!f || !bundle) return;
    try {
      if (f.size > 1024 * 1024) throw new Error("Arquivo deve ter até 1 MB.");
      setScenario(validateScenario(bundle, JSON.parse(await f.text())));
      setNotice("Cenário importado e recalculado.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Arquivo inválido");
    }
    if (upload.current) upload.current.value = "";
  }
  const interventions = useMemo(() => {
    if (!bundle || !scenario) return [];
    try {
      validateScenario(bundle, scenario);
    } catch {
      return [];
    }
    return [
      {
        title: "Ônibus como alternativa",
        text: "Transferir 15% das viagens incrementais de carro para ônibus. Exige capacidade disponível e adesão.",
        patch: { carToBus: 0.15, carToBike: 0 },
        icon: Bus,
      },
      {
        title: "Conexão por bicicleta",
        text: "Transferir 10% das viagens incrementais de carro para bicicleta. Depende de rotas seguras e distâncias adequadas.",
        patch: { carToBike: 0.1, carToBus: 0 },
        icon: Bike,
      },
      {
        title: "Distribuir os horários",
        text: "Deslocar 20% das viagens incrementais de carro e moto dos picos para 10h e 20h, mantendo o total diário.",
        patch: { peakShift: 0.2 },
        icon: Activity,
      },
    ].map((c) => ({
      ...c,
      result: simulate(bundle, { ...scenario, ...c.patch }),
    }));
  }, [bundle, scenario]);
  if (!bundle || !scenario)
    return (
      <main className="load-screen">
        <Route size={36} />
        <h1>Rio Pequeno × Corifeu</h1>
        <p role="status">{error || "Carregando a execução da pesquisa…"}</p>
        {error && (
          <Button onClick={() => location.reload()}>Tentar novamente</Button>
        )}
      </main>
    );
  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-symbol">
            <Route size={22} />
          </span>
          <div>
            <strong>FLUXO</strong>
            <span>Rio Pequeno × Corifeu</span>
          </div>
        </div>
        <div className="top-right">
          <span>
            <FlaskConical size={16} /> Pesquisa aberta
          </span>
          <Button
            variant="outline"
            onClick={() =>
              visible &&
              file(
                `fluxo-${scenario.year}.csv`,
                resultCsv(visible),
                "text/csv;charset=utf-8",
              )
            }
            disabled={!visible}
          >
            <ArrowDownToLine size={16} /> Exportar resultados
          </Button>
        </div>
      </header>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">
            MOBILIDADE URBANA · ZONA OESTE DE SÃO PAULO
          </span>
          <h1>Rio Pequeno × Corifeu</h1>
          <p>
            Demanda viária, crescimento residencial e alternativas de
            mobilidade.
          </p>
        </div>
        <div className="reference-tag">
          Referência estimada<span>2026 · padrões OD 2023</span>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="workspace-tabs">
        <div className="tabs-row">
          <TabsList>
            <TabsTrigger value="overview">
              <Activity size={16} /> Agora e depois
            </TabsTrigger>
            <TabsTrigger value="projects">
              <Layers size={16} /> Empreendimentos{" "}
              <span className="count">{bundle.projects.length}</span>
            </TabsTrigger>
            <TabsTrigger value="interventions">
              <SlidersHorizontal size={16} /> Intervenções
            </TabsTrigger>
            <TabsTrigger value="method">
              <Database size={16} /> Dados e método
            </TabsTrigger>
          </TabsList>
          <span className="execution-id">
            Execução {bundle.manifest.runId.slice(0, 8)}
          </span>
        </div>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button aria-label="Fechar mensagem" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
            <Button onClick={() => setScenario(defaultScenario(bundle))}>
              Restaurar cenário
            </Button>
          </div>
        )}
        <TabsContent value="overview">
          <div className="main-grid">
            <aside className="scenario-panel">
              <div className="panel-title">
                <SlidersHorizontal size={17} />
                <h2>Seu cenário</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Restaurar parâmetros"
                  onClick={() => setScenario(defaultScenario(bundle))}
                >
                  <RotateCcw size={15} />
                </Button>
              </div>
              <label className="field-label">
                Nome do cenário
                <Input
                  value={scenario.name}
                  maxLength={120}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <Choice
                label="Ano da projeção"
                value={String(scenario.year)}
                choices={Array.from({ length: 11 }, (_, i) => [
                  String(2026 + i),
                  String(2026 + i),
                ])}
                onChange={(v) => update({ year: Number(v) })}
              />
              <div className="control-divider" />
              <span className="control-section">CRESCIMENTO POPULACIONAL</span>
              <label className="field-label">
                Moradores adicionais
                <Input
                  aria-label="Moradores adicionais"
                  type="number"
                  min="0"
                  max="1000000"
                  step="100"
                  value={scenario.extraPopulation}
                  onChange={(e) =>
                    update({
                      extraPopulation: Math.max(0, Number(e.target.value)),
                    })
                  }
                />
              </label>
              <div className="presets">
                {[0, 5000, 10000].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={
                      scenario.extraPopulation === n ? "default" : "outline"
                    }
                    onClick={() =>
                      update({
                        extraPopulation: n,
                        name: n
                          ? `Mais ${fmt(n)} moradores`
                          : "Empreendimentos selecionados",
                      })
                    }
                  >
                    {n ? `+${fmt(n)}` : "Base"}
                  </Button>
                ))}
              </div>
              <Choice
                label="Relação com os projetos"
                value={scenario.populationMode}
                choices={[
                  ["additional", "Somar aos empreendimentos"],
                  ["replace", "Substituir crescimento imobiliário"],
                ]}
                onChange={(v) =>
                  update({ populationMode: v as Scenario["populationMode"] })
                }
              />
              <p className="hint">
                Incremento líquido. Unidades já ocupadas não entram novamente.
              </p>
              <div className="control-divider" />
              <span className="control-section">OCUPAÇÃO DAS MORADIAS</span>
              <div className="two-inputs">
                <label className="field-label">
                  Pessoas/unidade
                  <Input
                    type="number"
                    min="0.1"
                    max="20"
                    step="0.1"
                    value={Number(scenario.residentsPerUnit.toFixed(2))}
                    onChange={(e) =>
                      update({ residentsPerUnit: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="field-label">
                  Meses até ocupar
                  <Input
                    type="number"
                    min="1"
                    max="120"
                    value={scenario.occupancyMonths}
                    onChange={(e) =>
                      update({ occupancyMonths: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <details>
                <summary>Modos e ocupação dos veículos</summary>
                <p className="hint">
                  Ao editar um modo, os demais são redistribuídos para conservar
                  100%.
                </p>
                {MODES.map((m) => (
                  <label className="modal-input" key={m}>
                    <span>
                      <i style={{ background: colors[m] }} />
                      {labels[m]}
                    </span>
                    <Input
                      aria-label={`Participação ${labels[m]} (%)`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={Number((scenario.modalShares[m] * 100).toFixed(2))}
                      onChange={(e) => setMode(m, Number(e.target.value))}
                    />
                    <small>%</small>
                  </label>
                ))}
                <div className="two-inputs">
                  <label className="field-label">
                    Pessoas/carro
                    <Input
                      type="number"
                      min="1"
                      max="8"
                      step="0.1"
                      value={Number(scenario.carOccupancy.toFixed(2))}
                      onChange={(e) =>
                        update({ carOccupancy: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="field-label">
                    Pessoas/moto
                    <Input
                      type="number"
                      min="1"
                      max="2"
                      step="0.1"
                      value={Number(scenario.motoOccupancy.toFixed(2))}
                      onChange={(e) =>
                        update({ motoOccupancy: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
              </details>
              <div className="scenario-files">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    file("cenario.json", JSON.stringify(scenario, null, 2))
                  }
                >
                  Salvar cenário
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => upload.current?.click()}
                >
                  <Upload size={14} /> Importar
                </Button>
                <input
                  ref={upload}
                  type="file"
                  className="sr-only"
                  accept=".json,application/json"
                  onChange={(e) => void read(e.target.files?.[0])}
                />
              </div>
            </aside>
            <section className="results-panel" aria-busy={busy}>
              <div className="comparison-head">
                <div>
                  <span className="eyebrow">COMPARAÇÃO DE DIA ÚTIL</span>
                  <h2>
                    Agora <small>2026</small> <span className="compare-line" />{" "}
                    Depois <small>{scenario.year}</small>
                  </h2>
                </div>
                <Choice
                  label="Hora de saída"
                  value={String(hour)}
                  choices={Array.from({ length: 24 }, (_, i) => [
                    String(i),
                    `${i}:00–${i + 1}:00`,
                  ])}
                  onChange={(v) => setHour(Number(v))}
                />
              </div>
              <div className="metric-grid">
                {(
                  [
                    { mode: "car", title: "Carros", icon: Car },
                    { mode: "moto", title: "Motos", icon: Route },
                    { mode: "bus", title: "Ônibus", icon: Bus },
                    { mode: "bike", title: "Bicicletas", icon: Bike },
                  ] as const
                ).map(({ mode, title, icon: Icon }) => (
                  <article className="metric" key={mode}>
                    <div className="metric-label">
                      <Icon size={17} style={{ color: colors[mode] }} />
                      {title}
                      <small>veíc./h</small>
                    </div>
                    <div className="metric-comparison">
                      <div>
                        <small>AGORA</small>
                        <strong>{busy ? "…" : fmt(h?.now[mode])}</strong>
                      </div>
                      <div>
                        <small>DEPOIS</small>
                        <strong>{busy ? "…" : fmt(h?.after[mode])}</strong>
                      </div>
                    </div>
                    <span
                      className={`metric-change ${mode === "bus" ? "missing" : ""}`}
                    >
                      {!h
                        ? "Recalculando"
                        : h.now[mode] === null
                          ? "Sem contagem de referência"
                          : h.now[mode]! > 0
                            ? `${h.after[mode]! >= h.now[mode]! ? "+" : ""}${fmt((h.after[mode]! / h.now[mode]! - 1) * 100, 1)}% no horário`
                            : h.after[mode]! > 0
                              ? "Incremento sobre referência zero"
                              : "Sem variação estimada"}
                    </span>
                  </article>
                ))}
              </div>
              <div className="map-card">
                <div className="card-heading">
                  <div>
                    <h3>O território da análise</h3>
                    <p>Projetos em 2 km · viagens externas incluídas</p>
                  </div>
                  <span className="badge">
                    {fmt(bundle.population)} moradores · Censo 2022
                  </span>
                </div>
                <StudyMap
                  bundle={bundle}
                  onProject={(id) => {
                    setHighlight(id);
                    setTab("projects");
                  }}
                />
              </div>
              <div className="quality-strip">
                <Info size={17} />
                <p>
                  Estimativas históricas. Ônibus e carga incompletos:{" "}
                  <strong>o total de automotores está indisponível.</strong>
                  {visible && (
                    <>
                      {" "}
                      {visible.pendingProjects} projetos selecionados aguardam
                      entrega/unidades; {visible.excludedProjects} aguardam
                      ocupação de referência.
                    </>
                  )}
                </p>
                <button onClick={() => setTab("method")}>Ver evidências</button>
              </div>
              <div className="charts-grid">
                <article className="chart-card">
                  <div className="card-heading">
                    <div>
                      <h3>O ritmo ao longo do dia</h3>
                      <p>Carros + motos · hora de saída</p>
                    </div>
                    <span className="chart-legend">
                      Cinza: agora · azul: depois
                    </span>
                  </div>
                  <ChartContainer
                    config={{
                      now: { label: "Agora", color: "#a4b3c4" },
                      after: { label: "Depois", color: "#129caf" },
                    }}
                    className="h-[230px] w-full"
                  >
                    <AreaChart data={hourly} accessibilityLayer>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="hour"
                        interval={3}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis width={45} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        dataKey="now"
                        type="monotone"
                        stroke="#a4b3c4"
                        fill="#a4b3c4"
                        fillOpacity={0.08}
                      />
                      <Area
                        dataKey="after"
                        type="monotone"
                        stroke="#129caf"
                        fill="#129caf"
                        fillOpacity={0.13}
                      />
                    </AreaChart>
                  </ChartContainer>
                </article>
                <article className="chart-card">
                  <div className="card-heading">
                    <div>
                      <h3>Até 2036</h3>
                      <p>
                        Incremento diário · carros, motos e ônibus adicionais
                      </p>
                    </div>
                  </div>
                  <ChartContainer
                    config={{
                      motorDelta: {
                        label: "Veículos adicionais/dia",
                        color: "#625ade",
                      },
                    }}
                    className="h-[230px] w-full"
                  >
                    <LineChart data={visible?.annual ?? []} accessibilityLayer>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="year"
                        interval="preserveStartEnd"
                        minTickGap={20}
                        padding={{ left: 8, right: 18 }}
                      />
                      <YAxis width={45} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        dataKey="motorDelta"
                        type="monotone"
                        stroke="#625ade"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ChartContainer>
                </article>
              </div>
              <div className="summary-row">
                <div>
                  <span>Incremento diário estimado</span>
                  <strong>
                    {fmt(motorDelta(visible))} <small>veículos/dia</small>
                  </strong>
                </div>
                <div>
                  <span>Faixa de sensibilidade</span>
                  <strong>
                    {visible?.interval
                      ? `${fmt(visible.interval[0])} a ${fmt(visible.interval[1])}`
                      : "—"}
                  </strong>
                  <small>Não é intervalo de confiança</small>
                </div>
                <div>
                  <span>Crescimento considerado</span>
                  <strong>
                    {fmt(visible?.population)} <small>pessoas</small>
                  </strong>
                  <small>
                    {fmt(visible?.projectPopulation)} provenientes dos projetos
                  </small>
                </div>
              </div>
              <details className="data-details">
                <summary>
                  Fluxos por aproximação e tabela horária acessível
                </summary>
                <GridTable
                  head={[
                    "Aproximação",
                    "Carros agora/dia",
                    "Carros depois/dia",
                    "Motos agora/dia",
                    "Motos depois/dia",
                    "Ônibus agora/dia",
                    "Ônibus depois/dia",
                    "Bicicletas agora/dia",
                    "Bicicletas depois/dia",
                  ]}
                  rows={
                    visible?.movements.map((m) => [
                      m.name,
                      fmt(m.now.car),
                      fmt(m.after.car),
                      fmt(m.now.moto),
                      fmt(m.after.moto),
                      fmt(m.now.bus),
                      fmt(m.after.bus),
                      fmt(m.now.bike),
                      fmt(m.after.bike),
                    ]) ?? []
                  }
                />
                <GridTable
                  head={[
                    "Hora de saída",
                    "Carros agora",
                    "Carros depois",
                    "Motos agora",
                    "Motos depois",
                    "Ônibus agora",
                    "Ônibus depois",
                    "Bicicletas agora",
                    "Bicicletas depois",
                  ]}
                  rows={
                    visible?.hourly.map((h) => [
                      `${h.hour}h`,
                      fmt(h.now.car),
                      fmt(h.after.car),
                      fmt(h.now.moto),
                      fmt(h.after.moto),
                      fmt(h.now.bus),
                      fmt(h.after.bus),
                      fmt(h.now.bike),
                      fmt(h.after.bike),
                    ]) ?? []
                  }
                />
              </details>
            </section>
          </div>
        </TabsContent>
        <TabsContent value="projects">
          <section className="wide-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">CADASTRO DOCUMENTAL</span>
                <h2>Empreendimentos no território</h2>
                <p>
                  Alvarás não comprovam conclusão. Datas editadas são hipóteses
                  do cenário.
                </p>
              </div>
              <span className="badge amber">
                {visible?.pendingProjects ?? bundle.projects.length} cronogramas
                pendentes
              </span>
            </div>
            <div className="quality-strip">
              <Info size={17} />
              <p>
                Entrega anterior à referência exige ocupação em 2026. Até
                preencher, o projeto não acrescenta moradores.
              </p>
            </div>
            <div className="project-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      "Incluir",
                      "Endereço / evidência",
                      "Unidades",
                      "Entrega hipotética",
                      "Ocupado em 2026 (%)",
                      "Ocupação final (%)",
                    ].map((t) => (
                      <TableHead key={t}>{t}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bundle.projects.map((p) => {
                    const o = scenario.projectOverrides[p.id] ?? {};
                    return (
                      <TableRow
                        key={p.id}
                        className={highlight === p.id ? "highlight-row" : ""}
                      >
                        <TableCell>
                          <Checkbox
                            aria-label={`Incluir ${p.address}`}
                            checked={scenario.selectedProjectIds.includes(p.id)}
                            onCheckedChange={(v) =>
                              update({
                                selectedProjectIds: v
                                  ? [
                                      ...new Set([
                                        ...scenario.selectedProjectIds,
                                        p.id,
                                      ]),
                                    ]
                                  : scenario.selectedProjectIds.filter(
                                      (id) => id !== p.id,
                                    ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <strong>{p.address}</strong>
                          <span className="project-meta">
                            Alvará: {p.licenseDate ?? "sem data"}
                          </span>
                          <details>
                            <summary>Documentação</summary>
                            <p>
                              {p.status}
                              <br />
                              Processo {p.process || "ausente"}
                              <br />
                              SQL {p.parcel || "ausente"}
                            </p>
                            {p.evidence.map((v, i) => (
                              <p key={i}>{v}</p>
                            ))}
                          </details>
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Unidades ${p.address}`}
                            type="number"
                            min="0"
                            value={o.units ?? p.units ?? ""}
                            onChange={(e) =>
                              override(p.id, "units", e.target.value)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Entrega ${p.address}`}
                            type="date"
                            value={o.deliveryDate ?? p.deliveryDate ?? ""}
                            onChange={(e) =>
                              override(p.id, "deliveryDate", e.target.value)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Ocupação de referência ${p.address}`}
                            placeholder="Desconhecida"
                            type="number"
                            min="0"
                            max="100"
                            value={
                              o.occupancyAtReference === undefined
                                ? p.occupancyAtReference === null
                                  ? ""
                                  : p.occupancyAtReference * 100
                                : o.occupancyAtReference * 100
                            }
                            onChange={(e) =>
                              override(
                                p.id,
                                "occupancyAtReference",
                                e.target.value,
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Ocupação final ${p.address}`}
                            placeholder="Curva gradual"
                            type="number"
                            min="0"
                            max="100"
                            value={
                              o.occupancy === undefined ? "" : o.occupancy * 100
                            }
                            onChange={(e) =>
                              override(p.id, "occupancy", e.target.value)
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>
        <TabsContent value="interventions">
          <section className="wide-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">ALTERNATIVAS PARA A DEMANDA</span>
                <h2>Testar antes de propor</h2>
                <p>
                  Efeitos condicionais às hipóteses. A adesão e a capacidade
                  devem ser verificadas.
                </p>
              </div>
            </div>
            <div className="intervention-grid">
              {interventions.map((c) => (
                <article key={c.title} className="intervention">
                  <span className="intervention-icon">
                    <c.icon size={24} />
                  </span>
                  <h3>{c.title}</h3>
                  <p>{c.text}</p>
                  <div>
                    <span>Incremento neste cenário</span>
                    <strong>
                      {fmt(motorDelta(c.result))} <small>veíc./dia</small>
                    </strong>
                    <small>
                      Pico incremental máximo:{" "}
                      {fmt(
                        Math.max(
                          ...c.result.hourly.map(
                            (h) => (h.delta.car ?? 0) + (h.delta.moto ?? 0),
                          ),
                        ),
                      )}{" "}
                      carros+motos/h
                    </small>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      update(c.patch);
                      setTab("overview");
                    }}
                  >
                    Aplicar hipótese
                  </Button>
                </article>
              ))}
            </div>
            <div className="intervention-controls">
              <div>
                <h3>Personalizar intervenções</h3>
                <Range
                  label="Carro → ônibus (viagens incrementais)"
                  value={scenario.carToBus * 100}
                  max={100 - scenario.carToBike * 100}
                  onChange={(v) => update({ carToBus: v / 100 })}
                />
                <Range
                  label="Carro → bicicleta (viagens incrementais)"
                  value={scenario.carToBike * 100}
                  max={100 - scenario.carToBus * 100}
                  onChange={(v) => update({ carToBike: v / 100 })}
                />
              </div>
              <div>
                <Range
                  label="Deslocar viagens incrementais dos picos"
                  value={scenario.peakShift * 100}
                  onChange={(v) => update({ peakShift: v / 100 })}
                />
                <label className="field-label">
                  Ônibus adicionais/h, das 6h às 23h
                  <Input
                    type="number"
                    min="0"
                    max="1000"
                    value={scenario.additionalBusesPerHour}
                    onChange={(e) =>
                      update({ additionalBusesPerHour: Number(e.target.value) })
                    }
                  />
                </label>
                <p className="hint">
                  17 horas de operação. Ônibus adicionais são veículos
                  adicionais, sem desconto automático de carros.
                </p>
              </div>
            </div>
            <div className="qualitative">
              <h3>Medidas que exigem levantamento local</h3>
              <p>
                Revisar fases semafóricas e travessias; conferir acessos e
                conversões dos empreendimentos; avaliar conexões cicloviárias e
                prioridade de ônibus. Filas, atrasos e redistribuição de
                capacidade não são quantificados sem contagens, geometria e
                programação semafórica.
              </p>
            </div>
          </section>
        </TabsContent>
        <TabsContent value="method">
          <section className="wide-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">PESQUISA REPRODUZÍVEL</span>
                <h2>O que sustenta cada estimativa</h2>
                <p>
                  Execução {bundle.manifest.runId} · modelo{" "}
                  {bundle.manifest.modelVersion} · referência{" "}
                  {bundle.manifest.referenceDate}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  file(
                    "manifesto.json",
                    JSON.stringify(bundle.manifest, null, 2),
                  )
                }
              >
                Baixar proveniência
              </Button>
            </div>
            <div className="method-stats">
              {[
                [bundle.stats.odRecords, "registros OD"],
                [bundle.stats.regionalEdges, "arestas regionais"],
                [
                  bundle.stats.crossingSampleTrips,
                  "viagens amostrais no cruzamento",
                ],
                [
                  bundle.stats.licensedUnits,
                  "unidades licenciadas identificadas",
                ],
              ].map(([n, t]) => (
                <div key={String(t)}>
                  <strong>{fmt(Number(n))}</strong>
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <div className="method-flow">
              População → Viagens → Modos → Veículos → Rotas
            </div>
            <p>
              Os modos 9 e 13 da OD identificam motoristas de carro e moto.
              Passageiros não geram veículos adicionais. A frota domiciliar é
              uma variável distinta do uso; sua divergência com as tabelas
              oficiais está documentada e ela não é usada para gerar fluxos.
            </p>
            <h3 className="subheading">Zonas comparáveis</h3>
            <p>
              Distância padronizada em renda, densidade, composição domiciliar,
              empregos/morador e proximidade a parada/estação OSM. Cinco
              atributos com igual peso na distância; pesos das zonas inversos à
              distância. Zonas do estudo excluídas.
            </p>
            <Choice
              label="Número de zonas"
              value={String(scenario.k)}
              choices={[
                ["3", "3 zonas"],
                ["5", "5 zonas"],
                ["10", "10 zonas"],
              ]}
              onChange={(v) => {
                const k = Number(v) as 3 | 5 | 10,
                  pp = bundle.parameters.find((p) => p.k === k)!;
                update({
                  k,
                  modalShares: pp.shares,
                  carOccupancy: pp.occupancy.car,
                  motoOccupancy: pp.occupancy.moto,
                });
              }}
            />
            <GridTable
              head={[
                "Zona OD",
                "Peso",
                "Renda familiar",
                "Moradores/ha",
                "Moradores/domicílio",
                "Empregos/morador",
                "Acessibilidade (proxy)",
                "Viagens na amostra",
              ]}
              rows={
                p?.comparables.map((c) => [
                  `${c.id} · ${c.name}`,
                  `${fmt(c.weight * 100, 1)}%`,
                  `R$ ${fmt(c.income)}`,
                  fmt(c.density, 1),
                  fmt(c.householdSize, 2),
                  fmt(c.jobsPerResident, 2),
                  fmt(c.accessibility, 3),
                  fmt(c.sampledTrips),
                ]) ?? []
              }
            />
            <h3 className="subheading">Viagens incrementais por finalidade</h3>
            <GridTable
              head={["Modo", "Viagens incrementais de pessoas/dia"]}
              rows={MODES.map((m) => [labels[m], fmt(visible?.peopleTrips[m])])}
            />
            <p>
              Distribuição ponderada das zonas comparáveis. Horários e modos
              usam as distribuições marginais da mesma amostra.
            </p>
            <GridTable
              head={["Finalidade OD", "Viagens de pessoas/dia"]}
              rows={Object.entries(visible?.peopleTripsByPurpose ?? {}).map(
                ([purpose, n]) => [purpose, fmt(n)],
              )}
            />
            <h3 className="subheading">Fontes e transformações</h3>
            <div className="sources">
              {bundle.manifest.sources.map((s) => (
                <article key={s.id}>
                  <span
                    className={`badge ${s.status === "unavailable" ? "amber" : ""}`}
                  >
                    {s.status === "integrated" ? "Integrada" : "Não integrada"}
                  </span>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  <p>
                    {s.version} · {s.license}
                  </p>
                  <p>Coleta: {s.collectedAt.slice(0, 10)}</p>
                  {s.transformations.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                  {s.sha256 && (
                    <code title={s.sha256}>
                      SHA-256 {s.sha256.slice(0, 20)}…
                    </code>
                  )}
                </article>
              ))}
            </div>
            <div className="method-bottom">
              <div>
                <h3>Limitações e pendências</h3>
                <ul>
                  {(visible?.warnings ?? bundle.manifest.gaps).map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Premissas explícitas</h3>
                <ul>
                  {bundle.manifest.assumptions.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
                <p>{bundle.populationMethod}</p>
                <h3 className="subheading">Conferência com tabelas oficiais</h3>
                <p>
                  Maior diferença por zona: população{" "}
                  {fmt(
                    Number(bundle.manifest.validation.odMaxPopulationError),
                    5,
                  )}
                  ; domicílios{" "}
                  {fmt(
                    Number(bundle.manifest.validation.odMaxHouseholdError),
                    5,
                  )}
                  ; viagens produzidas{" "}
                  {fmt(
                    Number(bundle.manifest.validation.odMaxProducedTripsError),
                    5,
                  )}
                  . Divergência na frota:{" "}
                  {fmt(
                    Number(bundle.manifest.validation.odMaxCarOwnershipError),
                    2,
                  )}{" "}
                  (não usada no fluxo).
                </p>
              </div>
            </div>
            <h3 className="subheading">Análise de sensibilidade</h3>
            <GridTable
              head={["Hipótese", "Incremento diário estimado"]}
              rows={
                visible?.sensitivity.map((s) => [s.label, fmt(s.motorDelta)]) ??
                []
              }
            />
            <p className="hint">
              As faixas não representam precisão estatística. A validação
              externa depende de contagens locais reservadas.
            </p>
          </section>
        </TabsContent>
      </Tabs>
      <footer>
        <span>FLUXO · Rio Pequeno × Corifeu</span>
        <span>
          Fontes públicas · hipóteses visíveis · resultados reproduzíveis
        </span>
      </footer>
    </main>
  );
}
