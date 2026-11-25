import test from "node:test";
import assert from "node:assert/strict";
import { createLoan, totals, recordRepayment, reverseRepayment, renewLoan, canDeleteLoan } from "./loans.js";

const loan = () => createLoan({ id:"L1", customerId:"C1", collateralId:"A1", principal:1000, mode:"percent", value:20, periodDays:30, issuedOn:"2026-11-01" });

test("creates a loan with an initial interest charge and due date", () => {
  const value = loan();
  assert.equal(value.charges[0].amount, 200);
  assert.equal(value.dueOn, "2026-12-01");
  assert.equal(totals(value).balance, 1200);
});

test("repayments reduce balance and cannot exceed it", () => {
  const value = recordRepayment(loan(), { id:"R1", amount:500, on:"2026-11-05", method:"Cash" });
  assert.equal(totals(value).balance, 700);
  assert.throws(() => recordRepayment(value, { id:"R2", amount:701, on:"2026-11-06", method:"Cash" }));
});

test("reversal preserves the original repayment as a reversed record", () => {
  const paid = recordRepayment(loan(), { id:"R1", amount:500, on:"2026-11-05", method:"Cash" });
  const reversed = reverseRepayment(paid, "R1", { reversalId:"REV1", on:"2026-11-06", reason:"Entered in error" });
  assert.equal(reversed.repayments.length, 1);
  assert.equal(reversed.repayments[0].status, "REVERSED");
  assert.equal(totals(reversed).balance, 1200);
});

test("renewal adds a separate charge without changing principal", () => {
  const renewed = renewLoan(loan(), { chargeId:"CH2", on:"2026-12-01" });
  assert.equal(renewed.principal, 1000);
  assert.equal(renewed.renewals, 1);
  assert.equal(renewed.charges.length, 2);
  assert.equal(renewed.dueOn, "2026-12-31");
});

test("loan with financial history cannot be deleted", () => {
  assert.equal(canDeleteLoan(loan()), false);
});