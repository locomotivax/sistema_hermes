import { z } from "zod";

export const MODES = ["car", "moto", "bus", "bike", "walk", "other"] as const;
export type Mode = (typeof MODES)[number];
export type Modal = Record<Mode, number>;
export type Flow = Record<"car" | "moto" | "bus" | "bike", number | null>;
export interface Source {
  id: string;
  title: string;
  url: string;
  version: string;
  collectedAt: string;
  sha256: string | null;
  status: "integrated" | "unavailable";
  license: string;
  transformations: string[];
}
export interface Manifest {
  schemaVersion: "1.0";
  modelVersion: string;
  runId: string;
  referenceDate: string;
  horizon: number;
  generatedAt: string;
  sources: Source[];
  gaps: string[];
  assumptions: string[];
  validation: Record<string, unknown>;
}
export interface Project {
  id: string;
  process: string;
  parcel: string;
  address: string;
  units: number | null;
  coordinates: [number, number];
  status: string;
  deliveryDate: string | null;
  occupancyAtReference: number | null;
  sourceIds: string[];
  evidence: string[];
  licenseDate: string | null;
}
export interface Comparable {
  id: number;
  name: string;
  distance: number;
  weight: number;
  population: number;
  income: number;
  density: number;
  householdSize: number;
  jobsPerResident: number;
  accessibility: number;
  sampledTrips: number;
}
export interface Parameters {
  k: number;
  rate: number;
  shares: Modal;
  purposeShares?: Record<string, number>;
  hourly: Record<Mode, number[]>;
  occupancy: { car: number; moto: number };
  comparables: Comparable[];
}
export interface Movement {
  id: string;
  name: string;
  coordinates: [number, number][];
}
export interface StudyBundle {
  coverage?: { motorTotalComplete: boolean; unavailableCategories: string[] };
  manifest: Manifest;
  center: [number, number];
  radiusM: number;
  population: number;
  households: number;
  populationMethod: string;
  projects: Project[];
  movements: Movement[];
  parameters: Parameters[];
  routing: Record<Mode, Record<string, number>>;
  baseline: Record<string, Flow[]>;
  routingVariants: Record<string, Record<Mode, Record<string, number>>>;
  roads: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: { type: string; coordinates: unknown };
      properties: Record<string, unknown>;
    }>;
  };
  zones: StudyBundle["roads"];
  stats: Record<string, number>;
}
const finite = z.number().finite();
const fraction = finite.min(0).max(1);
export const scenarioSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    modelVersion: z.string(),
    runId: z.string(),
    name: z.string().min(1).max(120),
    year: finite.int().min(2026).max(2036),
    extraPopulation: finite.min(0).max(1_000_000),
    populationMode: z.enum(["additional", "replace"]),
    residentsPerUnit: finite.min(0.1).max(20),
    occupancyMonths: finite.int().min(1).max(120),
    selectedProjectIds: z.array(z.string()).max(10000),
    projectOverrides: z.record(
      z.object({
        deliveryDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((s) => {
            const d = new Date(s);
            return (
              Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
            );
          }, "Data inexistente")
          .optional(),
        units: finite.int().min(0).max(100000).optional(),
        occupancy: fraction.optional(),
        occupancyAtReference: fraction.optional(),
      }),
    ),
    k: z.union([z.literal(3), z.literal(5), z.literal(10)]),
    modalShares: z
      .object(
        Object.fromEntries(MODES.map((m) => [m, fraction])) as Record<
          Mode,
          typeof fraction
        >,
      )
      .refine(
        (s) => Math.abs(Object.values(s).reduce((a, b) => a + b, 0) - 1) < 1e-6,
        "A soma dos modos deve ser 100%",
      ),
    carOccupancy: finite.min(1).max(8),
    motoOccupancy: finite.min(1).max(2),
    carToBus: fraction,
    carToBike: fraction,
    peakShift: fraction,
    additionalBusesPerHour: finite.min(0).max(1000),
  })
  .superRefine((s, c) => {
    if (s.carToBus + s.carToBike > 1)
      c.addIssue({
        code: "custom",
        message: "Transferências do carro não podem superar 100%",
        path: ["carToBus"],
      });
  });
export type Scenario = z.infer<typeof scenarioSchema>;
export interface ScenarioResult {
  schemaVersion: "1.0";
  modelVersion: string;
  runId: string;
  scenario: Scenario;
  population: number;
  projectPopulation: number;
  pendingProjects: number;
  excludedProjects: number;
  pendingUnits: number;
  now: Flow;
  after: Flow;
  delta: Flow;
  partialMotorTotal: number | null;
  totalMotor: number | null;
  interval: [number, number] | null;
  peopleTrips: Modal;
  peopleTripsByPurpose: Record<string, number>;
  hourly: Array<{ hour: number; now: Flow; after: Flow; delta: Flow }>;
  movements: Array<{
    id: string;
    name: string;
    now: Flow;
    after: Flow;
    delta: Flow;
  }>;
  annual: Array<{
    year: number;
    population: number;
    motorDelta: number | null;
  }>;
  warnings: string[];
  sensitivity: Array<{ label: string; motorDelta: number | null }>;
}
