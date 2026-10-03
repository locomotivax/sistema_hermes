import { simulate } from "./engine";
import type { Scenario, StudyBundle } from "./contracts";
const scope = self as unknown as {
  onmessage: (
    event: MessageEvent<{
      id: number;
      bundle: StudyBundle;
      scenario: Scenario;
    }>,
  ) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({
      id: data.id,
      result: simulate(data.bundle, data.scenario),
    });
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : "Falha na simulação",
    });
  }
};
