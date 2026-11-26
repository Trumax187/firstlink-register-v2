import { FORFEIT_GRACE_DAYS } from "./loans.js";

export const DEFAULT_LENDING_POLICY = Object.freeze({
  forfeitGraceDays: FORFEIT_GRACE_DAYS,
  defaultInterestMode: "percent",
  defaultInterestValue: 0,
  defaultPeriodDays: 30
});

export function normalizeLendingPolicy(settings = {}) {
  return { ...DEFAULT_LENDING_POLICY, ...(settings || {}) };
}

export function validateLendingPolicy(input = {}) {
  const policy = {
    forfeitGraceDays: Number(input.forfeitGraceDays),
    defaultInterestMode: input.defaultInterestMode,
    defaultInterestValue: Number(input.defaultInterestValue),
    defaultPeriodDays: Number(input.defaultPeriodDays)
  };
  if (!Number.isInteger(policy.forfeitGraceDays) || policy.forfeitGraceDays < 0 || policy.forfeitGraceDays > 3650) throw new Error("Grace period must be a whole number from 0 to 3,650 days.");
  if (!["percent", "fixed"].includes(policy.defaultInterestMode)) throw new Error("Choose a valid default interest type.");
  if (!Number.isFinite(policy.defaultInterestValue) || policy.defaultInterestValue < 0) throw new Error("Default interest must be zero or greater.");
  if (!Number.isInteger(policy.defaultPeriodDays) || policy.defaultPeriodDays < 1 || policy.defaultPeriodDays > 3650) throw new Error("Default loan period must be a whole number from 1 to 3,650 days.");
  return policy;
}

export function loanDraftDefaults(settings = {}) {
  const policy = normalizeLendingPolicy(settings);
  return { mode: policy.defaultInterestMode, interestValue: String(policy.defaultInterestValue), periodDays: String(policy.defaultPeriodDays) };
}
