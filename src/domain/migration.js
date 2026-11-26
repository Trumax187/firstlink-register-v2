import { DEFAULT_LENDING_POLICY } from "./policies.js";
import { totals } from "./loans.js";

const dateOnly = value => String(value || "").slice(0, 10);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const sum = (items, field) => (items || []).reduce((n, x) => n + Number(x?.[field] || 0), 0);

function assertUnique(records, label, errors) {
  const seen = new Set();
  for (const item of records) {
    if (!item?.id) errors.push(label + " record is missing an ID.");
    else if (seen.has(item.id)) errors.push(label + " contains duplicate ID " + item.id + ".");
    else seen.add(item.id);
  }
}

export function migrateV1Backup(backup) {
  const errors = [];
  const warnings = [];
  if (backup?.app !== "FirstLink" || backup?.schemaVersion !== 1) throw new Error("Select a FirstLink V1 JSON backup (app FirstLink, schema version 1).");
  const source = backup.data;
  if (!source || typeof source !== "object" || !["borrowers","items","loans","events"].every(k => Array.isArray(source[k]))) throw new Error("The V1 backup is missing borrowers, items, loans or events arrays.");
  for (const [list,label] of [[source.borrowers,"Customer"],[source.items,"Collateral"],[source.loans,"Loan"],[source.events,"Event"]]) assertUnique(list,label,errors);

  const borrowerIds = new Set(source.borrowers.map(x => x.id));
  const itemIds = new Set(source.items.map(x => x.id));
  const loanIds = new Set(source.loans.map(x => x.id));
  for (const item of source.items) if (!borrowerIds.has(item.borrowerId)) errors.push("Collateral " + item.id + " refers to missing borrower " + item.borrowerId + ".");
  for (const loan of source.loans) {
    if (!borrowerIds.has(loan.borrowerId)) errors.push("Loan " + loan.id + " refers to missing borrower " + loan.borrowerId + ".");
    if (!itemIds.has(loan.itemId)) errors.push("Loan " + loan.id + " refers to missing collateral " + loan.itemId + ".");
    else if (source.items.find(item=>item.id===loan.itemId)?.borrowerId !== loan.borrowerId) errors.push("Loan " + loan.id + " links a collateral item belonging to a different borrower.");
    if (!(Number(loan.principal) > 0) || !Number.isFinite(Number(loan.principal))) errors.push("Loan " + loan.id + " has an invalid principal.");
    if (!validDate(loan.issuedOn) || !validDate(loan.dueOn)) errors.push("Loan " + loan.id + " has an invalid issue or due date.");
    if (!Array.isArray(loan.charges) || !Array.isArray(loan.repayments)) errors.push("Loan " + loan.id + " is missing charges or repayments.");
  }
  if (errors.length) throw new Error("V1 migration stopped: " + errors.join(" "));

  const reversalEvents = source.events.filter(e => e.type === "repayment_reversal");
  const reversedIds = new Set();
  for (const event of reversalEvents) {
    if (!loanIds.has(event.loanId)) errors.push("Reversal event " + event.id + " refers to missing loan " + event.loanId + ".");
    if (!event.repaymentId || reversedIds.has(event.repaymentId)) errors.push("Reversal event " + event.id + " has a missing or duplicate repayment reference.");
    reversedIds.add(event.repaymentId);
    if (!(Number(event.amount) > 0) || !validDate(event.repaymentOn || dateOnly(event.at))) errors.push("Reversal event " + event.id + " has invalid payment details.");
  }
  if (errors.length) throw new Error("V1 migration stopped: " + errors.join(" "));

  const reversalsByLoan = new Map();
  for (const event of reversalEvents) {
    const list = reversalsByLoan.get(event.loanId) || [];
    list.push(event);
    reversalsByLoan.set(event.loanId,list);
  }
  function linkedBalance(loan) {
    const reversalIds = new Set((reversalsByLoan.get(loan.id) || []).map(e=>e.repaymentId));
    const repaid = (loan.repayments || []).filter(r=>!reversalIds.has(r.id)).reduce((n,r)=>n+Number(r.amount||0),0);
    return Number(loan.principal||0)+(loan.charges||[]).reduce((n,c)=>n+Number(c.amount||0),0)-repaid;
  }

  const customers = source.borrowers.map(b => ({
    id:b.id, name:String(b.name || "").trim(), phone:b.phone || "", nrc:b.nrc || "", area:b.area || "", createdAt:b.createdAt || null
  }));
  const collateral = source.items.map(item => {
    const linked = source.loans.filter(l => l.itemId === item.id);
    const open = linked.some(l => !["cleared","forfeited"].includes(String(l.status || "").toLowerCase()) && linkedBalance(l) > 0);
    let status;
    if (String(item.status).toLowerCase() === "forfeited" || linked.some(l => String(l.status).toLowerCase() === "forfeited")) status = "FORFEITED";
    else if (open) { status = "PLEDGED"; if (String(item.status).toLowerCase() === "released") warnings.push("Collateral " + item.id + " was marked released in V1 despite an outstanding loan; it was mapped to PLEDGED."); }
    else if (String(item.status).toLowerCase() === "released") status = "RELEASED";
    else status = "AVAILABLE";
    if (String(item.status).toLowerCase() === "held" && !open) warnings.push("Collateral " + item.id + " was marked held in V1 but has no open loan; it was mapped to AVAILABLE.");
    return { id:item.id, customerId:item.borrowerId, description:item.desc || "Unspecified collateral", condition:item.condition || "", estimatedValue:Number(item.value || 0), location:item.location || "", status, createdAt:item.createdAt || null };
  });

  const loans = source.loans.map(l => {
    const reversals = reversalsByLoan.get(l.id) || [];
    const repayments = [
      ...(l.repayments || []).map(r=>({...r,status:"POSTED"})),
      ...reversals.map(e=>({id:e.repaymentId,amount:Number(e.amount),on:e.repaymentOn || dateOnly(e.at),method:e.method || "Unknown",status:"REVERSED",reversedOn:dateOnly(e.at),reversalId:e.id,reversalReason:e.text || "Reversed in V1"}))
    ];
    const charges = l.charges.map(c=>({...c,kind:String(c.kind || "initial").toUpperCase()}));
    const forfeited = String(l.status || "").toLowerCase() === "forfeited";
    return {
      id:l.id, customerId:l.borrowerId, collateralId:l.itemId, principal:Number(l.principal),
      interest:{mode:l.interest?.mode || "percent",value:Number(l.interest?.value || 0),periodDays:Number(l.interest?.periodDays || 30)},
      issuedOn:l.issuedOn,dueOn:l.dueOn,status:forfeited?"FORFEITED":"ACTIVE",renewals:Number(l.renewals || 0),
      charges,repayments
    };
  });

  const events = source.events.map(e => {
    const reversal = e.type === "repayment_reversal";
    const text = e.text || (reversal ? "Repayment reversed in V1" : "Imported V1 activity");
    return {
      id:e.id, type:reversal?"REVERSAL":(text.toLowerCase().startsWith("collateral forfeited") || text.toLowerCase().startsWith("forfeited") ? "FORFEITURE" : "LEGACY"),
      loanId:e.loanId || null, at:normalizeTimestamp(e.at), text,
      ...(reversal?{repaymentId:e.repaymentId,amount:Number(e.amount),method:e.method || "Unknown",on:dateOnly(e.at),reason:e.text || "Reversed in V1",interest:Number(e.interest || 0),principal:Number(e.principal ?? e.amount)}:{})
    };
  });

  for (const l of loans) if (totals(l).balance < -0.01) warnings.push("Loan " + l.id + " has repayments greater than its total charges and principal; review it after import.");
  const data = { customers, collateral, loans, events, settings:{...DEFAULT_LENDING_POLICY} };
  const sourceSummary = {
    customers:customers.length,collateral:collateral.length,loans:loans.length,
    repayments:source.loans.reduce((n,l)=>n+l.repayments.length,0)+reversalEvents.length,
    reversals:reversalEvents.length,events:source.events.length,
    totalPrincipal:sum(source.loans,"principal"),
    totalCharges:source.loans.reduce((n,l)=>n+sum(l.charges,"amount"),0),
    postedRepayments:source.loans.reduce((n,l)=>n+sum(l.repayments,"amount"),0)
  };
  const targetSummary = {
    customers:data.customers.length,collateral:data.collateral.length,loans:data.loans.length,
    repayments:data.loans.reduce((n,l)=>n+l.repayments.length,0),
    reversals:data.loans.reduce((n,l)=>n+l.repayments.filter(r=>r.status==="REVERSED").length,0),
    events:data.events.length,
    totalPrincipal:sum(data.loans,"principal"),
    totalCharges:data.loans.reduce((n,l)=>n+sum(l.charges,"amount"),0),
    postedRepayments:data.loans.reduce((n,l)=>n+sum(l.repayments.filter(r=>r.status!=="REVERSED"),"amount"),0)
  };
  return { data, warnings, sourceSummary, targetSummary };
}

function normalizeTimestamp(value) {
  if (!value) return new Date().toISOString();
  const text=String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return text.replace(" ","T")+":00";
  return text;
}
