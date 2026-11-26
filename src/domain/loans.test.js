import test from "node:test";
import assert from "node:assert/strict";
import { createLoan, totals, recordRepayment, reverseRepayment, renewLoan, canDeleteLoan, allocateRepayments, buildCashbookRows } from "./loans.js";

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

test("allocates repayments to interest first, then principal", () => {
  const base = loan();
  const paid = {
    ...base,
    repayments: [
      { id:"R2", amount:500, on:"2026-11-20", method:"Cash", status:"POSTED" },
      { id:"R1", amount:100, on:"2026-11-10", method:"Cash", status:"POSTED" }
    ]
  };
  const rows = allocateRepayments(paid);
  assert.deepEqual(rows.map(x => [x.id,x.interest,x.principal]), [
    ["R1",100,0], ["R2",100,400]
  ]);
});

test("does not allocate a later renewal charge to an earlier repayment", () => {
  const base = loan();
  const value = {
    ...base,
    charges: [...base.charges, {id:"CH2",kind:"RENEWAL",amount:200,on:"2026-12-01"}],
    repayments: [{id:"R1",amount:300,on:"2026-11-15",method:"Cash",status:"POSTED"}]
  };
  const [row] = allocateRepayments(value);
  assert.equal(row.interest,200);
  assert.equal(row.principal,100);
});

test("reversed repayments are excluded from allocation", () => {
  const value = {
    ...loan(),
    repayments: [
      {id:"R1",amount:500,on:"2026-11-05",method:"Cash",status:"REVERSED"},
      {id:"R2",amount:250,on:"2026-11-06",method:"Cash",status:"POSTED"}
    ]
  };
  const rows = allocateRepayments(value);
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,"R2");
  assert.equal(rows[0].interest,200);
  assert.equal(rows[0].principal,50);
});


test("cashbook includes disbursement, interest charges, repayment and reversal separately", () => {
  const original = loan();
  const paid = recordRepayment(original, {id:"R1",amount:300,on:"2026-11-05",method:"Cash"});
  const reversed = reverseRepayment(paid,"R1",{reversalId:"REV1",on:"2026-11-06",reason:"Mistake"});
  const db = {
    customers:[{id:"C1",name:"Test Customer"}],
    collateral:[{id:"A1",description:"Test phone"}],
    loans:[reversed],
    events:[{id:"EV1",type:"REVERSAL",loanId:"L1",repaymentId:"R1",amount:300,interest:200,principal:100,on:"2026-11-06",reason:"Mistake"}]
  };
  const rows = buildCashbookRows(db);
  assert.equal(rows.length,4);
  assert.equal(rows.find(x=>x.type==="Loan issued").cashOut,1000);
  assert.equal(rows.find(x=>x.type==="Interest charged").charged,200);
  assert.equal(rows.find(x=>x.type==="Repayment (later reversed)").cashIn,300);
  assert.equal(rows.find(x=>x.type==="Repayment reversal").cashOut,300);
});
