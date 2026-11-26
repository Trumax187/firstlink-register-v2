import React, { useEffect, useMemo, useState } from "react";
import { createLoan, totals, loanStatus, recordRepayment, reverseRepayment, renewLoan, daysLate, allocateRepayments, buildCashbookRows, FORFEIT_GRACE_DAYS } from "./domain/loans.js";
import { buildExportDatasets, buildReportSummary, buildPeriodReport, buildPeriodExport, reconcileRegister, toCsv } from "./domain/reports.js";
import { DEFAULT_LENDING_POLICY, normalizeLendingPolicy, validateLendingPolicy, loanDraftDefaults } from "./domain/policies.js";
import { migrateV1Backup } from "./domain/migration.js";

const KEY = "firstlink.register.v2";
const empty = { customers: [], collateral: [], loans: [], events: [], settings: DEFAULT_LENDING_POLICY };
const makeId = (prefix) => prefix + "-" + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
};
const kwacha = (n) => "K" + Number(n || 0).toLocaleString("en-ZM", { minimumFractionDigits:2, maximumFractionDigits:2 });
const dateLabel = (s) => s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const escapeHtml = value => String(value ?? "").replace(/[&<>\"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[ch]));
const validData = (x) => x && typeof x === "object" && ["customers","collateral","loans","events"].every(k => Array.isArray(x[k]));
function readStore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { data: empty, error: "" };
    const parsed = JSON.parse(raw);
    if (!validData(parsed)) throw new Error("The saved V2 register has an invalid structure.");
    return { data: parsed, error: "" };
  } catch (e) { return { data: empty, error: e.message || "Saved data could not be read." }; }
}
function Field({ label, children, hint }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function Empty({ children = "Nothing to show yet." }) { return <div className="empty">{children}</div>; }
function Status({ value }) { return <span className={"status " + value.toLowerCase()}>{value}</span>; }

export default function App() {
  const [initial] = useState(readStore);
  const [db,setDb] = useState(initial.data);
  const [storageError,setStorageError] = useState(initial.error);
  const [tab,setTab] = useState("dashboard");
  const [query,setQuery] = useState("");
  const [notice,setNotice] = useState("");
  const [selectedLoan,setSelectedLoan] = useState(null);
  const [selectedCustomer,setSelectedCustomer] = useState(null);
  const [form,setForm] = useState("");
  const [draft,setDraft] = useState({});
  const [confirm,setConfirm] = useState(null);
  const [policyDraft,setPolicyDraft] = useState(()=>normalizeLendingPolicy(initial.data.settings));
  const [migrationPreview,setMigrationPreview] = useState(null);
  const [reportFrom,setReportFrom] = useState(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),"01"].join("-");});
  const [reportTo,setReportTo] = useState(today);

  useEffect(() => {
    if (storageError) return;
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch { setStorageError("Browser storage is unavailable or full. Export a backup and check browser storage."); }
  }, [db,storageError]);

  const customers = db.customers;
  const collateral = db.collateral;
  const loans = db.loans;
  const findCustomer = id => customers.find(x => x.id === id);
  const findCollateral = id => collateral.find(x => x.id === id);
  const activeLoans = loans.filter(x => ["ACTIVE","OVERDUE"].includes(loanStatus(x)));
  const overdueLoans = loans.filter(x => loanStatus(x) === "OVERDUE");
  const totalOutstanding = activeLoans.reduce((s,x) => s + totals(x).balance,0);
  const report = buildReportSummary(db);
  const periodReport = buildPeriodReport(db,reportFrom,reportTo);
  const reconciliation = reconcileRegister(db);
  const visibleLoans = useMemo(() => loans.filter(l => {
    const c = findCustomer(l.customerId), a = findCollateral(l.collateralId);
    return [c?.name,c?.phone,a?.description,l.id].join(" ").toLowerCase().includes(query.toLowerCase());
  }), [loans,customers,collateral,query]);
  const pushEvent = (type, text, loanId = null, extra = {}) => ({ id:makeId("EV"), type, text, loanId, at:new Date().toISOString(), ...extra });
  const save = fn => {
    if (storageError) { setNotice("Saving is blocked until the existing data problem is resolved."); return false; }
    try { const next = fn(db); if (!validData(next)) throw new Error("Invalid register data."); setDb(next); return true; }
    catch (e) { setNotice(e.message || "Could not save this change."); return false; }
  };
  const begin = (kind, values = {}) => {
    if (kind === "loan") { setDraft({...loanDraftDefaults(db.settings),...values}); }
    else setDraft(values);
    setForm(kind);
  };
  const finish = () => { setForm(""); setDraft({}); };


  function printPage(title, content) {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { setNotice("Allow pop-ups to print this document."); return; }
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><meta charset="utf-8"><style>body{font:14px Arial,sans-serif;color:#172b45;margin:36px;line-height:1.5}header{border-bottom:3px solid #c08a22;padding-bottom:16px;margin-bottom:24px}h1{font-size:24px;margin:0;color:#142d4e}h2{font-size:16px;color:#142d4e;margin:24px 0 8px}.muted{color:#64748b;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.box{border:1px solid #dbe2ea;border-radius:7px;padding:12px}.line{display:flex;justify-content:space-between;border-bottom:1px solid #e8edf2;padding:9px 0}.line:last-child{border:0}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:70px}.signatures div{border-top:1px solid #64748b;padding-top:8px}.footer{margin-top:36px;border-top:1px solid #dbe2ea;padding-top:12px;font-size:11px;color:#64748b}@media print{body{margin:18mm}}</style></head><body><header><h1>FIRSTLINK FINANCIAL SOLUTIONS</h1><div class="muted">Collateral Loan Register · ${escapeHtml(title)}</div></header>${content}<div class="footer">Generated from FirstLink Register V2. Keep this document with the customer's loan records.</div><script>window.onload=()=>window.print()<\/script></body></html>`);
    win.document.close();
  }
  function printAgreement(loanRecord) {
    const customer=findCustomer(loanRecord.customerId), asset=findCollateral(loanRecord.collateralId);
    const content=`<h2>LOAN AGREEMENT</h2><div class="grid"><div class="box"><b>Customer</b><p>${escapeHtml(customer?.name)}<br>Phone: ${escapeHtml(customer?.phone || "—")}<br>NRC: ${escapeHtml(customer?.nrc || "—")}<br>Area: ${escapeHtml(customer?.area || "—")}</p></div><div class="box"><b>Loan reference</b><p>${escapeHtml(loanRecord.id)}<br>Issued: ${dateLabel(loanRecord.issuedOn)}<br>Due: ${dateLabel(loanRecord.dueOn)}</p></div></div><h2>Loan terms</h2><div class="line"><span>Principal advanced</span><b>${kwacha(loanRecord.principal)}</b></div><div class="line"><span>Initial interest charge</span><b>${kwacha(loanRecord.charges?.[0]?.amount || 0)}</b></div><div class="line"><span>Total due at issue</span><b>${kwacha(loanRecord.principal+(loanRecord.charges?.[0]?.amount || 0))}</b></div><div class="line"><span>Interest basis</span><b>${escapeHtml(loanRecord.interest?.mode==="percent"?loanRecord.interest.value+"% of principal":kwacha(loanRecord.interest?.value))}</b></div><div class="line"><span>Loan period</span><b>${escapeHtml(loanRecord.interest?.periodDays)} days</b></div><h2>Pledged collateral</h2><div class="box"><b>${escapeHtml(asset?.description || "—")}</b><p>Condition: ${escapeHtml(asset?.condition || "Not recorded")}<br>Estimated value: ${kwacha(asset?.estimatedValue || 0)}<br>Storage location: ${escapeHtml(asset?.location || "Not recorded")}</p></div><p class="muted">The parties acknowledge the loan amount, charges, repayment due date and collateral details recorded above. Any additional terms must be written and agreed by both parties.</p><div class="signatures"><div>Customer signature / date</div><div>Authorised representative / date</div></div>`;
    printPage("Loan Agreement",content);
  }
  function printReceipt(loanRecord, repayment) {
    const customer=findCustomer(loanRecord.customerId);
    const allocation=allocateRepayments(loanRecord).find(x=>x.id===repayment.id);
    const content=`<h2>REPAYMENT RECEIPT</h2><div class="grid"><div class="box"><b>Received from</b><p>${escapeHtml(customer?.name)}<br>Phone: ${escapeHtml(customer?.phone || "—")}</p></div><div class="box"><b>Receipt details</b><p>Receipt: ${escapeHtml(repayment.id)}<br>Loan: ${escapeHtml(loanRecord.id)}<br>Date: ${dateLabel(repayment.on)}<br>Method: ${escapeHtml(repayment.method || "—")}</p></div></div><h2>Payment allocation</h2><div class="line"><span>Total received</span><b>${kwacha(repayment.amount)}</b></div><div class="line"><span>Allocated to interest</span><b>${kwacha(allocation?.interest || 0)}</b></div><div class="line"><span>Allocated to principal</span><b>${kwacha(allocation?.principal || 0)}</b></div><div class="line"><span>Current outstanding balance</span><b>${kwacha(totals(loanRecord).balance)}</b></div><p class="muted">This receipt confirms the payment recorded above. Retain it for your records.</p><div class="signatures"><div>Customer acknowledgement</div><div>Received by / date</div></div>`;
    printPage("Repayment Receipt",content);
  }
  function savePolicy(e) {
    e.preventDefault();
    if (storageError) return setNotice("Resolve the browser storage warning before changing lending policies.");
    try {
      const next=validateLendingPolicy(policyDraft);
      save(s=>({...s,settings:next}));
      setPolicyDraft(next);
      setNotice("Lending policies saved. They apply to new loans only; existing loan terms remain unchanged.");
    } catch(error) { setNotice(error.message); }
  }

  function submitCustomer(e) {
    e.preventDefault();
    const name = draft.name?.trim();
    if (!name) return setNotice("Enter the customer's full name.");
    save(s => ({...s,customers:[...s.customers,{id:makeId("CUS"),name,phone:draft.phone?.trim() || "",nrc:draft.nrc?.trim() || "",area:draft.area?.trim() || "",createdAt:new Date().toISOString()}]}));
    finish(); setNotice("Customer saved.");
  }
  function submitCollateral(e) {
    e.preventDefault();
    if (!draft.customerId || !draft.description?.trim()) return setNotice("Select a customer and describe the collateral.");
    save(s => ({...s,collateral:[...s.collateral,{id:makeId("COL"),customerId:draft.customerId,description:draft.description.trim(),condition:draft.condition?.trim() || "",estimatedValue:Number(draft.estimatedValue || 0),location:draft.location?.trim() || "",status:"AVAILABLE",createdAt:new Date().toISOString()}]}));
    finish(); setNotice("Collateral saved.");
  }
  function submitLoan(e) {
    e.preventDefault();
    try {
      const asset = findCollateral(draft.collateralId);
      if (!asset || asset.customerId !== draft.customerId) throw new Error("Choose collateral belonging to the selected customer.");
      if (asset.status !== "AVAILABLE") throw new Error("This collateral is already linked to an active loan.");
      const loan = createLoan({id:makeId("LN"),customerId:draft.customerId,collateralId:draft.collateralId,principal:Number(draft.principal),mode:draft.mode,value:Number(draft.interestValue),periodDays:Number(draft.periodDays),issuedOn:today()});
      save(s => ({...s,loans:[...s.loans,loan],collateral:s.collateral.map(x => x.id === asset.id ? {...x,status:"PLEDGED"} : x),events:[...s.events,pushEvent("LOAN_ISSUED","Loan issued for "+kwacha(loan.principal),loan.id)]}));
      finish(); setSelectedLoan(loan.id); setTab("loans"); setNotice("Loan created.");
    } catch(e) { setNotice(e.message); }
  }
  function submitExpense(e) {
    e.preventDefault();
    const amount=Number(draft.amount);
    const category=String(draft.category||"").trim();
    const description=String(draft.description||"").trim();
    if (!(Number.isFinite(amount) && amount>0)) return setNotice("Enter an expense amount greater than zero.");
    if (!category) return setNotice("Choose an expense category.");
    const event=pushEvent("EXPENSE","Expense recorded: "+category+" · "+kwacha(amount),null,{amount:Math.round(amount*100)/100,on:today(),category,description,method:draft.method||"Cash"});
    if(save(s=>({...s,events:[...s.events,event]}))){finish();setNotice("Operating expense recorded in the cashbook.");}
  }
  function reverseExpense(id) {
    const expense=db.events.find(event=>event.id===id&&event.type==="EXPENSE");
    if(!expense) return setNotice("Expense record was not found.");
    if(db.events.some(event=>event.type==="EXPENSE_REVERSAL"&&event.expenseId===id)) return setNotice("This expense has already been reversed.");
    const reason=window.prompt("Reason for reversing this expense:");
    if(!reason?.trim()) return;
    const reversal=pushEvent("EXPENSE_REVERSAL","Expense reversal: "+reason.trim(),null,{expenseId:id,amount:expense.amount,on:today(),category:expense.category,reason:reason.trim(),method:expense.method||"Cash"});
    if(save(s=>({...s,events:[...s.events,reversal]}))) setNotice("Expense reversal recorded; original expense retained.");
  }
  function submitRepayment(e) {
    e.preventDefault();
    const loan = loans.find(x => x.id === selectedLoan);
    try {
      if (!loan) throw new Error("Select a loan first.");
      const repayment = {id:makeId("PAY"),amount:Number(draft.amount),on:today(),method:draft.method || "Cash"};
      const updated = recordRepayment(loan,repayment);
      const allocation = allocateRepayments(updated).find(r => r.id === repayment.id);
      save(s => ({...s,loans:s.loans.map(x => x.id === loan.id ? updated : x),collateral:s.collateral.map(x => x.id === loan.collateralId && totals(updated).balance <= 0 ? {...x,status:"RELEASED"} : x),events:[...s.events,pushEvent("REPAYMENT","Repayment "+kwacha(repayment.amount)+" ("+repayment.method+")",loan.id,{repaymentId:repayment.id,amount:repayment.amount,on:repayment.on,method:repayment.method,interest:allocation?.interest ?? 0,principal:allocation?.principal ?? repayment.amount})]}));
      finish(); setNotice("Repayment recorded.");
    } catch(e) { setNotice(e.message); }
  }
  function renew(id) {
    const loan = loans.find(x => x.id === id); if (!loan) return;
    try {
      const updated = renewLoan(loan,{chargeId:makeId("CH"),on:today()});
      save(s => ({...s,loans:s.loans.map(x => x.id === id ? updated : x),events:[...s.events,pushEvent("RENEWAL","Loan renewed; charge "+kwacha(updated.charges.at(-1).amount),id)]}));
      setNotice("Loan renewed.");
    } catch(e) { setNotice(e.message); }
  }
  function reverse(id, repaymentId) {
    const loan = loans.find(x => x.id === id); if (!loan) return;
    const reason = window.prompt("Reason for reversing this repayment:");
    if (!reason?.trim()) return;
    try {
      const allocation = allocateRepayments(loan).find(r => r.id === repaymentId);
      const original = loan.repayments.find(r => r.id === repaymentId);
      const updated = reverseRepayment(loan,repaymentId,{reversalId:makeId("REV"),on:today(),reason:reason.trim()});
      save(s => ({...s,loans:s.loans.map(x => x.id === id ? updated : x),collateral:s.collateral.map(x => x.id === loan.collateralId && loanStatus(updated) !== "CLEARED" && x.status === "RELEASED" ? {...x,status:"PLEDGED"} : x),events:[...s.events,pushEvent("REVERSAL","Repayment reversed: "+reason.trim(),id,{repaymentId,amount:original?.amount || 0,method:original?.method || "—",on:today(),reason:reason.trim(),interest:allocation?.interest ?? null,principal:allocation?.principal ?? null})]}));
      setNotice("Repayment reversal recorded; original record retained.");
    } catch(e) { setNotice(e.message); }
  }
  function forfeit(id) {
    const loan = loans.find(x => x.id === id); if (!loan) return;
    if (daysLate(loan) < Number(db.settings?.forfeitGraceDays ?? FORFEIT_GRACE_DAYS)) return setNotice("The configured grace period has not elapsed.");
    if (!window.confirm("Record collateral as forfeited? This action is retained in the register.")) return;
    save(s => ({...s,loans:s.loans.map(x => x.id === id ? {...x,status:"FORFEITED"} : x),collateral:s.collateral.map(x => x.id === loan.collateralId ? {...x,status:"FORFEITED"} : x),events:[...s.events,pushEvent("FORFEITURE","Collateral forfeited",id)]}));
    setNotice("Forfeiture recorded.");
  }
  function removeCustomer(id) {
    const used = collateral.some(x => x.customerId === id) || loans.some(x => x.customerId === id);
    if (used) return setNotice("This customer has collateral or loan history and cannot be deleted.");
    if (window.confirm("Delete this customer record?")) save(s => ({...s,customers:s.customers.filter(x => x.id !== id)}));
  }
  function removeCollateral(id) {
    if (loans.some(x => x.collateralId === id)) return setNotice("Collateral linked to a loan cannot be deleted.");
    if (window.confirm("Delete this collateral record?")) save(s => ({...s,collateral:s.collateral.filter(x => x.id !== id)}));
  }
  function exportBackup() {
    const backup = {app:"FirstLink Register",schemaVersion:2,exportedAt:new Date().toISOString(),data:db};
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}));
    const a = document.createElement("a"); a.href=url; a.download="firstlink-v2-backup-"+today()+".json"; a.click(); URL.revokeObjectURL(url);
    setNotice("Backup downloaded.");
  }

  function downloadPeriodCsv() {
    const dataset=buildPeriodExport(periodReport);
    const blob=new Blob([toCsv(dataset.headers,dataset.rows)],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="firstlink-period-cashbook-"+reportFrom+"-to-"+reportTo+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setNotice("Period cashbook CSV exported.");
  }
  function downloadCsv(name) {
    const dataset=buildExportDatasets(db)[name];
    if (!dataset) return setNotice("That export is not available.");
    const blob=new Blob([toCsv(dataset.headers,dataset.rows)],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download="firstlink-v2-"+name+"-"+today()+".csv"; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setNotice(name.charAt(0).toUpperCase()+name.slice(1)+" CSV exported.");
  }
  function readV1Migration(file) {
    if (!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try {
        const result=migrateV1Backup(JSON.parse(reader.result));
        setMigrationPreview({...result,sourceFile:file.name});
        setNotice("V1 backup validated. Review the reconciliation preview before importing.");
      } catch(error) {
        setMigrationPreview(null);
        setNotice(error.message || "Could not prepare this V1 backup.");
      }
    };
    reader.onerror=()=>setNotice("Could not read the selected V1 backup.");
    reader.readAsText(file);
  }
  function commitV1Migration() {
    if (!migrationPreview) return;
    if (storageError) return setNotice("Resolve the browser storage warning before importing V1 data.");
    if (!window.confirm("Import these V1 records into V2? This replaces all current V2 records. Keep the original V1 backup unchanged.")) return;
    if (save(()=>migrationPreview.data)) {
      setPolicyDraft(normalizeLendingPolicy(migrationPreview.data.settings));
      setMigrationPreview(null);
      setSelectedLoan(null); setSelectedCustomer(null); setTab("dashboard");
      setNotice("V1 records imported into V2. Keep the original V1 backup as a separate archive.");
    }
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const b = JSON.parse(reader.result);
        if (b.app !== "FirstLink Register" || b.schemaVersion !== 2 || !validData(b.data)) throw new Error("This is not a valid FirstLink V2 backup.");
        if (!window.confirm("Restore this backup? Current V2 records will be replaced.")) return;
        setStorageError(""); setDb(b.data); setPolicyDraft(normalizeLendingPolicy(b.data.settings)); setNotice("Backup restored.");
      } catch(e) { setNotice(e.message); }
    };
    reader.readAsText(file);
  }

  const tabs = [["dashboard","Dashboard"],["loans","Loans"],["customers","Customers"],["collateral","Collateral"],["cashbook","Cashbook"],["settings","Settings & Data"]];
  const title = tabs.find(x => x[0] === tab)?.[1] || "Dashboard";
  const loan = loans.find(x => x.id === selectedLoan);
  const customerCollateral = draft.customerId ? collateral.filter(x => x.customerId === draft.customerId && x.status === "AVAILABLE") : collateral.filter(x => x.status === "AVAILABLE");

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img src="https://raw.githubusercontent.com/Trumax187/firstlink-register/main/logo.jpeg" alt="FirstLink logo"/><div><b>FirstLink</b><small>Collateral Loan Register</small></div></div>
      <nav>{tabs.map(([id,label]) => <button key={id} className={tab===id?"nav active":"nav"} onClick={()=>{setTab(id);setForm("");}}><span className="nav-dot"/>{label}</button>)}</nav>
      <div className="side-foot">V2.0 · Independent rebuild</div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">FIRSTLINK FINANCIAL SOLUTIONS</span><h1>{title}</h1></div><div className="top-actions"><input aria-label="Search register" placeholder="Search customers, loans..." value={query} onChange={e=>setQuery(e.target.value)}/><span className="user-pill">E</span></div></header>
      <div className="content">
        {storageError && <div className="alert danger" role="alert"><b>Data protection warning:</b> {storageError} Existing V2 data has not been overwritten. Export/import and editing are blocked until resolved.</div>}
        {notice && <div className="alert" role="status">{notice}<button onClick={()=>setNotice("")} aria-label="Dismiss message">×</button></div>}
        {tab==="dashboard" && <><div className="welcome"><div><span className="eyebrow">OVERVIEW</span><h2>Good day, Edina</h2><p>Here is the current position of your lending register.</p></div><button className="primary" onClick={()=>begin("loan")}>＋ New loan</button></div>
          <section className="metrics"><Metric label="Active loans" value={activeLoans.length}/><Metric label="Overdue loans" value={overdueLoans.length} warn={overdueLoans.length>0}/><Metric label="Outstanding balance" value={kwacha(totalOutstanding)}/><Metric label="Customers" value={customers.length}/></section>
          <Panel title="Loans requiring attention"><LoanRows items={overdueLoans.slice(0,5)} findCustomer={findCustomer} findCollateral={findCollateral} onOpen={id=>{setSelectedLoan(id);setTab("loans");}}/></Panel>
          <Panel title="Portfolio report"><div className="report-grid"><Metric label="Total loans" value={report.totalLoans}/><Metric label="Principal outstanding" value={kwacha(report.principalOutstanding)}/><Metric label="Interest charged" value={kwacha(report.interestCharged)}/><Metric label="Cash disbursed" value={kwacha(report.cashDisbursed)}/><Metric label="Cash received (gross)" value={kwacha(report.cashReceived)}/><Metric label="Reversed receipts" value={kwacha(report.cashReversed)}/><Metric label="Net cash received" value={kwacha(report.netCashReceived)}/><Metric label="Pledged collateral value" value={kwacha(report.collateralValue)}/></div><p className="panel-copy">All-time register totals. Interest charged is accrued revenue, not cash received. Gross receipts include reversed payments; reversed amounts are shown separately and deducted in net cash received. Outstanding balances include unpaid charges and principal.</p><div className="actions report-actions"><button className="secondary" onClick={()=>downloadCsv("loans")}>Export loans CSV</button><button className="secondary" onClick={()=>downloadCsv("cashbook")}>Export cashbook CSV</button></div></Panel><Panel title="Monthly and period financial report"><p className="panel-copy">Choose a reporting period. Figures below are based on transactions dated within the selected range. Interest charged is accrued, not cash collected.</p><div className="period-controls"><Field label="From"><input type="date" value={reportFrom} max={reportTo} onChange={e=>setReportFrom(e.target.value)}/></Field><Field label="To"><input type="date" value={reportTo} min={reportFrom} onChange={e=>setReportTo(e.target.value)}/></Field><button className="secondary" onClick={()=>{const d=new Date();setReportFrom([d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),"01"].join("-"));setReportTo(today());}}>Current month</button></div><div className="report-grid"><Metric label="Loans issued" value={periodReport.loansIssued}/><Metric label="Principal disbursed" value={kwacha(periodReport.principalDisbursed)}/><Metric label="Repayments received" value={kwacha(periodReport.repaymentsReceived)}/><Metric label="Reversed receipts" value={kwacha(periodReport.reversedReceipts)}/><Metric label="Net collections" value={kwacha(periodReport.netCollections)}/><Metric label="Interest charged" value={kwacha(periodReport.interestCharged)}/><Metric label="Interest collected" value={kwacha(periodReport.interestCollected)}/><Metric label="Principal collected" value={kwacha(periodReport.principalCollected)}/><Metric label="Net cash movement" value={kwacha(periodReport.netCashMovement)}/><Metric label="Transactions" value={periodReport.transactionCount}/></div><p className="panel-copy">Net cash movement = collections less reversals and loan principal disbursements. It excludes operating expenses, owner deposits and withdrawals because those are not currently recorded in FirstLink.</p><div className="actions"><button className="secondary" onClick={downloadPeriodCsv}>Export selected period CSV</button></div></Panel><Panel title="Recent activity"><Events events={db.events.slice(-6).reverse()}/></Panel>
        </>}
        {tab==="customers" && <><div className="page-actions"><p>Customer records, contact details and complete lending history. Select a customer to open their profile.</p><button className="primary" onClick={()=>begin("customer")}>＋ Add customer</button></div><Panel title={"Customers ("+customers.length+")"}><div className="record-list">{customers.filter(x=>(x.name+" "+x.phone+" "+x.nrc+" "+x.area).toLowerCase().includes(query.toLowerCase())).map(c=><div className="record" key={c.id}><button className="customer-open" onClick={()=>setSelectedCustomer(c.id)}><b>{c.name}</b><small>{c.phone || "No phone"} · NRC: {c.nrc || "Not recorded"} · {c.area || "Area not recorded"}</small></button><button className="quiet danger-text" onClick={()=>removeCustomer(c.id)}>Delete</button></div>)}</div>{!customers.length&&<Empty>No customers have been added.</Empty>}</Panel>
          {selectedCustomer && (()=>{const person=customers.find(x=>x.id===selectedCustomer);if(!person)return null;const personLoans=loans.filter(x=>x.customerId===person.id).slice().sort((a,b)=>String(b.issuedOn).localeCompare(String(a.issuedOn)));const personAssets=collateral.filter(x=>x.customerId===person.id);const personEvents=db.events.filter(e=>personLoans.some(l=>l.id===e.loanId)).slice().reverse();const outstanding=personLoans.reduce((sum,l)=>sum+Math.max(0,totals(l).balance),0);return <div className="detail-backdrop" onClick={()=>setSelectedCustomer(null)}><section className="detail customer-detail" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setSelectedCustomer(null)}>×</button><span className="eyebrow">CUSTOMER PROFILE</span><h2>{person.name}</h2><p>{person.phone || "Phone not recorded"} · {person.area || "Area not recorded"}</p><div className="detail-total"><small>Total outstanding across customer loans</small><strong>{kwacha(outstanding)}</strong><span>{personLoans.length} loan record(s) · {personAssets.length} collateral item(s)</span></div><h3>Contact and identification</h3><div className="detail-grid"><div><small>Phone</small><b>{person.phone || "—"}</b></div><div><small>NRC</small><b>{person.nrc || "—"}</b></div><div><small>Area</small><b>{person.area || "—"}</b></div><div><small>Customer since</small><b>{person.createdAt?new Date(person.createdAt).toLocaleDateString("en-GB"):"—"}</b></div></div><h3>Collateral history</h3>{personAssets.length?personAssets.map(a=><div className="record" key={a.id}><div><b>{a.description}</b><small>{a.location || "Storage not recorded"} · Estimated {kwacha(a.estimatedValue)}</small></div><Status value={a.status}/></div>):<Empty>No collateral recorded.</Empty>}<h3>Loan history</h3>{personLoans.length?personLoans.map(l=><div className="customer-history-loan" key={l.id}><div className="history-head"><div><b>{kwacha(l.principal)} principal</b><small>{dateLabel(l.issuedOn)} · Due {dateLabel(l.dueOn)}</small></div><Status value={loanStatus(l)}/></div><div className="history-stats"><span>Outstanding <b>{kwacha(totals(l).balance)}</b></span><span>Interest charged <b>{kwacha(totals(l).charges)}</b></span><span>Repaid <b>{kwacha(totals(l).repayments)}</b></span></div><button className="secondary" onClick={()=>{setSelectedCustomer(null);setSelectedLoan(l.id);setTab("loans");}}>Open loan record</button>{(l.repayments||[]).length>0&&<div className="history-payments">{l.repayments.map(r=><div key={r.id}><span>{dateLabel(r.on)} · {r.method} · {r.status}</span><b>{kwacha(r.amount)}</b></div>)}</div>}</div>):<Empty>No loans recorded.</Empty>}<h3>Account activity</h3>{personEvents.length?personEvents.map(e=><div className="event" key={e.id}><span className="event-mark"/><div><b>{e.text}</b><small>{new Date(e.at).toLocaleString("en-GB")}</small></div></div>):<Empty>No account activity recorded.</Empty>}</section></div>})()}
        </>}
        {tab==="collateral" && <><div className="page-actions"><p>Items pledged as security for loans.</p><button className="primary" onClick={()=>begin("collateral")}>＋ Add collateral</button></div><Panel title={"Collateral ("+collateral.length+")"}><div className="record-list">{collateral.filter(x=>(x.description+" "+findCustomer(x.customerId)?.name).toLowerCase().includes(query.toLowerCase())).map(a=><div className="record" key={a.id}><div><b>{a.description}</b><small>{findCustomer(a.customerId)?.name || "Unknown customer"} · {a.location || "Storage not recorded"} · {kwacha(a.estimatedValue)}</small></div><div className="record-end"><Status value={a.status}/>{a.status==="AVAILABLE"&&<button className="quiet danger-text" onClick={()=>removeCollateral(a.id)}>Delete</button>}</div></div>)}</div>{!collateral.length&&<Empty>No collateral has been added.</Empty>}</Panel></>}
        {tab==="loans" && <><div className="page-actions"><p>Loan register, balances, renewals and repayments.</p><button className="primary" onClick={()=>begin("loan")}>＋ New loan</button></div><Panel title={"All loans ("+visibleLoans.length+")"}><LoanRows items={visibleLoans} findCustomer={findCustomer} findCollateral={findCollateral} onOpen={setSelectedLoan}/></Panel>
          {loan && <div className="detail-backdrop" onClick={()=>setSelectedLoan(null)}><section className="detail" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setSelectedLoan(null)}>×</button><span className="eyebrow">LOAN DETAILS</span><h2>{findCustomer(loan.customerId)?.name || "Customer"}</h2><p>{findCollateral(loan.collateralId)?.description || "Collateral"}</p><div className="detail-total"><small>Outstanding balance</small><strong>{kwacha(totals(loan).balance)}</strong><Status value={loanStatus(loan)}/></div><div className="detail-grid"><div><small>Principal</small><b>{kwacha(loan.principal)}</b></div><div><small>Interest charges</small><b>{kwacha(totals(loan).charges)}</b></div><div><small>Repaid</small><b>{kwacha(totals(loan).repayments)}</b></div><div><small>Due date</small><b>{dateLabel(loan.dueOn)}</b></div></div>
            {loanStatus(loan)!=="CLEARED"&&loanStatus(loan)!=="FORFEITED"&&<div className="actions"><button className="secondary" onClick={()=>printAgreement(loan)}>Print loan agreement</button><button className="primary" onClick={()=>begin("repayment")}>Record repayment</button><button className="secondary" onClick={()=>renew(loan.id)}>Renew loan</button>{daysLate(loan)>=Number(db.settings?.forfeitGraceDays ?? FORFEIT_GRACE_DAYS)&&<button className="danger-button" onClick={()=>forfeit(loan.id)}>Record forfeiture</button>}</div>}
            <h3>Repayment history</h3>{(loan.repayments||[]).map(r=><div className="record" key={r.id}><div><b>{kwacha(r.amount)} · {r.method}</b><small>{dateLabel(r.on)} · {r.status}</small></div><div className="record-end">{r.status!=="REVERSED"&&<button className="quiet" onClick={()=>printReceipt(loan,r)}>Print receipt</button>}{r.status!=="REVERSED"&&<button className="quiet danger-text" onClick={()=>reverse(loan.id,r.id)}>Reverse</button>}</div></div>)}
            <h3>Interest charges</h3>{loan.charges.map(c=><div className="record" key={c.id}><div><b>{kwacha(c.amount)} · {c.kind}</b><small>{dateLabel(c.on)} · {c.note}</small></div></div>)}
          </section></div>}
        </>}
        {tab==="cashbook" && <><p className="intro">A transaction history of loan disbursements, accrued interest, repayments and reversals. Interest charged is not counted as cash received.</p><Panel title={"Cashbook entries ("+buildCashbookRows(db).length+")"}><div className="report-grid"><Metric label="Operating expenses" value={kwacha(report.operatingExpenses)}/><Metric label="Net cash position*" value={kwacha(report.netCashPosition)}/></div><p className="panel-copy">*Calculated from recorded loan disbursements, repayments, reversals and operating expenses. This is not a verified physical cash balance; opening balances and transfers are not yet recorded.</p><div className="actions report-actions"><button className="primary" onClick={()=>begin("expense")}>＋ Record expense</button><button className="secondary" onClick={()=>downloadCsv("cashbook")}>Download cashbook CSV</button><button className="secondary" onClick={()=>downloadCsv("repayments")}>Download repayments CSV</button></div><div className="ledger"><div className="ledger-row head"><span>Date</span><span>Transaction</span><span>Customer / details</span><span>Accrued</span><span>Cash out</span><span>Cash in</span><span>Action</span></div>{buildCashbookRows(db).map(row=><div className="ledger-row" key={row.id}><span>{dateLabel(row.date)}</span><span>{row.type}</span><span>{row.customer}<small>{row.description}{row.interest || row.principal ? " · Interest "+kwacha(row.interest)+" / Principal "+kwacha(row.principal) : ""}</small></span><span>{row.charged?kwacha(row.charged):"—"}</span><b className="negative">{row.cashOut? "−"+kwacha(row.cashOut):"—"}</b><b className="positive">{row.cashIn? "+"+kwacha(row.cashIn):"—"}</b><span>{row.type==="Operating expense"&&!db.events.some(e=>e.type==="EXPENSE_REVERSAL"&&e.expenseId===row.id)?<button className="quiet danger-text" onClick={()=>reverseExpense(row.id)}>Reverse</button>:row.type==="Operating expense"?"Reversed": "—"}</span></div>)}</div>{!buildCashbookRows(db).length&&<Empty>No cashbook transactions recorded.</Empty>}</Panel></>}
        {tab==="settings" && <><Panel title="Lending policies"><p className="panel-copy">These defaults are used when creating new loans. Saving policy changes does not alter the terms, charges or due dates of existing loans.</p><form className="policy-form" onSubmit={savePolicy}><div className="form-grid"><Field label="Default interest type"><select value={policyDraft.defaultInterestMode} onChange={e=>setPolicyDraft(p=>({...p,defaultInterestMode:e.target.value}))}><option value="percent">Percentage of principal</option><option value="fixed">Fixed amount (K)</option></select></Field><Field label={policyDraft.defaultInterestMode==="fixed"?"Default interest amount (K)":"Default interest rate (%)"}><input required type="number" min="0" step="0.01" value={policyDraft.defaultInterestValue} onChange={e=>setPolicyDraft(p=>({...p,defaultInterestValue:e.target.value}))}/></Field></div><div className="form-grid"><Field label="Default loan period (days)"><input required type="number" min="1" max="3650" step="1" value={policyDraft.defaultPeriodDays} onChange={e=>setPolicyDraft(p=>({...p,defaultPeriodDays:e.target.value}))}/></Field><Field label="Forfeiture grace period (days)"><input required type="number" min="0" max="3650" step="1" value={policyDraft.forfeitGraceDays} onChange={e=>setPolicyDraft(p=>({...p,forfeitGraceDays:e.target.value}))}/></Field></div><p className="panel-copy">Grace period starts after the due date. Zero means forfeiture becomes available once the loan is overdue. Forfeiture still requires confirmation.</p><div className="actions"><button className="primary" type="submit">Save lending policies</button><button className="secondary" type="button" onClick={()=>setPolicyDraft(normalizeLendingPolicy(db.settings))}>Reset unsaved changes</button></div></form></Panel><Panel title="Backup and restore"><p className="panel-copy">Your register is stored in this browser on this device. It is not automatically synced to the cloud. Export backups regularly and keep them somewhere secure.</p><div className="actions"><button className="primary" onClick={exportBackup}>Download JSON backup</button><label className="secondary file-button">Restore V2 backup<input type="file" accept="application/json,.json" onChange={e=>importBackup(e.target.files?.[0])}/></label></div></Panel><Panel title="CSV exports"><p className="panel-copy">Download spreadsheet-ready records for customers, collateral, loans, repayments and the cashbook. Exports include the current register data only.</p><div className="actions report-actions"><button className="secondary" onClick={()=>downloadCsv("customers")}>Customers CSV</button><button className="secondary" onClick={()=>downloadCsv("collateral")}>Collateral CSV</button><button className="secondary" onClick={()=>downloadCsv("loans")}>Loans CSV</button><button className="secondary" onClick={()=>downloadCsv("repayments")}>Repayments CSV</button><button className="secondary" onClick={()=>downloadCsv("cashbook")}>Cashbook CSV</button></div></Panel><Panel title="Register reconciliation"><p className="panel-copy">Run structural and financial checks for missing customer/collateral links, duplicate record and charge IDs, invalid loan and transaction dates, reversal-event mismatches, repayment allocation totals, collateral status mismatches, collateral pledged against multiple outstanding loans and cashbook summary consistency. This does not verify physical cash, bank balances or the accuracy of the original paper records.</p><div className="reconcile-head"><b>{reconciliation.ok?"No blocking structural errors detected":"Structural errors found"}</b><span className={reconciliation.ok?"reconcile-good":"reconcile-bad"}>{reconciliation.errors.length} errors · {reconciliation.warnings.length} warnings</span></div><div className="report-grid"><Metric label="Customers" value={reconciliation.counts.customers}/><Metric label="Collateral" value={reconciliation.counts.collateral}/><Metric label="Loans" value={reconciliation.counts.loans}/><Metric label="Repayments" value={reconciliation.counts.repayments}/><Metric label="Outstanding" value={kwacha(reconciliation.financials.outstanding)}/><Metric label="Net collections" value={kwacha(reconciliation.financials.netCashReceived)}/></div>{reconciliation.errors.length>0&&<div className="alert danger"><b>Errors</b><ul>{reconciliation.errors.map((x,i)=><li key={"e"+i}>{x}</li>)}</ul></div>}{reconciliation.warnings.length>0&&<div className="alert"><b>Warnings to review</b><ul>{reconciliation.warnings.map((x,i)=><li key={"w"+i}>{x}</li>)}</ul></div>}{reconciliation.ok&&reconciliation.warnings.length===0&&<p className="migration-ok">All available structural checks passed for the current register.</p>}</Panel><Panel title="Register information"><div className="info-row"><span>Application</span><b>FirstLink Register V2</b></div><div className="info-row"><span>Storage key</span><code>{KEY}</code></div><div className="info-row"><span>Customers</span><b>{customers.length}</b></div><div className="info-row"><span>Collateral records</span><b>{collateral.length}</b></div><div className="info-row"><span>Loans</span><b>{loans.length}</b></div><div className="info-row"><span>Audit events</span><b>{db.events.length}</b></div></Panel><Panel title="V1 migration and reconciliation"><p className="panel-copy">Choose a JSON backup exported from the original FirstLink V1 app. V2 validates the file and prepares a preview; no records are changed until you review and confirm the import. Keep an untouched copy of the original backup.</p><div className="actions"><label className="secondary file-button">Choose V1 backup<input type="file" accept="application/json,.json" onChange={e=>{readV1Migration(e.target.files?.[0]);e.target.value="";}}/></label></div>{migrationPreview&&<div className="migration-preview"><h4>Migration preview: {migrationPreview.sourceFile}</h4><div className="report-grid"><Metric label="Customers" value={migrationPreview.targetSummary.customers}/><Metric label="Collateral" value={migrationPreview.targetSummary.collateral}/><Metric label="Loans" value={migrationPreview.targetSummary.loans}/><Metric label="Repayments incl. reversals" value={migrationPreview.targetSummary.repayments}/><Metric label="Principal total" value={kwacha(migrationPreview.targetSummary.totalPrincipal)}/><Metric label="Interest charges" value={kwacha(migrationPreview.targetSummary.totalCharges)}/><Metric label="Posted repayments" value={kwacha(migrationPreview.targetSummary.postedRepayments)}/><Metric label="Reversal records restored" value={migrationPreview.targetSummary.reversals}/></div><p className="panel-copy">Reconciliation check: source and V2 customer, collateral, loan, principal, charge and posted-repayment totals should match. V1 reversed repayments are reconstructed from reversal events and are shown separately.</p><div className="info-row"><span>V1 customers / V2 customers</span><b>{migrationPreview.sourceSummary.customers} / {migrationPreview.targetSummary.customers}</b></div><div className="info-row"><span>V1 loans / V2 loans</span><b>{migrationPreview.sourceSummary.loans} / {migrationPreview.targetSummary.loans}</b></div><div className="info-row"><span>V1 posted repayments / V2 posted repayments</span><b>{kwacha(migrationPreview.sourceSummary.postedRepayments)} / {kwacha(migrationPreview.targetSummary.postedRepayments)}</b></div>{migrationPreview.warnings.length>0&&<div className="alert danger"><b>Review warnings before importing</b><ul>{migrationPreview.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}{migrationPreview.warnings.length===0&&<p className="migration-ok">No automatic reconciliation warnings were detected. This is a structural check, not proof that the original records are factually correct.</p>}<div className="actions"><button className="primary" onClick={commitV1Migration} disabled={!!storageError}>Confirm V1 import</button><button className="secondary" onClick={()=>setMigrationPreview(null)}>Discard preview</button></div></div>}</Panel></>}
      </div>
    </main>
    {form && <div className="modal-backdrop" onClick={finish}><form className="modal" onSubmit={form==="customer"?submitCustomer:form==="collateral"?submitCollateral:form==="loan"?submitLoan:form==="expense"?submitExpense:submitRepayment} onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">FIRSTLINK REGISTER</span><h2>{({customer:"Add customer",collateral:"Add collateral",loan:"Create new loan",repayment:"Record repayment",expense:"Record operating expense"})[form]}</h2></div><button type="button" className="close" onClick={finish}>×</button></div>
      {form==="customer"&&<><Field label="Full name"><input required autoFocus value={draft.name||""} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field><Field label="Phone number"><input value={draft.phone||""} onChange={e=>setDraft({...draft,phone:e.target.value})}/></Field><Field label="NRC number"><input value={draft.nrc||""} onChange={e=>setDraft({...draft,nrc:e.target.value})}/></Field><Field label="Area / township"><input value={draft.area||""} onChange={e=>setDraft({...draft,area:e.target.value})}/></Field></>}
      {form==="collateral"&&<><Field label="Customer"><select required value={draft.customerId||""} onChange={e=>setDraft({...draft,customerId:e.target.value})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Item description"><input required value={draft.description||""} onChange={e=>setDraft({...draft,description:e.target.value})}/></Field><Field label="Condition"><input value={draft.condition||""} onChange={e=>setDraft({...draft,condition:e.target.value})}/></Field><Field label="Estimated value (K)"><input type="number" min="0" step="0.01" value={draft.estimatedValue||""} onChange={e=>setDraft({...draft,estimatedValue:e.target.value})}/></Field><Field label="Storage location"><input value={draft.location||""} onChange={e=>setDraft({...draft,location:e.target.value})}/></Field></>}
      {form==="loan"&&<>{customers.length===0?<p>Add a customer before creating a loan.</p>:<><Field label="Customer"><select required value={draft.customerId||""} onChange={e=>setDraft({...draft,customerId:e.target.value,collateralId:""})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Collateral"><select required value={draft.collateralId||""} onChange={e=>setDraft({...draft,collateralId:e.target.value})}><option value="">Select available collateral</option>{customerCollateral.filter(a=>!draft.customerId||a.customerId===draft.customerId).map(a=><option key={a.id} value={a.id}>{a.description}</option>)}</select></Field><Field label="Principal amount (K)"><input required type="number" min="0.01" step="0.01" value={draft.principal||""} onChange={e=>setDraft({...draft,principal:e.target.value})}/></Field><div className="form-grid"><Field label="Interest type"><select value={draft.mode||"percent"} onChange={e=>setDraft({...draft,mode:e.target.value})}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></Field><Field label={draft.mode==="fixed"?"Interest amount (K)":"Interest rate (%)"}><input required type="number" min="0" step="0.01" value={draft.interestValue||""} onChange={e=>setDraft({...draft,interestValue:e.target.value})}/></Field></div><Field label="Interest period (days)"><input required type="number" min="1" step="1" value={draft.periodDays||30} onChange={e=>setDraft({...draft,periodDays:e.target.value})}/></Field></>}</>}
      {form==="expense"&&<><Field label="Expense category"><select required value={draft.category||"Transport"} onChange={e=>setDraft({...draft,category:e.target.value})}><option>Transport</option><option>Rent</option><option>Utilities</option><option>Supplies</option><option>Repairs and maintenance</option><option>Staff costs</option><option>Bank charges</option><option>Other</option></select></Field><Field label="Amount paid (K)"><input required type="number" min="0.01" step="0.01" value={draft.amount||""} onChange={e=>setDraft({...draft,amount:e.target.value})}/></Field><Field label="Description / payee"><input value={draft.description||""} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="e.g. Shop rent for November"/></Field><Field label="Payment method"><select value={draft.method||"Cash"} onChange={e=>setDraft({...draft,method:e.target.value})}><option>Cash</option><option>Mobile money</option><option>Bank transfer</option><option>Other</option></select></Field></>}
      {form==="repayment"&&<><Field label="Amount received (K)"><input required type="number" min="0.01" step="0.01" value={draft.amount||""} onChange={e=>setDraft({...draft,amount:e.target.value})}/></Field><Field label="Payment method"><select value={draft.method||"Cash"} onChange={e=>setDraft({...draft,method:e.target.value})}><option>Cash</option><option>Mobile money</option><option>Bank transfer</option><option>Other</option></select></Field></>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={finish}>Cancel</button><button className="primary" type="submit">Save record</button></div>
    </form></div>}
    <nav className="mobile-nav">{tabs.map(([id,label])=><button key={id} className={tab===id?"active":""} onClick={()=>{setTab(id);setForm("");}}>{label}</button>)}</nav>
  </div>;
}

function Metric({label,value,warn}) { return <div className="metric"><span>{label}</span><strong className={warn?"negative":""}>{value}</strong></div>; }
function Panel({title,children}) { return <section className="panel"><div className="panel-title"><h3>{title}</h3></div>{children}</section>; }
function LoanRows({items,findCustomer,findCollateral,onOpen}) {
  if (!items.length) return <Empty>No loans match this view.</Empty>;
  return <div className="record-list">{items.map(l=>{const status=loanStatus(l);return <button className="loan-row" key={l.id} onClick={()=>onOpen(l.id)}><div><b>{findCustomer(l.customerId)?.name || "Customer record"}</b><small>{findCollateral(l.collateralId)?.description || "Collateral"} · Due {dateLabel(l.dueOn)}</small></div><div className="loan-right"><b>{kwacha(totals(l).balance)}</b><Status value={status}/></div></button>;})}</div>;
}
function Events({events}) { return events.length?<div className="event-list">{events.map(e=><div className="event" key={e.id}><span className="event-mark"/><div><b>{e.text}</b><small>{new Date(e.at).toLocaleString("en-GB")}</small></div></div>)}</div>:<Empty>No activity has been recorded yet.</Empty>; }
