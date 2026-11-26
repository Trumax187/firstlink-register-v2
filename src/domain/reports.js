import { totals, loanStatus, buildCashbookRows, allocateRepayments } from "./loans.js";

const safeCell = value => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const protectedValue = typeof value === "string" && /^[=+\-@ \t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + protectedValue.replace(/"/g, '""') + '"';
};
const sum = (rows, key) => rows.reduce((n, row) => n + Number(row[key] || 0), 0);
const within = (date, from, to) => String(date || "") >= from && String(date || "") <= to;

export function toCsv(headers, rows) {
  return "\uFEFF" + [headers, ...rows].map(row => row.map(safeCell).join(",")).join("\r\n");
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
  const cashReceived=sum(cashbook,"cashIn");
  const cashReversed=sum(cashbook.filter(r=>r.type==="Repayment reversal"),"cashOut");
  return {
    totalLoans:loans.length, activeLoans:active.length,
    overdueLoans:loans.filter(l=>loanStatus(l,today)==="OVERDUE").length,
    principalOutstanding:active.reduce((s,l)=>s+Math.max(0,l.principal-allocateRepayments(l).reduce((p,r)=>p+r.principal,0)),0),
    outstanding:active.reduce((s,l)=>s+Math.max(0,totals(l).balance),0),
    interestCharged:sum(cashbook,"charged"),
    cashDisbursed:sum(cashbook.filter(r=>r.type==="Loan issued"),"cashOut"),
    cashReceived,cashReversed,netCashReceived:cashReceived-cashReversed,
    collateralValue:sum((db.collateral||[]).filter(a=>a.status==="PLEDGED"),"estimatedValue")
  };
}

export function buildPeriodReport(db, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error("Choose a valid reporting date range.");
  const rows=buildCashbookRows(db).filter(r=>within(r.date,from,to));
  const disbursements=rows.filter(r=>r.type==="Loan issued");
  const receipts=rows.filter(r=>r.type==="Repayment");
  const reversals=rows.filter(r=>r.type==="Repayment reversal");
  const charges=rows.filter(r=>r.type==="Interest charged" || r.type==="Renewal interest charged");
  const repayments=sum(receipts,"cashIn");
  const reversed=sum(reversals,"cashOut");
  const charged=sum(charges,"charged");
  return {
    from,to,transactionCount:rows.length,
    loansIssued:disbursements.length,principalDisbursed:sum(disbursements,"cashOut"),
    repaymentsReceived:repayments,reversedReceipts:reversed,netCollections:repayments-reversed,
    interestCharged:charged,interestCollected:sum(receipts,"interest")-sum(reversals,"interest"),
    principalCollected:sum(receipts,"principal")-sum(reversals,"principal"),
    netCashMovement:repayments-reversed-sum(disbursements,"cashOut"),
    rows
  };
}

export function buildPeriodExport(report) {
  const headers=["Date","Transaction","Customer","Description","Accrued interest (K)","Cash out (K)","Cash in (K)","Interest allocation (K)","Principal allocation (K)","Reference"];
  const rows=report.rows.map(r=>[r.date,r.type,r.customer,r.description,r.charged||0,r.cashOut||0,r.cashIn||0,r.interest||0,r.principal||0,r.id]);
  return {headers,rows};
}

export function reconcileRegister(db) {
  const errors=[],warnings=[];
  const unique=(records,label)=>{const ids=new Set();for(const x of records||[]){if(!x?.id)errors.push(label+" record is missing an ID.");else if(ids.has(x.id))errors.push(label+" has duplicate ID "+x.id+".");else ids.add(x.id);}return ids;};
  const customers=unique(db.customers,"Customer"),assets=unique(db.collateral,"Collateral"),loans=unique(db.loans,"Loan"),events=unique(db.events,"Event");
  const repayments=new Map();
  for(const loan of db.loans||[]){
    if(!customers.has(loan.customerId))errors.push("Loan "+loan.id+" refers to a missing customer.");
    if(!assets.has(loan.collateralId))errors.push("Loan "+loan.id+" refers to missing collateral.");
    else if((db.collateral||[]).find(a=>a.id===loan.collateralId)?.customerId!==loan.customerId)errors.push("Loan "+loan.id+" uses collateral assigned to another customer.");
    for(const r of loan.repayments||[]){if(repayments.has(r.id))errors.push("Duplicate repayment ID "+r.id+".");repayments.set(r.id,loan.id);if(!(Number(r.amount)>0)||!Number.isFinite(Number(r.amount)))errors.push("Repayment "+r.id+" has an invalid amount.");}
    for(const charge of loan.charges||[])if(!(Number(charge.amount)>=0)||!Number.isFinite(Number(charge.amount)))errors.push("Loan "+loan.id+" has an invalid charge.");
    if(totals(loan).balance < -0.01)warnings.push("Loan "+loan.id+" has a negative balance; investigate overpayment or legacy data.");
  }
  for(const asset of db.collateral||[]){
    if(!customers.has(asset.customerId))errors.push("Collateral "+asset.id+" refers to a missing customer.");
    const linked=(db.loans||[]).filter(l=>l.collateralId===asset.id);
    const open=linked.some(l=>!["CLEARED","FORFEITED"].includes(loanStatus(l)));
    if(open && asset.status!=="PLEDGED")warnings.push("Collateral "+asset.id+" has an outstanding loan but is marked "+asset.status+".");
    if(!open && asset.status==="PLEDGED")warnings.push("Collateral "+asset.id+" is marked pledged but has no outstanding loan.");
  }
  for(const event of db.events||[])if(event.type==="REVERSAL"){
    if(!loans.has(event.loanId))errors.push("Reversal "+event.id+" refers to a missing loan.");
    if(!repayments.has(event.repaymentId))errors.push("Reversal "+event.id+" refers to a missing repayment.");
    else if(repayments.get(event.repaymentId)!==event.loanId)errors.push("Reversal "+event.id+" refers to a repayment on a different loan.");
    if(!(Number(event.amount)>0))errors.push("Reversal "+event.id+" has an invalid amount.");
  }
  for(const loan of db.loans||[])for(const r of loan.repayments||[])if(r.status==="REVERSED" && !(db.events||[]).some(e=>e.type==="REVERSAL"&&e.repaymentId===r.id))warnings.push("Reversed repayment "+r.id+" has no matching reversal event.");
  const summary=buildReportSummary(db);
  const ledger=buildCashbookRows(db);
  const gross= sum(ledger,"cashIn"), reversal=sum(ledger.filter(r=>r.type==="Repayment reversal"),"cashOut");
  if(Math.abs((gross-reversal)-summary.netCashReceived)>0.01)errors.push("Cashbook net collections do not match the portfolio summary.");
  return {ok:errors.length===0,errors,warnings,counts:{customers:(db.customers||[]).length,collateral:(db.collateral||[]).length,loans:(db.loans||[]).length,repayments:repayments.size,events:events.size},financials:{principalOutstanding:summary.principalOutstanding,outstanding:summary.outstanding,netCashReceived:summary.netCashReceived}};
}
