import test from "node:test";
import assert from "node:assert/strict";
import { createLoan, totals, recordRepayment, reverseRepayment, renewLoan, canDeleteLoan, allocateRepayments, buildCashbookRows } from "./loans.js";
import { buildExportDatasets, buildReportSummary, toCsv } from "./reports.js";
import { DEFAULT_LENDING_POLICY, normalizeLendingPolicy, validateLendingPolicy, loanDraftDefaults } from "./policies.js";
import { migrateV1Backup } from "./migration.js";

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


test("CSV exports include the register datasets and escape spreadsheet formulas", () => {
  const value=loan();
  const db={customers:[{id:"C1",name:"=1+1",phone:"0970000000"}],collateral:[{id:"A1",description:"Phone",estimatedValue:500,status:"PLEDGED"}],loans:[value],events:[]};
  const exports=buildExportDatasets(db,new Date("2026-11-15T00:00:00"));
  assert.deepEqual(Object.keys(exports),["customers","collateral","loans","repayments","cashbook"]);
  assert.match(toCsv(exports.customers.headers,exports.customers.rows),/'=1\+1/);
  assert.equal(exports.loans.rows[0][8],1200);
});

test("portfolio report separates principal, charges, cash and reversals", () => {
  const value=recordRepayment(loan(),{id:"R1",amount:300,on:"2026-11-05",method:"Cash"});
  const db={customers:[{id:"C1",name:"Test"}],collateral:[{id:"A1",description:"Phone",estimatedValue:500,status:"PLEDGED"}],loans:[value],events:[]};
  const report=buildReportSummary(db,new Date("2026-11-15T00:00:00"));
  assert.equal(report.principalOutstanding,900);
  assert.equal(report.outstanding,900);
  assert.equal(report.interestCharged,200);
  assert.equal(report.cashDisbursed,1000);
  assert.equal(report.cashReceived,300);
  assert.equal(report.collateralValue,500);
});


test("renewing an overdue loan starts the new term on the renewal date", () => {
  const renewed=renewLoan(loan(),{chargeId:"CH2",on:"2026-12-10"});
  assert.equal(renewed.dueOn,"2027-01-09");
  assert.equal(renewed.charges.at(-1).on,"2026-12-10");
});

test("lending policy defaults are normalized for older register data", () => {
  assert.deepEqual(normalizeLendingPolicy({forfeitGraceDays:10}),{...DEFAULT_LENDING_POLICY,forfeitGraceDays:10});
  assert.deepEqual(loanDraftDefaults({defaultInterestMode:"fixed",defaultInterestValue:75,defaultPeriodDays:14}),{mode:"fixed",interestValue:"75",periodDays:"14"});
});

test("lending policy validation accepts valid settings and rejects invalid ranges", () => {
  assert.deepEqual(validateLendingPolicy({forfeitGraceDays:0,defaultInterestMode:"percent",defaultInterestValue:12.5,defaultPeriodDays:30}),{forfeitGraceDays:0,defaultInterestMode:"percent",defaultInterestValue:12.5,defaultPeriodDays:30});
  assert.throws(()=>validateLendingPolicy({forfeitGraceDays:-1,defaultInterestMode:"percent",defaultInterestValue:10,defaultPeriodDays:30}));
  assert.throws(()=>validateLendingPolicy({forfeitGraceDays:7,defaultInterestMode:"monthly",defaultInterestValue:10,defaultPeriodDays:30}));
  assert.throws(()=>validateLendingPolicy({forfeitGraceDays:7,defaultInterestMode:"fixed",defaultInterestValue:-1,defaultPeriodDays:30}));
  assert.throws(()=>validateLendingPolicy({forfeitGraceDays:7,defaultInterestMode:"fixed",defaultInterestValue:10,defaultPeriodDays:0}));
});


test("V1 migration maps customers, collateral, loan terms and reversals without losing history", () => {
  const backup={app:"FirstLink",schemaVersion:1,data:{
    borrowers:[{id:"b1",name:"Test Borrower",phone:"0970000000",nrc:"123456/78/9",area:"Lusaka"}],
    items:[{id:"c1",borrowerId:"b1",desc:"Laptop",condition:"Good",value:5000,location:"Safe A",status:"held"}],
    loans:[{id:"l1",borrowerId:"b1",itemId:"c1",principal:1000,interest:{mode:"percent",value:20,periodDays:30},issuedOn:"2026-11-01",dueOn:"2026-12-01",status:"active",renewals:1,charges:[{id:"ch1",kind:"initial",amount:200,on:"2026-11-01",note:"Initial"},{id:"ch2",kind:"renewal",amount:200,on:"2026-11-20",note:"Renewal"}],repayments:[{id:"r2",amount:100,on:"2026-11-10",method:"Cash"}]}],
    events:[{id:"e1",loanId:"l1",at:"2026-11-05 09:00",text:"Loan issued"},{id:"e2",loanId:"l1",at:"2026-11-21 10:00",type:"repayment_reversal",repaymentId:"r1",amount:50,repaymentOn:"2026-11-15",method:"Mobile money",interest:50,principal:0,text:"Repayment reversed"}]
  }};
  const result=migrateV1Backup(backup);
  assert.equal(result.data.customers[0].id,"b1");
  assert.equal(result.data.collateral[0].status,"PLEDGED");
  assert.equal(result.data.loans[0].customerId,"b1");
  assert.equal(result.data.loans[0].charges[1].kind,"RENEWAL");
  assert.equal(result.data.loans[0].repayments.find(r=>r.id==="r1").status,"REVERSED");
  assert.equal(result.data.loans[0].repayments.find(r=>r.id==="r2").status,"POSTED");
  assert.equal(result.data.events.find(e=>e.id==="e2").type,"REVERSAL");
  assert.equal(result.sourceSummary.reversals,1);
  assert.equal(result.targetSummary.reversals,1);
  assert.equal(result.warnings.length,0);
});

test("V1 migration stops on broken references and duplicate IDs", () => {
  const bad={app:"FirstLink",schemaVersion:1,data:{borrowers:[{id:"b1",name:"A"},{id:"b1",name:"B"}],items:[],loans:[],events:[]}};
  assert.throws(()=>migrateV1Backup(bad),/duplicate ID/);
  const broken={app:"FirstLink",schemaVersion:1,data:{borrowers:[],items:[],loans:[{id:"l1",borrowerId:"missing",itemId:"missing",principal:100,issuedOn:"2026-11-01",dueOn:"2026-12-01",charges:[],repayments:[]}],events:[]}};
  assert.throws(()=>migrateV1Backup(broken),/missing borrower/);
});
