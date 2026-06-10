import { logApiCall as dbLog, getStatsToday as dbStats } from './db'

export async function logApiCall(params: { model: string; inputTokens: number; outputTokens: number }): Promise<void> {
  dbLog(params)
}

export function getStatsToday(): { tokens: number; cost: number } {
  return dbStats()
}
