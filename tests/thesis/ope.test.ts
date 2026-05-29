import { describe, test, expect } from "vitest";
import { ips, snips, doublyRobust } from "@/thesis/eval/ope";

describe("OPE estimators (known-answer)", () => {
  const logs = [
    { reward: 1, loggingProp: 0.5, targetProp: 0.5 },
    { reward: 0, loggingProp: 0.5, targetProp: 0.5 },
    { reward: 1, loggingProp: 0.5, targetProp: 1.0 },
  ];

  test("IPS = mean(reward * target/logging)", () => {
    // weights: 1, 1, 2 → (1*1 + 0*1 + 1*2)/3 = 1
    expect(ips(logs)).toBeCloseTo(1, 9);
  });

  test("SNIPS = sum(w*reward)/sum(w)", () => {
    // weighted reward = 1+0+2 = 3; sum weights = 4 → 0.75
    expect(snips(logs)).toBeCloseTo(0.75, 9);
  });

  test("when target == logging, IPS == mean reward", () => {
    const same = [
      { reward: 1, loggingProp: 0.3, targetProp: 0.3 },
      { reward: 0, loggingProp: 0.7, targetProp: 0.7 },
    ];
    expect(ips(same)).toBeCloseTo(0.5, 9);
  });

  test("IPS treats non-positive logging propensity as zero weight", () => {
    const bad = [{ reward: 5, loggingProp: 0, targetProp: 1 }];
    expect(ips(bad)).toBe(0);
  });

  test("empty logs → 0 for all estimators", () => {
    expect(ips([])).toBe(0);
    expect(snips([])).toBe(0);
    expect(doublyRobust([])).toBe(0);
  });

  test("doublyRobust falls back to IPS when no model estimate given", () => {
    expect(doublyRobust(logs)).toBeCloseTo(ips(logs), 9);
  });

  test("doublyRobust uses the model estimate to reduce variance", () => {
    // perfect model estimate (estReward == reward) → DR equals mean(estReward) regardless of weights
    const perfect = [
      { reward: 1, loggingProp: 0.5, targetProp: 0.9, estReward: 1 },
      { reward: 0, loggingProp: 0.5, targetProp: 0.1, estReward: 0 },
    ];
    expect(doublyRobust(perfect)).toBeCloseTo(0.5, 9);
  });
});
