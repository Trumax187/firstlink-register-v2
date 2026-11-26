import { totals, loanStatus, buildCashbookRows, allocateRepayments } from "./loans.js";

const safeCell = value => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const protectedValue = /^[=+@\\t\\r]/.test(raw) ? "'" + raw : raw;
  return '"' + protectedValue.replace(/"/g, '""') + '"';
};

export function toCsv(headers, rows) {
  return "\\uFEFF" + [headers, ...rows].map(row => row.map(safeCell).join(",")).join("\\r\\n");
}

export function buildExportDatasets(db, today = new Date()) {
  const customer = id => db.customers?.find(x => x.id === id);
  const collateral = id => db.collateral?.find(x => x.id === id);
  const cashbook = buildCashbookRows(db);
  const customers = (db.customers || []).map(c => [c.id,c.name,c.phone,c.nrc,c.area,c.createdAt]);
  const assets = (db.collateral || []).map(a => [a.id,customer(a.customerId)?.name,a.description,a.condition,a.estimatedValue,a.location,a.status,a.createdAt]);
  const loans = (db.loans || []).map(l => { const t=totals(l); return [l.id,customer(l.customerId)?.name,collateral(l.collateralId)?.description,l.issuedOn,l.dueOn,l.principal,t.charges,t.repayments,t.balance,loanStatus(l,today),l.renewals]; });
  const repayments = (db.loans || []).flatMap(l => { const allocations=new Map(allocateRepayments(l).map(x=>[x.id,x])); return (l.repayments || []).map(r => { const a=allocations.get(r.id); const reversal=(db.events || []).find(e=>e.type==="REVERSAL"&&e.repaymentId===r.id); return [r.id,l.id,customer(l.customerId)?.name,r.on,r.method,r.amount,r.status,r.status==="REVERSED"?(reversal?.interest ?? 0):(a?.interest ?? 0),r.status==="REVERSED"?(reversal?.principal ?? 0):(a?.principal ?? r.amount),r.reversedOn,r.reversalReason]; }); });
  const ledger = cashbook.map(r => [r.date,r.type,r.customer,r.description,r.charged || 0,r.cashOut || 0,r.cashIn || 0,r.interest || 0,r.principal || 0,r.id]);
  return {
    customers: { headers:["Customer ID","Full name","Phone","NRC","Area","Created at"], rows:customers },
    collateral: { headers:["Collateral ID","Customer","Description","Condition","Estimated value (K)","Storage location","Status","Created at"], rows:assets },
    loans: { headers:["Loan ID","Customer","Collateral","Issued on","Due on","Principal (K)","Interest charged (K)","Repayments (K)","Balance (K)","Status","Renewals"], rows:loans },
    repayments: { headers:["Repayment ID","Loan ID","Customer","Date","Method","Amount (K)","Status","Interest allocation (K)","Principal allocation (K)","Reversed on","Reversal reason"], rows:repayments },
    cashbook: { headers:["Date","Transaction","Customer","Description","Accrued interest (K)","Cash out (K)","Cash in (K)","Interest allocation (K)","Principal allocation (K)","Reference"], rows:ledger }
  };
}

export function buildReportSummary(db, today = new Date()) {
  const cashbook=buildCashbookRows(db);
  const loans=db.loans || [];
  const active=loans.filter(l=>["ACTIVE","OVERDUE"].includes(loanStatus(l,today)));
  return {
    totalLoans:loans.length,
    activeLoans:active.length,
    overdueLoans:loans.filter(l=>loanStatus(l,today)==="OVERDUE").length,
    principalOutstanding:active.reduce((sum,l)=>sum+Math.max(0,l.principal-allocateRepayments(l).reduce((paid,r)=>paid+r.principal,0)),0),
    outstanding:active.reduce((sum,l)=>sum+Math.max(0,totals(l).balance),0),
    interestCharged:loans.reduce((sum,l)=>sum+totals(l).charges,0),
    cashDisbursed:cashbook.filter(r=>r.type==="Loan issued").reduce((sum,r)=>sum+(r.cashOut||0),0),
    cashReversed:cashbook.filter(r=>r.type==="Repayment reversal").reduce((sum,r)=>sum+(r.cashOut||0),0),
    cashReceived:cashbook.reduce((sum,r)=>sum+(r.cashIn||0),0),
    collateralValue:(db.collateral||[]).filter(a=>a.status==="PLEDGED").reduce((sum,a)=>sum+Number(a.estimatedValue||0),0)
  };
}
