import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, evalBool } from "../src/index.js";

test("arithmetic respects precedence", () => {
  assert.equal(evaluate("2 + 3 * 4", {}), 14);
  assert.equal(evaluate("(2 + 3) * 4", {}), 20);
});

test("comparison and boolean operators", () => {
  assert.equal(evalBool("riskScore > 0.5 && verified", { riskScore: 0.7, verified: true }), true);
  assert.equal(evalBool("riskScore > 0.5 && verified", { riskScore: 0.2, verified: true }), false);
});

test("dotted identifiers read nested context", () => {
  assert.equal(evaluate("customer.income", { customer: { income: 5000 } }), 5000);
});

test("string equality and or", () => {
  assert.equal(evalBool("decision == 'approved' || override", { decision: "approved", override: false }), true);
  assert.equal(evalBool("decision == 'approved' || override", { decision: "review", override: true }), true);
  assert.equal(evalBool("decision == 'approved' || override", { decision: "review", override: false }), false);
});

test("missing identifiers are falsy, not thrown", () => {
  assert.equal(evalBool("missing > 5", {}), false);
});
