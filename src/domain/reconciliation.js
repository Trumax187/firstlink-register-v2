const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const amount = value => Number.isFinite(Number(value)) ? Math.round((Number(value) + Number.EPSILON) * 100) / 100 : NaN;
const close = (a, b) => Math.abs(amount(a) - amount(b)) <= 0.01;

export function auditFinancialIntegrity(db) {
  const errors = [];
  const warnings = [];
  const reversalEvents = (db.events || []).filter(event => event.type === "REVERSAL");
  const reversalsByRepayment = new Map();
  const chargeIds = new Set();
  const repaymentIds = new Set();

  for (const event of reversalEvents) {
    const list = reversalsByRepayment.get(event.repaymentId) || [];
    list.push(event);
    reversalsByRepayment.set(event.repaymentId, list);
  }

  for (const loan of db.loans || []) {
    if (!(amount(loan.principal) > 0)) errors.push("Loan " + loan.id + " has an invalid principal amount.");
    if (!validDate(loan.issuedOn) || !validDate(loan.dueOn)) errors.push("Loan " + loan.id + " has an invalid issue or due date.");
    if (loan.dueOn < loan.issuedOn) errors.push("Loan " + loan.id + " is due before its issue date.");

    for (const charge of loan.charges || []) {
      if (!charge.id) errors.push("A charge on loan " + loan.id + " is missing an ID.");
      else if (chargeIds.has(charge.id)) errors.push("duplicate charge ID " + charge.id + " is used more than once in the register.");
      chargeIds.add(charge.id);
      if (!(amount(charge.amount) >= 0)) errors.push("Charge " + (charge.id || "on loan " + loan.id) + " has an invalid amount.");
      if (!validDate(charge.on)) errors.push("Charge " + (charge.id || "on loan " + loan.id) + " has an invalid date.");
      if (validDate(charge.on) && validDate(loan.issuedOn) && charge.on < loan.issuedOn) errors.push("Charge " + (charge.id || "on loan " + loan.id) + " predates its loan.");
    }

    for (const repayment of loan.repayments || []) {
      if (!repayment.id) errors.push("A repayment on loan " + loan.id + " is missing an ID.");
      else if (repaymentIds.has(repayment.id)) errors.push("Repayment ID " + repayment.id + " is used more than once in the register.");
      repaymentIds.add(repayment.id);
      if (!(amount(repayment.amount) > 0)) errors.push("Repayment " + repayment.id + " has an invalid amount.");
      if (!validDate(repayment.on)) errors.push("Repayment " + repayment.id + " has an invalid date.");
      if (validDate(repayment.on) && validDate(loan.issuedOn) && repayment.on < loan.issuedOn) errors.push("Repayment " + repayment.id + " predates its loan.");
      if (!["POSTED", "REVERSED"].includes(repayment.status)) errors.push("Repayment " + repayment.id + " has an unknown status.");
      const linked = reversalsByRepayment.get(repayment.id) || [];
      if (linked.length > 1) errors.push("Repayment " + repayment.id + " has more than one reversal event.");
      if (repayment.status === "POSTED" && linked.length) errors.push("Repayment " + repayment.id + " has a reversal event but is still marked POSTED.");
      if (repayment.status === "REVERSED" && linked.length === 1) {
        const event = linked[0];
        if (event.loanId !== loan.id) errors.push("Reversal for repayment " + repayment.id + " is linked to the wrong loan.");
        if (!close(event.amount, repayment.amount)) errors.push("Reversal for repayment " + repayment.id + " does not match the original payment amount.");
        const allocated = amount(event.interest || 0) + amount(event.principal ?? event.amount);
        if (!close(allocated, repayment.amount)) errors.push("Reversal for repayment " + repayment.id + " has an interest/principal allocation that does not equal the payment.");
        const reversalDate = event.on || String(event.at || "").slice(0, 10);
        if (!validDate(reversalDate)) errors.push("Reversal for repayment " + repayment.id + " has an invalid reversal date.");
      }
    }
  }

  for (const event of reversalEvents) {
    if (!(amount(event.amount) > 0)) errors.push("Reversal event " + event.id + " has an invalid amount.");
    const interest = amount(event.interest ?? 0);
    const principal = amount(event.principal ?? NaN);
    if (!(interest >= 0) || !(principal >= 0)) errors.push("Reversal event " + event.id + " has an invalid interest/principal allocation.");
    else if (!close(interest + principal, event.amount)) errors.push("Reversal event " + event.id + " allocation does not equal its amount.");
    const reversalDate = event.on || String(event.at || "").slice(0, 10);
    if (!validDate(reversalDate)) errors.push("Reversal event " + event.id + " has an invalid reversal date.");
  }

  for (const [repaymentId, events] of reversalsByRepayment) {
    const linkedLoan = (db.loans || []).find(loan => (loan.repayments || []).some(item => item.id === repaymentId));
    if (!linkedLoan) errors.push("Reversal event " + events[0].id + " refers to a repayment that does not exist.");
    else if (events[0].loanId !== linkedLoan.id) errors.push("Reversal event " + events[0].id + " refers to a repayment on a different loan.");
  }

  const collateralUse = new Map();
  for (const loan of db.loans || []) {
    const status = String(loan.status || "").toUpperCase();
    if (status === "FORFEITED") continue;
    const balance = amount(loan.principal) + (loan.charges || []).reduce((n, item) => n + amount(item.amount), 0) -
      (loan.repayments || []).filter(item => item.status !== "REVERSED").reduce((n, item) => n + amount(item.amount), 0);
    if (balance > 0.01) collateralUse.set(loan.collateralId, (collateralUse.get(loan.collateralId) || 0) + 1);
  }
  for (const [collateralId, count] of collateralUse) {
    if (count > 1) errors.push("Collateral " + collateralId + " is linked to more than one outstanding loan.");
  }

  return { errors, warnings };
}
