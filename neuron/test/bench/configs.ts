import type { BenchConfig } from "./types"

export const BENCHES: Record<string, BenchConfig> = {
  iris: {
    name: "iris",
    csv: "iris.csv",
    kind: "classification",
    label_column: "species",
    budget_s: 60,
    accuracy_target: 0.90,
    max_waves: 2,
    test_size: 0.2,
  },
  wine: {
    name: "wine",
    csv: "wine.csv",
    kind: "classification",
    label_column: "class",
    budget_s: 60,
    accuracy_target: 0.90,
    max_waves: 2,
    test_size: 0.2,
  },
  "breast-cancer": {
    name: "breast-cancer",
    csv: "breast-cancer.csv",
    kind: "classification",
    label_column: "diagnosis",
    budget_s: 120,
    accuracy_target: 0.92,
    max_waves: 2,
    test_size: 0.2,
  },
  housing: {
    name: "housing",
    csv: "housing.csv",
    kind: "regression",
    label_column: "price",
    budget_s: 60,
    accuracy_target: 0.5,  // R²
    max_waves: 2,
    test_size: 0.2,
  },
  digits: {
    name: "digits",
    csv: "digits.csv",
    kind: "classification",
    label_column: "label",
    budget_s: 120,
    accuracy_target: 0.85,
    max_waves: 2,
    test_size: 0.2,
  },
}

export const FAST_SUBSET = ["iris", "wine"]
export const FULL_SUITE = Object.keys(BENCHES)
