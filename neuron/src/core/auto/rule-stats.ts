import { db } from "../db/schema"

export interface RuleStats {
  fired: number
  wins: number
}

/**
 * Increment the fired counter for each rule. Call after a wave completes,
 * for every rule in `plan.rules_fired`.
 */
export function recordRulesFired(rules: string[], fingerprint: string): void {
  if (rules.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO rule_effectiveness (rule_name, task_fingerprint, fired_count, produced_winner_count, updated_at)
     VALUES (?, ?, 1, 0, unixepoch())
     ON CONFLICT(rule_name, task_fingerprint) DO UPDATE SET
       fired_count = fired_count + 1,
       updated_at = unixepoch()`,
  )
  const tx = db.transaction(() => {
    for (const r of rules) stmt.run(r, fingerprint)
  })
  tx()
}

/**
 * Increment the produced-winner counter for each rule that participated in
 * generating the winning config. Called after winner selection at the end of
 * a successful auto_run.
 */
export function recordRulesProducedWinner(rules: string[], fingerprint: string): void {
  if (rules.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO rule_effectiveness (rule_name, task_fingerprint, fired_count, produced_winner_count, updated_at)
     VALUES (?, ?, 0, 1, unixepoch())
     ON CONFLICT(rule_name, task_fingerprint) DO UPDATE SET
       produced_winner_count = produced_winner_count + 1,
       updated_at = unixepoch()`,
  )
  const tx = db.transaction(() => {
    for (const r of rules) stmt.run(r, fingerprint)
  })
  tx()
}

export function getRuleStats(fingerprint: string): Record<string, RuleStats> {
  const rows = db.query(
    `SELECT rule_name, fired_count, produced_winner_count
     FROM rule_effectiveness
     WHERE task_fingerprint = ?
     ORDER BY fired_count DESC`,
  ).all(fingerprint) as Array<{
    rule_name: string
    fired_count: number
    produced_winner_count: number
  }>
  const result: Record<string, RuleStats> = {}
  for (const r of rows) {
    result[r.rule_name] = { fired: r.fired_count, wins: r.produced_winner_count }
  }
  return result
}

/** Total trial count across all rules for a fingerprint — used to gate "show stats" in the planner prompt. */
export function totalTrialsFor(fingerprint: string): number {
  const row = db.query(
    `SELECT COALESCE(SUM(fired_count), 0) as total
     FROM rule_effectiveness
     WHERE task_fingerprint = ?`,
  ).get(fingerprint) as { total: number } | null
  return row?.total ?? 0
}
