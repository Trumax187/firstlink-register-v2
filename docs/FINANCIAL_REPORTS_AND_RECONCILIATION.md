# FirstLink V2 financial reports and reconciliation

## Reporting periods

The Reports view accepts an inclusive start and end date. It rejects impossible calendar dates and an end date earlier than the start date.

The selected-period report is built from dated cashbook rows:

- Loans issued: count and principal disbursed in the period.
- Repayments received: gross receipts dated in the period, including receipts that may later be reversed.
- Reversed receipts: reversal cash-out dated in the period.
- Net collections: gross receipts less reversals in the selected period.
- Interest charged: interest accrued in the period; this is not the same as interest cash collected.
- Interest collected and principal collected: repayment allocation less reversal allocation dated in the selected period.
- Net cash movement: receipts less reversals and principal disbursements.

Net cash movement is not profit. Operating expenses, owner deposits, owner withdrawals, fees and bank charges are not yet recorded in FirstLink, so they are excluded.

## Reconciliation checks

The Settings > Register reconciliation panel runs structural and financial checks, including:

- Unique customer, collateral, loan, event, repayment and charge identifiers.
- Valid positive loan principal and valid issue/due dates.
- Charges and repayments with valid amounts and dates; no charge or repayment predates its loan.
- Reversal events must point to an existing repayment on the same loan.
- A posted repayment cannot also have a reversal event.
- Reversal amount and interest/principal allocation must reconcile to the original repayment amount.
- Reversed repayments without an event are surfaced by the existing warning check.
- One collateral item cannot secure multiple outstanding loans.
- Customer/collateral ownership, collateral status and portfolio/cashbook summary checks.

## What the checks cannot prove

A clean reconciliation means the stored records are internally consistent. It does not prove that cash was physically received, that a mobile-money or bank statement agrees, that the collateral exists or is correctly valued, or that the source records were entered correctly.

Before importing live V1 records:

1. Export and preserve an untouched V1 JSON backup.
2. Reconcile V1 against paper receipts, cash records and bank/mobile-money statements.
3. Import into a separate V2 test profile first.
4. Review every warning and compare customer, collateral, loan, principal, charge, repayment and reversal totals.
5. Do not replace the working V1 register until Edina has approved the rehearsal results and a fresh backup is secured.
