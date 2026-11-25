# FirstLink Register V2

A clean, independent rebuild of FirstLink's collateral-backed lending register.

## Principles

- The original `firstlink-register` repository and its live data remain untouched.
- Preserve the customer → collateral → loan workflow.
- Use Zambian Kwacha (ZMW), local dates, and clear accessible contrast.
- Financial history is retained; repayments are reversed, not erased.
- Use synthetic records during development.
- V2 uses its own browser storage key: `firstlink.register.v2`.
- V1 data is never imported automatically. Migration requires a separate, tested reconciliation.

## Stack

React 18, JavaScript modules, esbuild, Node's built-in test runner, and GitHub Pages.

## Local development

```sh
npm install
npm run dev
```

Build and test:

```sh
npm test
npm run build
```

## Data and backups

The current V2 foundation stores data in this browser on this device. It is not cloud-synced. Use Settings & Data to export a JSON backup and restore a V2 backup. Keep backup files secure because they may contain customer personal and financial information.

## Financial controls in the current foundation

- Principal and interest are recorded separately.
- Initial and renewal charges are explicit ledger entries.
- Repayments cannot exceed the outstanding balance.
- Repayment reversals retain the original repayment record and add an audit event.
- Customers and collateral linked to loan history cannot be deleted.
- Collateral is released when the balance is cleared.
- Forfeiture is a separate recorded status, not a deletion.

## Deployment

The GitHub Actions workflow runs tests and builds the site, then deploys to GitHub Pages. In repository Settings → Pages, set the build and deployment source to **GitHub Actions** if it is not already selected.

## Important limitation

This is an early working foundation, not yet a production-ready financial register. Before real records are entered, complete and verify the remaining V1 workflow parity, printable documents, CSV exports, full cashbook reconciliation, configurable policies, migration tooling, and browser/device recovery tests. Do not use real customer data in development builds.
