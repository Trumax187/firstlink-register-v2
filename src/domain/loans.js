export const FORFEIT_GRACE_DAYS = 7;

export function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Amount must be a valid number.");
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function interestCharge(principal, terms) {
  const base = money(principal);
  const value = Number(terms?.value);
  if (!(base > 0) || !(value >= 0) || !Number.isFinite(value)) throw new Error("Invalid loan or interest terms.");
  if (!Number.isInteger(Number(terms?.periodDays)) || Number(terms.periodDays) < 1) throw new Error("Interest period must be at least one day.");
  return money(terms.mode === "percent" ? base * value / 100 : value);
}

export function totals(loan) {
  const charges = (loan.charges || []).reduce((sum, item) => sum + money(item.amount), 0);
  const repayments = (loan.repayments || []).filter(x => x.status !== "REVERSED").reduce((sum, item) => sum + money(item.amount), 0);
  return { charges: money(charges), repayments: money(repayments), balance: money(loan.principal + charges - repayments) };
}

// Match the original FirstLink rule: each posted repayment pays charges
// that existed on its date first, then reduces principal. Reversed receipts
// remain in history but are excluded from allocation.
export function allocateRepayments(loan) {
  const posted = (loan.repayments || [])
    .filter(item => item.status !== "REVERSED")
    .slice()
    .sort((a, b) => String(a.on).localeCompare(String(b.on)) || String(a.id).localeCompare(String(b.id)));
  let interestPaid = 0;
  return posted.map(repayment => {
    const chargesDue = (loan.charges || [])
      .filter(charge => String(charge.on) <= String(repayment.on))
      .reduce((sum, charge) => sum + money(charge.amount), 0);
    const interestOutstanding = Math.max(0, money(chargesDue - interestPaid));
    const interest = money(Math.min(money(repayment.amount), interestOutstanding));
    interestPaid = money(interestPaid + interest);
    return { ...repayment, interest, principal: money(repayment.amount - interest) };
  });
}

export function loanStatus(loan, today = new Date()) {
  if (loan.status === "FORFEITED") return "FORFEITED";
  const { balance } = totals(loan);
  if (balance <= 0) return "CLEARED";
  const due = new Date(loan.dueOn + "T00:00:00");
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return due < now ? "OVERDUE" : "ACTIVE";
}

export function daysLate(loan, today = new Date()) {
  const due = new Date(loan.dueOn + "T00:00:00");
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.floor((now - due) / 86400000));
}

export function addDays(date, days) {
  const result = new Date(date + "T00:00:00");
  result.setDate(result.getDate() + Number(days));
  return [result.getFullYear(), String(result.getMonth()+1).padStart(2,"0"), String(result.getDate()).padStart(2,"0")].join("-");
}

export function createLoan({ customerId, collateralId, principal, mode, value, periodDays, issuedOn, id }) {
  const amount = money(principal);
  const terms = { mode, value: Number(value), periodDays: Number(periodDays) };
  const charge = interestCharge(amount, terms);
  if (!customerId || !collateralId || !(amount > 0)) throw new Error("Customer, collateral and a positive principal are required.");
  return {
    id, customerId, collateralId, principal: amount, interest: terms,
    issuedOn, dueOn: addDays(issuedOn, terms.periodDays), status: "ACTIVE", renewals: 0,
    charges: [{ id: id + "-CH1", kind: "INITIAL", amount: charge, on: issuedOn, note: "Initial interest charge" }],
    repayments: []
  };
}

export function recordRepayment(loan, { id, amount, on, method }) {
  const value = money(amount);
  const current = totals(loan).balance;
  if (!(value > 0)) throw new Error("Repayment must be greater than zero.");
  if (value > current) throw new Error("Repayment cannot exceed the outstanding balance.");
  return { ...loan, repayments: [...(loan.repayments || []), { id, amount: value, on, method, status: "POSTED" }] };
}

