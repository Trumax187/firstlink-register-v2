import React, { useEffect, useMemo, useState } from "react";
import { createLoan, totals, loanStatus, recordRepayment, reverseRepayment, renewLoan, daysLate, allocateRepayments, FORFEIT_GRACE_DAYS } from "./domain/loans.js";

const KEY = "firstlink.register.v2";
const empty = { customers: [], collateral: [], loans: [], events: [], settings: { forfeitGraceDays: FORFEIT_GRACE_DAYS } };
const makeId = (prefix) => prefix + "-" + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
};
const kwacha = (n) => "K" + Number(n || 0).toLocaleString("en-ZM", { minimumFractionDigits:2, maximumFractionDigits:2 });
const dateLabel = (s) => s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
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
  const [form,setForm] = useState("");
  const [draft,setDraft] = useState({});
  const [confirm,setConfirm] = useState(null);

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
  const visibleLoans = useMemo(() => loans.filter(l => {
    const c = findCustomer(l.customerId), a = findCollateral(l.collateralId);
    return [c?.name,c?.phone,a?.description,l.id].join(" ").toLowerCase().includes(query.toLowerCase());
  }), [loans,customers,collateral,query]);
  const pushEvent = (type, text, loanId = null, extra = {}) => ({ id:makeId("EV"), type, text, loanId, at:new Date().toISOString(), ...extra });
  const save = fn => {
    if (storageError) { setNotice("Saving is blocked until the existing data problem is resolved."); return; }
    try { const next = fn(db); if (!validData(next)) throw new Error("Invalid register data."); setDb(next); }
    catch (e) { setNotice(e.message || "Could not save this change."); }
  };
  const begin = (kind, values = {}) => { setDraft(values); setForm(kind); };
  const finish = () => { setForm(""); setDraft({}); };

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
  function submitRepayment(e) {
    e.preventDefault();
    const loan = loans.find(x => x.id === selectedLoan);
    try {
      if (!loan) throw new Error("Select a loan first.");
      const repayment = {id:makeId("PAY"),amount:Number(draft.amount),on:today(),method:draft.method || "Cash"};
      const updated = recordRepayment(loan,repayment);
      save(s => ({...s,loans:s.loans.map(x => x.id === loan.id ? updated : x),collateral:s.collateral.map(x => x.id === loan.collateralId && totals(updated).balance <= 0 ? {...x,status:"RELEASED"} : x),events:[...s.events,pushEvent("REPAYMENT","Repayment "+kwacha(repayment.amount)+" ("+repayment.method+")",loan.id,{repaymentId:repayment.id,amount:repayment.amount,on:repayment.on,method:repayment.method})]}));
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
  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const b = JSON.parse(reader.result);
        if (b.app !== "FirstLink Register" || b.schemaVersion !== 2 || !validData(b.data)) throw new Error("This is not a valid FirstLink V2 backup.");
        if (!window.confirm("Restore this backup? Current V2 records will be replaced.")) return;
        setStorageError(""); setDb(b.data); setNotice("Backup restored.");
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
          <Panel title="Recent activity"><Events events={db.events.slice(-6).reverse()}/></Panel>
        </>}
        {tab==="customers" && <><div className="page-actions"><p>Customer records and contact details.</p><button className="primary" onClick={()=>begin("customer")}>＋ Add customer</button></div><Panel title={"Customers ("+customers.length+")"}><div className="record-list">{customers.filter(x=>(x.name+" "+x.phone+" "+x.nrc).toLowerCase().includes(query.toLowerCase())).map(c=><div className="record" key={c.id}><div><b>{c.name}</b><small>{c.phone || "No phone"} · NRC: {c.nrc || "Not recorded"} · {c.area || "Area not recorded"}</small></div><button className="quiet danger-text" onClick={()=>removeCustomer(c.id)}>Delete</button></div>)}</div>{!customers.length&&<Empty>No customers have been added.</Empty>}</Panel></>}
        {tab==="collateral" && <><div className="page-actions"><p>Items pledged as security for loans.</p><button className="primary" onClick={()=>begin("collateral")}>＋ Add collateral</button></div><Panel title={"Collateral ("+collateral.length+")"}><div className="record-list">{collateral.filter(x=>(x.description+" "+findCustomer(x.customerId)?.name).toLowerCase().includes(query.toLowerCase())).map(a=><div className="record" key={a.id}><div><b>{a.description}</b><small>{findCustomer(a.customerId)?.name || "Unknown customer"} · {a.location || "Storage not recorded"} · {kwacha(a.estimatedValue)}</small></div><div className="record-end"><Status value={a.status}/>{a.status==="AVAILABLE"&&<button className="quiet danger-text" onClick={()=>removeCollateral(a.id)}>Delete</button>}</div></div>)}</div>{!collateral.length&&<Empty>No collateral has been added.</Empty>}</Panel></>}
        {tab==="loans" && <><div className="page-actions"><p>Loan register, balances, renewals and repayments.</p><button className="primary" onClick={()=>begin("loan")}>＋ New loan</button></div><Panel title={"All loans ("+visibleLoans.length+")"}><LoanRows items={visibleLoans} findCustomer={findCustomer} findCollateral={findCollateral} onOpen={setSelectedLoan}/></Panel>
          {loan && <div className="detail-backdrop" onClick={()=>setSelectedLoan(null)}><section className="detail" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setSelectedLoan(null)}>×</button><span className="eyebrow">LOAN DETAILS</span><h2>{findCustomer(loan.customerId)?.name || "Customer"}</h2><p>{findCollateral(loan.collateralId)?.description || "Collateral"}</p><div className="detail-total"><small>Outstanding balance</small><strong>{kwacha(totals(loan).balance)}</strong><Status value={loanStatus(loan)}/></div><div className="detail-grid"><div><small>Principal</small><b>{kwacha(loan.principal)}</b></div><div><small>Interest charges</small><b>{kwacha(totals(loan).charges)}</b></div><div><small>Repaid</small><b>{kwacha(totals(loan).repayments)}</b></div><div><small>Due date</small><b>{dateLabel(loan.dueOn)}</b></div></div>
            {loanStatus(loan)!=="CLEARED"&&loanStatus(loan)!=="FORFEITED"&&<div className="actions"><button className="primary" onClick={()=>begin("repayment")}>Record repayment</button><button className="secondary" onClick={()=>renew(loan.id)}>Renew loan</button>{daysLate(loan)>=Number(db.settings?.forfeitGraceDays ?? FORFEIT_GRACE_DAYS)&&<button className="danger-button" onClick={()=>forfeit(loan.id)}>Record forfeiture</button>}</div>}
            <h3>Repayment history</h3>{(loan.repayments||[]).map(r=><div className="record" key={r.id}><div><b>{kwacha(r.amount)} · {r.method}</b><small>{dateLabel(r.on)} · {r.status}</small></div>{r.status!=="REVERSED"&&<button className="quiet danger-text" onClick={()=>reverse(loan.id,r.id)}>Reverse</button>}</div>)}
            <h3>Interest charges</h3>{loan.charges.map(c=><div className="record" key={c.id}><div><b>{kwacha(c.amount)} · {c.kind}</b><small>{dateLabel(c.on)} · {c.note}</small></div></div>)}
          </section></div>}
        </>}
        {tab==="cashbook" && <><p className="intro">Cash movements generated from posted loan repayments and their reversals. Repayments are allocated to interest first, then principal.</p><Panel title="Cashbook entries"><div className="ledger"><div className="ledger-row head"><span>Date</span><span>Description</span><span>Method</span><span>Interest</span><span>Principal</span><span>Cash movement</span></div>{db.events.filter(e=>["REPAYMENT","REVERSAL"].includes(e.type)).slice().reverse().map(e=>{const relatedLoan=loans.find(l=>l.id===e.loanId);const allocation=relatedLoan?allocateRepayments(relatedLoan).find(r=>r.id===e.repaymentId):null;const interest=e.type==="REVERSAL"?e.interest:allocation?.interest;const principal=e.type==="REVERSAL"?e.principal:allocation?.principal;return <div className="ledger-row" key={e.id}><span>{dateLabel(e.on || e.at?.slice(0,10))}</span><span>{e.text}<small>{findCustomer(relatedLoan?.customerId)?.name || ""}</small></span><span>{e.method || "—"}</span><span>{interest == null?"—":kwacha(e.type==="REVERSAL"?-interest:interest)}</span><span>{principal == null?"—":kwacha(e.type==="REVERSAL"?-principal:principal)}</span><b className={e.type==="REVERSAL"?"negative":"positive"}>{e.type==="REVERSAL"?"−": "+"}{kwacha(e.amount || 0)}</b></div>})}</div>{!db.events.some(e=>["REPAYMENT","REVERSAL"].includes(e.type))&&<Empty>No cashbook transactions recorded.</Empty>}</Panel></>}
        {tab==="settings" && <><Panel title="Backup and restore"><p className="panel-copy">Your register is stored in this browser on this device. It is not automatically synced to the cloud. Export backups regularly and keep them somewhere secure.</p><div className="actions"><button className="primary" onClick={exportBackup}>Download JSON backup</button><label className="secondary file-button">Restore V2 backup<input type="file" accept="application/json,.json" onChange={e=>importBackup(e.target.files?.[0])}/></label></div></Panel><Panel title="Register information"><div className="info-row"><span>Application</span><b>FirstLink Register V2</b></div><div className="info-row"><span>Storage key</span><code>{KEY}</code></div><div className="info-row"><span>Customers</span><b>{customers.length}</b></div><div className="info-row"><span>Collateral records</span><b>{collateral.length}</b></div><div className="info-row"><span>Loans</span><b>{loans.length}</b></div><div className="info-row"><span>Audit events</span><b>{db.events.length}</b></div></Panel><Panel title="Data migration"><p className="panel-copy">V1 records are not imported automatically. A separate migration and reconciliation process will be provided before any real records are moved into V2.</p></Panel></>}
      </div>
    </main>
    {form && <div className="modal-backdrop" onClick={finish}><form className="modal" onSubmit={form==="customer"?submitCustomer:form==="collateral"?submitCollateral:form==="loan"?submitLoan:submitRepayment} onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">FIRSTLINK REGISTER</span><h2>{({customer:"Add customer",collateral:"Add collateral",loan:"Create new loan",repayment:"Record repayment"})[form]}</h2></div><button type="button" className="close" onClick={finish}>×</button></div>
      {form==="customer"&&<><Field label="Full name"><input required autoFocus value={draft.name||""} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field><Field label="Phone number"><input value={draft.phone||""} onChange={e=>setDraft({...draft,phone:e.target.value})}/></Field><Field label="NRC number"><input value={draft.nrc||""} onChange={e=>setDraft({...draft,nrc:e.target.value})}/></Field><Field label="Area / township"><input value={draft.area||""} onChange={e=>setDraft({...draft,area:e.target.value})}/></Field></>}
      {form==="collateral"&&<><Field label="Customer"><select required value={draft.customerId||""} onChange={e=>setDraft({...draft,customerId:e.target.value})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Item description"><input required value={draft.description||""} onChange={e=>setDraft({...draft,description:e.target.value})}/></Field><Field label="Condition"><input value={draft.condition||""} onChange={e=>setDraft({...draft,condition:e.target.value})}/></Field><Field label="Estimated value (K)"><input type="number" min="0" step="0.01" value={draft.estimatedValue||""} onChange={e=>setDraft({...draft,estimatedValue:e.target.value})}/></Field><Field label="Storage location"><input value={draft.location||""} onChange={e=>setDraft({...draft,location:e.target.value})}/></Field></>}
      {form==="loan"&&<>{customers.length===0?<p>Add a customer before creating a loan.</p>:<><Field label="Customer"><select required value={draft.customerId||""} onChange={e=>setDraft({...draft,customerId:e.target.value,collateralId:""})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Collateral"><select required value={draft.collateralId||""} onChange={e=>setDraft({...draft,collateralId:e.target.value})}><option value="">Select available collateral</option>{customerCollateral.filter(a=>!draft.customerId||a.customerId===draft.customerId).map(a=><option key={a.id} value={a.id}>{a.description}</option>)}</select></Field><Field label="Principal amount (K)"><input required type="number" min="0.01" step="0.01" value={draft.principal||""} onChange={e=>setDraft({...draft,principal:e.target.value})}/></Field><div className="form-grid"><Field label="Interest type"><select value={draft.mode||"percent"} onChange={e=>setDraft({...draft,mode:e.target.value})}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></Field><Field label={draft.mode==="fixed"?"Interest amount (K)":"Interest rate (%)"}><input required type="number" min="0" step="0.01" value={draft.interestValue||""} onChange={e=>setDraft({...draft,interestValue:e.target.value})}/></Field></div><Field label="Interest period (days)"><input required type="number" min="1" step="1" value={draft.periodDays||30} onChange={e=>setDraft({...draft,periodDays:e.target.value})}/></Field></>}</>}
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
