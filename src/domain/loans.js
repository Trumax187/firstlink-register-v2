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
    ...loan, renewals: next, dueOn: addDays(loan.dueOn, loan.interest.periodDays),
    charges: [...loan.charges, { id: chargeId, kind: "RENEWAL", amount, on, note: "Renewal " + next }]
  };
}

export function canDeleteLoan(loan) {
  return (loan.repayments || []).length === 0 &&
    (loan.charges || []).length === 0 && loan.status !== "FORFEITED";
}