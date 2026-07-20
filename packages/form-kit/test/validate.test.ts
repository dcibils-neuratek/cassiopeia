import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, isVisible, computeDerived, formPages, visiblePatch } from "../src/validate.js";
import type { FormDefinition } from "@cassiopeia/model";

const form: FormDefinition = {
  id: "f", version: 1, title: "t",
  fields: [
    { kind: "text", id: "a", bind: "name", label: "Name", required: true, page: 1 },
    { kind: "checkbox", id: "b", bind: "isCompany", label: "Company?", page: 1 },
    { kind: "text", id: "c", bind: "company", label: "Company name", visibleIf: "isCompany == true", page: 1 },
    { kind: "number", id: "d", bind: "price", label: "Price", page: 2 },
    { kind: "computed", id: "e", bind: "withTax", label: "With fee", expr: "price + 10", page: 2 },
  ],
};

test("required validation fires when empty", () => {
  const errs = validate(form, {});
  assert.equal(errs.name, "Required");
});

test("visibleIf hides a field until its condition holds", () => {
  const field = form.fields[2];
  assert.equal(isVisible(field, { isCompany: false }), false);
  assert.equal(isVisible(field, { isCompany: true }), true);
});

test("computed fields derive from the expression", () => {
  const d = computeDerived(form, { price: 100 });
  assert.equal(d.withTax, 110);
});

test("computed fields update as inputs change", () => {
  assert.equal(computeDerived(form, { price: 0 }).withTax, 10);
});

test("computed fields are not required-validated", () => {
  const errs = validate(form, { name: "x" });
  assert.equal(errs.withTax, undefined);
});

test("formPages returns distinct sorted pages", () => {
  assert.deepEqual(formPages(form), [1, 2]);
});

test("visiblePatch includes derived values and drops hidden ones", () => {
  const patch = visiblePatch(form, { name: "Ada", isCompany: false, company: "leftover", price: 50 });
  assert.equal(patch.company, undefined); // hidden
  assert.equal(patch.withTax, 60); // derived (50 + 10)
});
