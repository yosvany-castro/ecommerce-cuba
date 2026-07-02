import { describe, it, expect, beforeEach } from "vitest";
import {
  isConnectionError,
  reportDbFailure,
  reportDbSuccess,
  dbHealth,
  resetDbHealthForTests,
} from "@/lib/db/health";

const connErr = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

beforeEach(() => resetDbHealthForTests());

describe("isConnectionError", () => {
  it("classifies connection-class errors, not SQL errors", () => {
    expect(isConnectionError(connErr())).toBe(true);
    expect(isConnectionError(Object.assign(new Error("x"), { code: "57P03" }))).toBe(true);
    expect(isConnectionError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    // A plain SQL error says nothing about DB health:
    expect(isConnectionError(Object.assign(new Error("syntax error"), { code: "42601" }))).toBe(false);
    expect(isConnectionError(new Error("duplicate key value"))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});

describe("breaker state machine", () => {
  it("opens after 2 consecutive connection failures, not after 1", () => {
    const t = 1000;
    const now = () => t;
    reportDbFailure(connErr(), now);
    expect(dbHealth(now)).toBe("ok");
    reportDbFailure(connErr(), now);
    expect(dbHealth(now)).toBe("down");
  });

  it("SQL errors never open the breaker", () => {
    const now = () => 1000;
    reportDbFailure(Object.assign(new Error("bad sql"), { code: "42601" }), now);
    reportDbFailure(Object.assign(new Error("bad sql"), { code: "42601" }), now);
    expect(dbHealth(now)).toBe("ok");
  });

  it("a success closes the breaker pre-open", () => {
    const now = () => 1000;
    reportDbFailure(connErr(), now);
    reportDbSuccess();
    reportDbFailure(connErr(), now);
    expect(dbHealth(now)).toBe("ok"); // nunca llegó a 2 consecutivas
  });

  it("half-opens after the cooldown: one more failure re-opens immediately", () => {
    let t = 1000;
    const now = () => t;
    reportDbFailure(connErr(), now);
    reportDbFailure(connErr(), now);
    expect(dbHealth(now)).toBe("down");

    t += 15_000; // cooldown elapses → half-open
    expect(dbHealth(now)).toBe("ok");

    reportDbFailure(connErr(), now); // the probe fails → re-open at once
    expect(dbHealth(now)).toBe("down");
  });

  it("recovery: half-open probe succeeds → breaker fully closes", () => {
    let t = 1000;
    const now = () => t;
    reportDbFailure(connErr(), now);
    reportDbFailure(connErr(), now);
    t += 15_000;
    expect(dbHealth(now)).toBe("ok");
    reportDbSuccess();
    reportDbFailure(connErr(), now); // a single new failure must NOT re-open
    expect(dbHealth(now)).toBe("ok");
  });
});
