export const policy = Object.freeze({ failureThreshold: 3, retryLimit: 3, cooldownMinutes: 60, productionRollback: false });
export function decideRecovery({ failures = 0, status = 0, component = "worker" } = {}) {
  if (failures < policy.failureThreshold) return "OBSERVE";
  if ([401, 403, 404].includes(status) || component === "oauth") return "ALERT";
  if (component === "github" || component === "root" || status === 429) return "RETRY_THEN_ALERT";
  return "ALERT";
}
