import { FORFEIT_GRACE_DAYS } from "./loans.js";

export const DEFAULT_LENDING_POLICY = Object.freeze({
  forfeitGraceDays: FORFEIT_GRACE_DAYS
});

export function normalizeLendingPolicy(settings = {}) {
  return {
    forfeitGraceDays: Number(settings?.forfeitGraceDays ?? FORFEIT_GRACE_DAYS)
  };
}

export function validateLendingPolicy(input = {}) {
  const policy = {
    forfeitGraceDays: Number(input.forfeitGraceDays)
  };

  if (
    !Number.isInteger(policy.forfeitGraceDays) ||
    policy.forfeitGraceDays < 0 ||
    policy.forfeitGraceDays > 3650
  ) {
    throw new Error("Grace period must be a whole number from 0 to 3,650 days.");
  }

  return policy;
}
