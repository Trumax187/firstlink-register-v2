# FirstLink Register V2

A fresh, independent rebuild of FirstLink Register for collateral-backed lending operations.

## Project principles

- Keep the original FirstLink Register repository and its live data untouched.
- Preserve the customer → collateral → loan workflow.
- Use Zambian Kwacha (ZMW) and local date conventions.
- Keep financial events traceable; never silently erase financial history.
- Use synthetic records during development.
- Keep V2 data separate from V1 until a tested, reconciled migration is explicitly approved.

## Development status

Repository initialized. Core domain rules, data model, interface, automated tests, backup/restore, and migration tooling are to be implemented and verified before production use.

## Planned stack

- React
- JavaScript modules
- esbuild
- Browser-based storage with explicit backup and restore

## Safety

This application is a record-keeping tool, not a banking or payment-processing service. Do not enter real customer information into development or test builds.