export function reverseRepayment(loan, repaymentId, { reversalId, on, reason }) {
  const target = (loan.repayments || []).find(x => x.id === repaymentId);
  if (!target || target.status === "REVERSED") throw new Error("That repayment is not available to reverse.");
  return {
    ...loan,
    repayments: loan.repayments.map(x => x.id === repaymentId ? { ...x, status: "REVERSED", reversedOn: on, reversalId, reversalReason: reason } : x)
  };
}

export function renewLoan(loan, { chargeId, on }) {
  if (!["ACTIVE", "OVERDUE"].includes(loanStatus(loan, new Date(on + "T00:00:00")))) throw new Error("Only an outstanding loan can be renewed.");
  const amount = interestCharge(loan.principal, loan.interest);
  const next = loan.renewals + 1;
  return {
    ...loan, renewals: next, dueOn: addDays(on, loan.interest.periodDays),
    charges: [...loan.charges, { id: chargeId, kind: "RENEWAL", amount, on, note: "Renewal " + next }]
  };
}

export function canDeleteLoan(loan) {
  return (loan.repayments || []).length === 0 &&
    (loan.charges || []).length === 0 && loan.status !== "FORFEITED";
}

// Build a chronological register view from loan records and immutable events.
// Loan disbursements and repayments affect cash; interest charges are accrued,
// not cash receipts. A reversal is a separate negative cash movement.
export function buildCashbookRows(db) {
  const rows = [];
  const customerName = id => db.customers?.find(x => x.id === id)?.name || "Unknown customer";
  const collateralName = id => db.collateral?.find(x => x.id === id)?.description || "Collateral";
  for (const loan of db.loans || []) {
    const customer = customerName(loan.customerId);
    rows.push({ id: loan.id + "-ISSUED", date: loan.issuedOn, type: "Loan issued", customer, description: collateralName(loan.collateralId), cashOut: money(loan.principal), cashIn: 0, interest: 0, principal: money(loan.principal) });
    for (const charge of loan.charges || []) {
      rows.push({ id: charge.id, date: charge.on, type: charge.kind === "RENEWAL" ? "Renewal interest charged" : "Interest charged", customer, description: charge.note || "Interest charge", cashOut: 0, cashIn: 0, charged: money(charge.amount), interest: money(charge.amount), principal: 0 });
    }
    const allocations = new Map(allocateRepayments(loan).map(x => [x.id, x]));
    for (const repayment of loan.repayments || []) {
      const reversalEvent = (db.events || []).find(e => e.type === "REVERSAL" && e.repaymentId === repayment.id);
      const allocation = allocations.get(repayment.id);
      rows.push({
        id: repayment.id, date: repayment.on,
        type: repayment.status === "REVERSED" ? "Repayment (later reversed)" : "Repayment",
        customer, description: repayment.method || "Payment", cashOut: 0,
        cashIn: money(repayment.amount),
        interest: money(repayment.status === "REVERSED" ? (reversalEvent?.interest ?? 0) : (allocation?.interest ?? 0)),
        principal: money(repayment.status === "REVERSED" ? (reversalEvent?.principal ?? 0) : (allocation?.principal ?? repayment.amount))
      });
    }
  }
  for (const event of db.events || []) {
    if (event.type === "REVERSAL") {
      const loan = (db.loans || []).find(x => x.id === event.loanId);
      rows.push({ id: event.id, date: event.on || event.at?.slice(0,10), type: "Repayment reversal", customer: loan ? customerName(loan.customerId) : "Unknown customer", description: event.reason || event.text || "Reversal", cashOut: money(event.amount || 0), cashIn: 0, interest: -money(event.interest || 0), principal: -money(event.principal || 0) });
    } else if (event.type === "EXPENSE") {
      rows.push({ id:event.id, date:event.on || event.at?.slice(0,10), type:"Operating expense", customer:"—", description:[event.category,event.description].filter(Boolean).join(" · ") || "Expense", cashOut:Number.isFinite(Number(event.amount))?money(event.amount):0, cashIn:0, interest:0, principal:0, method:event.method || "Cash" });
    }
  }
  return rows.filter(x => x.date).sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id)));
}
