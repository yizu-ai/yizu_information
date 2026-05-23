import 'dotenv/config'

import { summarizeWithProvider } from './deepseek'
import { enrichRepositoryDetails, fetchTrendingProjects } from './githubTrending'
import { buildReport, summarizeLocally } from './reportGenerator'
import { readFeedback, readProfile, readRawSettings, saveReport } from './storage'

const args = new Map(
  process.argv.slice(2).flatMap((arg, index, all) => {
    if (!arg.startsWith('--')) {
      return []
    }
    return [[arg.slice(2), all[index + 1] ?? '']]
  }),
)

const date = args.get('date') || new Date().toISOString().slice(0, 10)
const url = args.get('url') || 'https://github.com/trending?since=daily'
const warnings: string[] = []

const profile = await readProfile()
const feedback = await readFeedback()
const projects = await fetchTrendingProjects(url)
const settings = await readRawSettings()

const summarize = settings
  ? (items: Parameters<typeof summarizeWithProvider>[0], activeProfile: Parameters<typeof summarizeWithProvider>[1]) =>
      summarizeWithProvider(items, activeProfile, settings)
  : async (...params: Parameters<typeof summarizeLocally>) => {
      warnings.push('APIK 未配置，本次使用本地规则生成内容。')
      return summarizeLocally(...params)
    }

const report = await buildReport({
  date,
  projects: await enrichRepositoryDetails(projects),
  profile,
  feedback,
  summarize,
  warnings,
})

await saveReport(report)

console.log(`Generated ${report.items.length} items for ${report.date}`)
for (const warning of report.warnings) {
  console.warn(warning)
}
