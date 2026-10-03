import { build } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
await mkdir(".sites-runtime/model", { recursive: true });
await build({
  configFile: false,
  logLevel: "silent",
  build: {
    lib: {
      entry: "lib/model/engine.ts",
      formats: ["es"],
      fileName: () => "engine.mjs",
    },
    outDir: ".sites-runtime/model",
    emptyOutDir: true,
    minify: false,
    rolldownOptions: { external: ["zod"] },
  },
});
const engine = await import(
  pathToFileURL(process.cwd() + "/.sites-runtime/model/engine.mjs").href
);
const [
  command = "simulate",
  scenarioPath,
  outputPath = "data/processed/result.json",
] = process.argv.slice(2);
if (command === "test") {
  await import("../tests/model.mjs").then((m) => m.run(engine));
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      lib: {
        entry: "lib/model/worker.ts",
        formats: ["es"],
        fileName: () => "worker.mjs",
      },
      outDir: ".sites-runtime/model",
      emptyOutDir: false,
      minify: false,
      rolldownOptions: { external: ["zod"] },
    },
  });
  const bundle = JSON.parse(await readFile("public/data/study.json", "utf8"));
  const scenario = {
    ...engine.defaultScenario(bundle),
    extraPopulation: 5000,
    additionalBusesPerHour: 2,
    carToBike: 0.1,
  };
  let message;
  globalThis.self = {
    postMessage: (r) => {
      message = r;
    },
  };
  await import(
    pathToFileURL(process.cwd() + "/.sites-runtime/model/worker.mjs").href
  );
  self.onmessage({ data: structuredClone({ id: 7, bundle, scenario }) });
  const assert = (await import("node:assert/strict")).default;
  assert.equal(message.id, 7);
  assert.deepEqual(message.result, engine.simulate(bundle, scenario));
  console.log(
    "Worker message protocol and batch engine: identical results for the published bundle.",
  );
} else if (command === "simulate") {
  const bundle = JSON.parse(await readFile("public/data/study.json", "utf8"));
  const scenario = scenarioPath
    ? JSON.parse(await readFile(scenarioPath, "utf8"))
    : engine.defaultScenario(bundle);
  const result = engine.simulate(bundle, scenario);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      outputPath,
      runId: result.runId,
      population: result.population,
      delta: result.delta,
    }),
  );
} else throw new Error("Use simulate [scenario.json] [output.json] or test");
