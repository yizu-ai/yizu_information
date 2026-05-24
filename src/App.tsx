import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Bookmark,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  GitBranch,
  Newspaper,
  RefreshCw,
  Rss,
  Settings,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  BootstrapResponse,
  CollectSourcesResult,
  DailyReport,
  FeedbackValue,
  PublicApiSettings,
  PublicSourceSettings,
  ReportItem,
  SavedItem,
  SourceBootstrapResponse,
  SourceCost,
  SourceKey,
  SourceReport,
} from '@/types'

type MainView = 'sources' | 'favorites'

const sourceTabs: Array<{ key: SourceKey; label: string; icon: typeof GitBranch }> = [
  { key: 'shengcai', label: '生财有术', icon: Sparkles },
  { key: 'wechat', label: '微信公众号', icon: Newspaper },
  { key: 'github', label: 'GitHub Trending', icon: GitBranch },
  { key: 'x', label: 'X.com', icon: Rss },
]

const viewTabs: Array<{ key: MainView; label: string; icon: typeof Bookmark }> = [
  { key: 'sources', label: '推荐池', icon: Rss },
  { key: 'favorites', label: '收藏', icon: Bookmark },
]

function App() {
  const [dates, setDates] = useState<string[]>([])
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [sourceReports, setSourceReports] = useState<Partial<Record<SourceKey, SourceReport>>>({})
  const [sourceDates, setSourceDates] = useState<Partial<Record<SourceKey, string[]>>>({})
  const [activeSourceDates, setActiveSourceDates] = useState<Partial<Record<SourceKey, string | null>>>({})
  const [favorites, setFavorites] = useState<SavedItem[]>([])
  const [settings, setSettings] = useState<PublicApiSettings | null>(null)
  const [sourceSettings, setSourceSettings] = useState<PublicSourceSettings | null>(null)
  const [activeView, setActiveView] = useState<MainView>('sources')
  const [activeSource, setActiveSource] = useState<SourceKey>('shengcai')
  const [activeFavoriteSource, setActiveFavoriteSource] = useState<SourceKey>('shengcai')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isCollecting, setIsCollecting] = useState(false)
  const [collectionResult, setCollectionResult] = useState<CollectSourcesResult | null>(null)
  const [dateDeleteModes, setDateDeleteModes] = useState<Partial<Record<SourceKey, boolean>>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadAll()
  }, [])

  const visibleReportItems = useMemo(() => {
    return report?.items.filter((item) => item.feedback !== 'ignore') ?? []
  }, [report])

  const sortedFavorites = useMemo(
    () => sortSavedItems(favorites).filter((item) => getItemSource(item) === activeFavoriteSource),
    [activeFavoriteSource, favorites],
  )
  const activeSourceLabel = sourceTabs.find((item) => item.key === activeSource)?.label ?? '信息源'

  async function loadAll() {
    setIsLoading(true)
    setError(null)

    try {
      const [bootstrap, favoriteData, settingsData, sourceSettingsData, sourceBootstrapData] = await Promise.all([
        fetchJson('/api/bootstrap') as Promise<BootstrapResponse>,
        fetchJson('/api/favorites') as Promise<{ items: SavedItem[] }>,
        fetchJson('/api/settings') as Promise<{ settings: PublicApiSettings }>,
        fetchJson('/api/source-settings') as Promise<{ settings: PublicSourceSettings }>,
        Promise.all(
          sourceTabs.map(async (source) => ({
            source: source.key,
            data: (await fetchJson(`/api/source-bootstrap?source=${source.key}`)) as SourceBootstrapResponse,
          })),
        ),
      ])
      setDates(bootstrap.dates)
      setActiveDate(bootstrap.activeDate)
      setReport(bootstrap.report)
      setFavorites(sortSavedItems(favoriteData.items))
      setSettings(settingsData.settings)
      setSourceSettings(sourceSettingsData.settings)
      setSourceReports(Object.fromEntries(sourceBootstrapData.map((item) => [item.source, item.data.report])))
      setSourceDates(Object.fromEntries(sourceBootstrapData.map((item) => [item.source, item.data.dates])))
      setActiveSourceDates(Object.fromEntries(sourceBootstrapData.map((item) => [item.source, item.data.activeDate])))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }

  async function selectDate(date: string) {
    setActiveDate(date)
    setIsLoading(true)
    setError(null)

    try {
      const data = (await fetchJson(`/api/report?date=${encodeURIComponent(date)}`)) as { report: DailyReport }
      setReport(data.report)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }

  async function selectSourceDate(source: SourceKey, date: string) {
    setActiveSourceDates((current) => ({ ...current, [source]: date }))
    setIsLoading(true)
    setError(null)

    try {
      const data = (await fetchJson(
        `/api/source-report?source=${encodeURIComponent(source)}&date=${encodeURIComponent(date)}`,
      )) as { report: SourceReport }
      setSourceReports((current) => ({ ...current, [source]: data.report }))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }

  async function startCollection() {
    setIsCollecting(true)
    setError(null)
    setCollectionResult(null)

    try {
      const data = (await fetchJson('/api/collect', { method: 'POST' })) as { result: CollectSourcesResult }
      setCollectionResult(data.result)
      await loadAll()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsCollecting(false)
    }
  }

  async function updateSourceEnabled(sourceKey: SourceKey, enabled: boolean) {
    if (!sourceSettings) {
      return
    }

    const previousSettings = sourceSettings
    const nextEnabledSources = { ...sourceSettings.enabledSources, [sourceKey]: enabled }
    setSourceSettings({ ...sourceSettings, enabledSources: nextEnabledSources })

    try {
      const data = (await fetchJson('/api/source-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            enabledSources: nextEnabledSources,
          },
        }),
      })) as { settings: PublicSourceSettings }
      setSourceSettings(data.settings)
    } catch (requestError) {
      setSourceSettings(previousSettings)
      setError(getErrorMessage(requestError))
    }
  }

  async function deleteDate(sourceKey: SourceKey, date: string) {
    setIsLoading(true)
    setError(null)

    try {
      const url =
        sourceKey === 'github'
          ? `/api/report?date=${encodeURIComponent(date)}`
          : `/api/source-report?source=${encodeURIComponent(sourceKey)}&date=${encodeURIComponent(date)}`
      await fetchJson(url, { method: 'DELETE' })
      await loadAll()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
      setIsLoading(false)
    }
  }

  function toggleDateDeleteMode(sourceKey: SourceKey) {
    setDateDeleteModes((current) => ({ ...current, [sourceKey]: !current[sourceKey] }))
  }

  async function submitFeedback(repo: string, feedback: FeedbackValue) {
    const selectedItem = findItem(repo)
    const current = selectedItem?.feedback ?? null
    const nextFeedback = current === feedback ? null : feedback

    patchItem(repo, { feedback: nextFeedback })
    if (selectedItem) {
      if (nextFeedback === 'favorite') {
        setFavorites((items) => sortSavedItems(upsertSavedItem(items, { ...selectedItem, feedback: 'favorite' })))
      } else {
        setFavorites((items) => items.filter((item) => getItemId(item) !== repo))
      }
    }

    try {
      await fetchJson('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, feedback: nextFeedback }),
      })
      await refreshFavorites()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  async function submitRating(repo: string, rating: number) {
    const currentItem = findItem(repo) ?? favorites.find((item) => getItemId(item) === repo)
    const nextRating = currentItem?.rating === rating ? undefined : rating

    patchItem(repo, { rating: nextRating })
    setFavorites((items) =>
      sortSavedItems(items.map((item) => (getItemId(item) === repo ? { ...item, rating: nextRating } : item))),
    )

    try {
      await fetchJson('/api/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, rating: nextRating ?? null }),
      })
      await refreshFavorites()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  async function submitNote(repo: string, note: string) {
    const trimmedNote = note.trim()
    patchItem(repo, { note: trimmedNote || undefined })
    setFavorites((items) =>
      sortSavedItems(items.map((item) => (getItemId(item) === repo ? { ...item, note: trimmedNote || undefined } : item))),
    )

    try {
      await fetchJson('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, note }),
      })
      await refreshFavorites()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  async function removeFavorite(repo: string) {
    patchItem(repo, { feedback: null })
    setFavorites((items) => items.filter((item) => getItemId(item) !== repo))

    try {
      await fetchJson('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, feedback: null }),
      })
      await refreshFavorites()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  async function refreshFavorites() {
    const favoriteData = (await fetchJson('/api/favorites')) as { items: SavedItem[] }
    setFavorites(sortSavedItems(favoriteData.items))
  }

  function patchItem(repo: string, patch: Partial<ReportItem>) {
    setReport((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => (item.repo === repo ? { ...item, ...patch } : item)),
          }
        : current,
    )
    setSourceReports((current) =>
      Object.fromEntries(
        Object.entries(current).map(([source, sourceReport]) => [
          source,
          sourceReport
            ? {
                ...sourceReport,
                items: sourceReport.items.map((item) => (item.itemId === repo ? { ...item, ...patch } : item)),
              }
            : sourceReport,
        ]),
      ),
    )
  }

  function findItem(id: string): ReportItem | undefined {
    const githubItem = report?.items.find((item) => item.repo === id)
    if (githubItem) {
      return githubItem
    }
    for (const sourceReport of Object.values(sourceReports)) {
      const item = sourceReport?.items.find((sourceItem) => sourceItem.itemId === id)
      if (item) {
        return sourceItemToReportItem(item)
      }
    }
    return undefined
  }

  function toggleExpanded(repo: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(repo)) {
        next.delete(repo)
      } else {
        next.add(repo)
      }
      return next
    })
  }

  return (
    <main className="min-h-screen bg-[#eef3ff] text-[#172033]">
      <TopNav
        activeView={activeView}
        onSelectView={setActiveView}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-12 pt-8 sm:px-6 lg:px-8">
        <Hero onRefresh={loadAll} onCollect={startCollection} isCollecting={isCollecting} />

        {error ? (
          <Alert className="border-[#c7d2fe] bg-white/85 text-[#172033] shadow-sm">
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {collectionResult ? <CollectionStatus result={collectionResult} /> : null}

        {activeView === 'sources' ? (
          <section className="flex flex-col gap-5">
            <PillTabs
              items={sourceTabs}
              activeKey={activeSource}
              onSelect={(key) => setActiveSource(key as SourceKey)}
            />

            {sourceSettings ? (
              <SourceCollectionSwitches
                enabledSources={sourceSettings.enabledSources}
                isCollecting={isCollecting}
                onToggle={updateSourceEnabled}
              />
            ) : null}

            {sourceSettings ? (
              <SourceSettingsPanel
                activeSource={activeSource}
                settings={sourceSettings}
                onSaved={(next) => setSourceSettings(next)}
              />
            ) : null}

            {activeSource === 'github' ? (
              <>
                <DateTabs
                  activeDate={activeDate}
                  dates={dates}
                  deleteMode={Boolean(dateDeleteModes.github)}
                  onDelete={(date) => deleteDate('github', date)}
                  onSelect={selectDate}
                  onToggleDeleteMode={() => toggleDateDeleteMode('github')}
                />
                {isLoading ? <LoadingList /> : null}
                {!isLoading && report?.warnings.length ? (
                  <Alert className="border-[#c7d2fe] bg-white/85 text-[#172033] shadow-sm">
                    <AlertTitle>生成提示</AlertTitle>
                    <AlertDescription>{report.warnings.join(' ')}</AlertDescription>
                  </Alert>
                ) : null}
                {!isLoading ? (
                  <CardList
                    items={visibleReportItems}
                    expanded={expanded}
                    onToggle={toggleExpanded}
                    onFeedback={submitFeedback}
                    onRating={submitRating}
                    onNote={submitNote}
                  />
                ) : null}
              </>
            ) : (
              <>
                <DateTabs
                  activeDate={activeSourceDates[activeSource] ?? null}
                  dates={sourceDates[activeSource] ?? []}
                  deleteMode={Boolean(dateDeleteModes[activeSource])}
                  onDelete={(date) => deleteDate(activeSource, date)}
                  onSelect={(date) => selectSourceDate(activeSource, date)}
                  onToggleDeleteMode={() => toggleDateDeleteMode(activeSource)}
                />
                {activeSource === 'wechat' ? <SourceCostNote cost={sourceReports.wechat?.cost} /> : null}
                {isLoading ? <LoadingList /> : null}
                {!isLoading ? (
                  <CardList
                    items={(sourceReports[activeSource]?.items ?? [])
                      .filter((item) => item.feedback !== 'ignore')
                      .map(sourceItemToReportItem)}
                    emptyText={`${activeSourceLabel} 暂无采集结果。`}
                    expanded={expanded}
                    onToggle={toggleExpanded}
                    onFeedback={submitFeedback}
                    onRating={submitRating}
                    onNote={submitNote}
                  />
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {activeView === 'favorites' ? (
          <section className="grid gap-5">
            <PillTabs
              items={sourceTabs}
              activeKey={activeFavoriteSource}
              onSelect={(key) => setActiveFavoriteSource(key as SourceKey)}
            />
            <SavedList
              title={`${sourceTabs.find((item) => item.key === activeFavoriteSource)?.label ?? '信息源'}收藏`}
              emptyText="这个来源收藏过的内容会出现在这里。"
              items={sortedFavorites}
              expanded={expanded}
              onToggle={toggleExpanded}
              onNote={submitNote}
              onRating={submitRating}
              onRemove={removeFavorite}
            />
          </section>
        ) : null}
      </div>

      {isSettingsOpen ? (
        <SettingsDialog
          settings={settings}
          onClose={() => setIsSettingsOpen(false)}
          onSaved={(next) => setSettings(next)}
        />
      ) : null}
    </main>
  )
}

function TopNav({
  activeView,
  onSelectView,
  onOpenSettings,
}: {
  activeView: MainView
  onSelectView: (view: MainView) => void
  onOpenSettings: () => void
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 font-semibold text-[#4f46e5]">
          <span className="grid size-9 place-items-center rounded-2xl bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/25">
            <Sparkles className="size-5" />
          </span>
          <span className="text-lg">一卒的信息源</span>
        </div>

        <nav className="hidden items-center gap-10 text-sm font-medium sm:flex">
          {viewTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={[
                'relative h-16 text-[#172033] transition hover:text-[#4f46e5]',
                activeView === item.key ? 'text-[#4f46e5]' : '',
              ].join(' ')}
              onClick={() => onSelectView(item.key)}
            >
              {item.label}
              {activeView === item.key ? (
                <span className="absolute bottom-0 left-1/2 h-1 w-7 -translate-x-1/2 rounded-full bg-[#7c3aed]" />
              ) : null}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-[#edf2ff] p-1 sm:hidden">
            {viewTabs.map((item) => (
              <button
                key={item.key}
                type="button"
                className={[
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                  activeView === item.key ? 'bg-[#7c3aed] text-white' : 'text-[#4f46e5]',
                ].join(' ')}
                onClick={() => onSelectView(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon-lg"
            className="rounded-full border-[#7c3aed] bg-white text-[#4f46e5] hover:bg-[#edf2ff]"
            onClick={onOpenSettings}
            aria-label="配置 APIK"
          >
            <Settings />
          </Button>
        </div>
      </div>
    </header>
  )
}

function Hero({
  onRefresh,
  onCollect,
  isCollecting,
}: {
  onRefresh: () => void
  onCollect: () => void
  isCollecting: boolean
}) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,#f6f8ff_0%,#e9f1ff_52%,#f5efff_100%)] px-6 py-10 shadow-[0_28px_70px_rgba(79,70,229,0.14)] sm:px-10 lg:px-14">
      <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(90deg,transparent,#c7d2fe,transparent)] opacity-35" />
      <div className="relative max-w-4xl">
        <Badge className="rounded-full bg-white/80 px-5 py-1.5 text-sm font-bold text-[#4f46e5] shadow-sm">
          优质信息池
        </Badge>
        <h1 className="mt-8 max-w-4xl text-5xl font-black tracking-normal text-[#172033] sm:text-6xl">
          筛选优质信息，告别信息焦虑
        </h1>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            className="h-12 rounded-2xl bg-[#7c3aed] px-5 text-base text-white shadow-lg shadow-[#7c3aed]/25 hover:bg-[#6d28d9]"
            disabled={isCollecting}
            onClick={onCollect}
          >
            <RefreshCw className={isCollecting ? 'animate-spin' : ''} />
            {isCollecting ? '采集中' : '开始采集'}
          </Button>
          <Button
            variant="outline"
            className="h-12 rounded-2xl border-[#c7d2fe] bg-white/80 px-5 text-base text-[#4f46e5] hover:bg-white"
            onClick={onRefresh}
          >
            <RefreshCw />
            刷新信息池
          </Button>
        </div>
      </div>
    </section>
  )
}

function CollectionStatus({ result }: { result: CollectSourcesResult }) {
  return (
    <Alert className="border-[#c7d2fe] bg-white/85 text-[#172033] shadow-sm">
      <AlertTitle>采集完成</AlertTitle>
      <AlertDescription>
        <div className="mt-2 flex flex-wrap gap-2">
          {result.results.map((item) => (
            <Badge key={item.sourceKey} variant="outline" className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]">
              {sourceTabs.find((source) => source.key === item.sourceKey)?.label ?? item.sourceKey}：
              {formatRunStatus(item.status)}
              {typeof item.itemCount === 'number' ? ` ${item.itemCount} 条` : ''}
              {item.message ? ` - ${item.message}` : ''}
            </Badge>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  )
}

function SourceCollectionSwitches({
  enabledSources,
  isCollecting,
  onToggle,
}: {
  enabledSources: Record<SourceKey, boolean>
  isCollecting: boolean
  onToggle: (source: SourceKey, enabled: boolean) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {sourceTabs.map((source) => {
        const enabled = enabledSources[source.key]
        return (
          <button
            key={source.key}
            type="button"
            disabled={isCollecting}
            className={[
              'inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition',
              enabled
                ? 'border-[#a5b4fc] bg-white text-[#4f46e5]'
                : 'border-[#d4d8e8] bg-white/55 text-[#7b849d]',
              isCollecting ? 'cursor-not-allowed opacity-60' : 'hover:border-[#7c3aed]',
            ].join(' ')}
            onClick={() => onToggle(source.key, !enabled)}
          >
            {enabled ? '采集' : '不采集'}：{source.label}
          </button>
        )
      })}
    </div>
  )
}

function SourceSettingsPanel({
  activeSource,
  settings,
  onSaved,
}: {
  activeSource: SourceKey
  settings: PublicSourceSettings
  onSaved: (settings: PublicSourceSettings) => void
}) {
  const [wechatAccounts, setWechatAccounts] = useState(settings.wechat.accounts.join('\n'))
  const [wechatDajialaApiKey, setWechatDajialaApiKey] = useState('')
  const [isWechatConfigOpen, setIsWechatConfigOpen] = useState(false)
  const [xBearerToken, setXBearerToken] = useState('')
  const [xTopics, setXTopics] = useState(
    settings.x.topics.map((topic) => `${topic.name}: ${topic.keywords.join(', ')}`).join('\n'),
  )
  const [message, setMessage] = useState<string | null>(null)

  async function saveWechat() {
    const data = (await fetchJson('/api/source-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          wechat: {
            accounts: wechatAccounts
              .split('\n')
              .map((account) => account.trim())
              .filter(Boolean),
            dajialaApiKey: wechatDajialaApiKey,
          },
        },
      }),
    })) as { settings: PublicSourceSettings }
    onSaved(data.settings)
    setWechatDajialaApiKey('')
    setMessage('公众号配置已保存')
  }

  async function saveX() {
    const topics = xTopics
      .split('\n')
      .map((line, index) => {
        const [namePart, keywordPart] = line.split(':')
        const name = namePart?.trim()
        const keywords = (keywordPart ?? '')
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean)
        return name && keywords.length > 0 ? { key: slugify(`${name}-${index}`), name, keywords } : null
      })
      .filter(Boolean)
    const data = (await fetchJson('/api/source-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          x: {
            bearerToken: xBearerToken,
            dailyLimit: 20,
            topics,
          },
        },
      }),
    })) as { settings: PublicSourceSettings }
    onSaved(data.settings)
    setXBearerToken('')
    setMessage('X.com 配置已保存')
  }

  if (activeSource === 'github') {
    return null
  }

  if (activeSource === 'shengcai') {
    return (
      <section className="rounded-[1.5rem] border border-white/80 bg-white/70 p-4 text-sm text-[#61708f] shadow-sm">
        生财有术入口：<span className="font-semibold text-[#172033]">{settings.shengcai.entryUrl}</span>
      </section>
    )
  }

  if (activeSource === 'wechat') {
    const configuredAccounts = settings.wechat.accounts
    return (
      <section className="grid gap-3 rounded-[1.5rem] border border-white/80 bg-white/70 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[#61708f]">
            已配置：
            {configuredAccounts.length > 0 ? (
              configuredAccounts.map((account) => (
                <Badge key={account} variant="outline" className="mx-1 rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]">
                  {account}
                </Badge>
              ))
            ) : (
              <span className="font-semibold text-[#172033]">暂无</span>
            )}
          </div>
          <Button
            variant="outline"
            className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]"
            onClick={() => setIsWechatConfigOpen((current) => !current)}
          >
            {isWechatConfigOpen ? '收起配置' : '编辑公众号'}
          </Button>
        </div>
        {isWechatConfigOpen ? (
          <>
            <label className="text-xs font-bold text-[#4f46e5]" htmlFor="wechat-accounts">
              公众号名称，每行一个
            </label>
            <textarea
              id="wechat-accounts"
              className="min-h-24 rounded-2xl border border-[#c7d2fe] bg-[#f8fbff] p-3 text-sm outline-none focus:border-[#7c3aed]"
              value={wechatAccounts}
              onChange={(event) => setWechatAccounts(event.target.value)}
            />
            <label className="text-xs font-bold text-[#4f46e5]" htmlFor="wechat-dajiala-key">
              极致了 API Key {settings.wechat.hasDajialaApiKey ? '（已保存）' : ''}
            </label>
            <input
              id="wechat-dajiala-key"
              className="rounded-2xl border border-[#c7d2fe] bg-[#f8fbff] p-3 text-sm outline-none focus:border-[#7c3aed]"
              type="password"
              value={wechatDajialaApiKey}
              onChange={(event) => setWechatDajialaApiKey(event.target.value)}
              placeholder={settings.wechat.hasDajialaApiKey ? '留空则不修改' : '粘贴极致了 API Key'}
            />
          </>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-[#61708f]">{message}</span>
          {isWechatConfigOpen ? (
            <Button className="rounded-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]" onClick={saveWechat}>
              保存公众号配置
            </Button>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <section className="grid gap-3 rounded-[1.5rem] border border-white/80 bg-white/70 p-4 shadow-sm">
      <label className="text-xs font-bold text-[#4f46e5]" htmlFor="x-token">
        X Bearer Token {settings.x.hasBearerToken ? '（已保存）' : ''}
      </label>
      <input
        id="x-token"
        className="rounded-2xl border border-[#c7d2fe] bg-[#f8fbff] p-3 text-sm outline-none focus:border-[#7c3aed]"
        type="password"
        value={xBearerToken}
        onChange={(event) => setXBearerToken(event.target.value)}
        placeholder="保存后不会回显明文"
      />
      <label className="text-xs font-bold text-[#4f46e5]" htmlFor="x-topics">
        方向关键词，格式：方向: keyword1, keyword2
      </label>
      <textarea
        id="x-topics"
        className="min-h-28 rounded-2xl border border-[#c7d2fe] bg-[#f8fbff] p-3 text-sm outline-none focus:border-[#7c3aed]"
        value={xTopics}
        onChange={(event) => setXTopics(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[#61708f]">{message}</span>
        <Button className="rounded-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]" onClick={saveX}>
          保存 X 配置
        </Button>
      </div>
    </section>
  )
}

function PillTabs({
  items,
  activeKey,
  onSelect,
}: {
  items: Array<{ key: string; label: string; icon: typeof Bookmark }>
  activeKey: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="flex max-w-full gap-3 overflow-x-auto">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.key}
            type="button"
            className={[
              'inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-5 text-sm font-semibold transition',
              activeKey === item.key
                ? 'border-[#7c3aed] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/20'
                : 'border-white bg-white/75 text-[#4f46e5] hover:border-[#c7d2fe]',
            ].join(' ')}
            onClick={() => onSelect(item.key)}
          >
            <Icon className="size-4" />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function DateTabs({
  activeDate,
  dates,
  deleteMode = false,
  onDelete,
  onSelect,
  onToggleDeleteMode,
}: {
  activeDate: string | null
  dates: string[]
  deleteMode?: boolean
  onDelete?: (date: string) => void
  onSelect: (date: string) => void
  onToggleDeleteMode?: () => void
}) {
  if (dates.length === 0) {
    return (
      <div className="flex max-w-full items-center gap-2 overflow-x-auto py-1">
        <div className="text-sm text-[#61708f]">暂无历史日期</div>
        {deleteMode && onToggleDeleteMode ? <DateDeleteModeButton deleteMode onClick={onToggleDeleteMode} /> : null}
      </div>
    )
  }

  return (
    <div className="flex max-w-full items-center gap-2 overflow-x-auto py-1">
      <div className="flex gap-2">
        {dates.map((date) => (
          <div key={date} className="relative shrink-0">
            <button
              type="button"
              className={[
                'h-9 rounded-full px-4 text-sm font-semibold transition',
                activeDate === date ? 'bg-[#172033] text-white' : 'bg-white/75 text-[#4f46e5] hover:bg-white',
              ].join(' ')}
              onClick={() => onSelect(date)}
            >
              {date}
            </button>
            {deleteMode && onDelete ? (
              <button
                type="button"
                aria-label={`删除 ${date}`}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-[#ef4444] text-xs font-black leading-none text-white shadow-sm ring-2 ring-white"
                onClick={(event) => {
                  event.stopPropagation()
                  onDelete(date)
                }}
              >
                x
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {onToggleDeleteMode ? <DateDeleteModeButton deleteMode={deleteMode} onClick={onToggleDeleteMode} /> : null}
    </div>
  )
}

function DateDeleteModeButton({ deleteMode, onClick }: { deleteMode: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={[
        'h-8 shrink-0 rounded-full border px-3 text-xs font-bold transition',
        deleteMode
          ? 'border-[#16a34a] bg-[#16a34a] text-white'
          : 'border-[#c7d2fe] bg-white/75 text-[#4f46e5] hover:bg-white',
      ].join(' ')}
      onClick={onClick}
    >
      {deleteMode ? '保存' : '删除'}
    </button>
  )
}

function CardList({
  items,
  emptyText = '当前没有可展示的项目。',
  expanded,
  onToggle,
  onFeedback,
  onRating,
  onNote,
}: {
  items: ReportItem[]
  emptyText?: string
  expanded: Set<string>
  onToggle: (repo: string) => void
  onFeedback: (repo: string, feedback: FeedbackValue) => void
  onRating: (repo: string, rating: number) => void
  onNote: (repo: string, note: string) => void
}) {
  if (items.length === 0) {
    return <EmptyState text={emptyText} />
  }

  return (
    <section className="grid gap-4">
      {items.map((item, index) => (
        <ProjectCard
          key={`${getItemId(item)}-${index}`}
          index={index + 1}
          item={item}
          isExpanded={expanded.has(getItemId(item))}
          onToggle={() => onToggle(getItemId(item))}
          onFeedback={onFeedback}
          onRating={onRating}
          onNote={onNote}
        />
      ))}
    </section>
  )
}

function ProjectCard({
  index,
  item,
  isExpanded,
  onToggle,
  onFeedback,
  onRating,
  onNote,
  onRemove,
}: {
  index: number
  item: ReportItem
  isExpanded: boolean
  onToggle: () => void
  onFeedback?: (repo: string, feedback: FeedbackValue) => void
  onRating?: (repo: string, rating: number) => void
  onNote?: (repo: string, note: string) => void
  onRemove?: (repo: string) => void
}) {
  const itemId = getItemId(item)
  const source = getItemSource(item)
  const title = item.title ?? item.name
  const subtitle = source === 'github' ? item.nameZh : item.authorName
  const summary = item.contentSummary ?? item.brief ?? item.purpose ?? item.summary
  const advice = item.essenceSummary ?? item.useAdvice ?? item.relevanceReason
  const link = item.originalUrl ?? item.url
  const linkText = source === 'github' ? '打开 GitHub' : '打开原文'

  return (
    <Card className="overflow-hidden rounded-[1.75rem] border-white/80 bg-white/78 shadow-[0_18px_50px_rgba(37,99,235,0.10)] backdrop-blur">
      <CardHeader className="min-w-0 p-5 sm:p-6">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#edf2ff] text-sm font-black text-[#4f46e5]">
              {index}
            </span>
            <div className="min-w-0">
              <CardTitle className="break-words text-xl font-black tracking-normal text-[#172033]">
                {title}
                {subtitle ? (
                  <span className="ml-2 text-base font-semibold text-[#4f46e5]">{subtitle}</span>
                ) : null}
              </CardTitle>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]"
            onClick={onToggle}
            aria-label={isExpanded ? '收起卡片' : '展开卡片'}
          >
            {isExpanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
        {summary ? (
          <div className="mt-5 rounded-[1.25rem] bg-white p-4 ring-1 ring-[#dbe5ff]">
            <div className="mb-2 text-xs font-bold text-[#4f46e5]">内容摘要</div>
            <p className="whitespace-pre-line text-sm leading-7 text-[#3f4d6b]">{summary}</p>
          </div>
        ) : null}
      </CardHeader>

      {isExpanded ? (
        <CardContent className="grid gap-5 border-t border-[#edf2ff] px-5 pb-5 pt-5 sm:px-6">
          <div className="rounded-[1.25rem] bg-[#eef7ff] p-4">
            <div className="mb-2 text-xs font-bold text-[#4f46e5]">运用建议</div>
            <p className="text-sm leading-7 text-[#3f4d6b]">{advice}</p>
            {item.summaryStatus === 'failed' ? (
              <p className="mt-2 text-xs font-semibold text-[#b45309]">总结失败：{item.summaryError ?? '正文提取失败'}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-[#61708f]">
            <a
              className="inline-flex items-center gap-1 font-bold text-[#4f46e5] hover:underline"
              href={link}
              rel="noreferrer"
              target="_blank"
            >
              {linkText}
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]">
              {source === 'x' ? 'LIKE' : source === 'github' ? 'Stars' : '热度'}{' '}
              {typeof item.likes === 'number' ? formatCompactNumber(item.likes) : formatCompactNumber(item.stars)}
            </Badge>
            {(item.publishedAt || item.updatedAt) ? (
              <Badge variant="outline" className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]">
                {source === 'github' ? '最近更新' : '发布日期'} {formatDate(item.publishedAt ?? item.updatedAt)}
              </Badge>
            ) : null}
            {item.rating ? (
              <Badge variant="outline" className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]">
                {item.rating} 星
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {onFeedback ? (
              <>
                <Button
                  variant={item.feedback === 'favorite' ? 'default' : 'outline'}
                  className={[
                    'rounded-full',
                    item.feedback === 'favorite'
                      ? 'bg-[#7c3aed] text-white hover:bg-[#6d28d9]'
                      : 'border-[#c7d2fe] bg-white text-[#4f46e5]',
                  ].join(' ')}
                  onClick={() => onFeedback(itemId, 'favorite')}
                >
                  <Bookmark />
                  收藏
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]"
                  onClick={() => onFeedback(itemId, 'ignore')}
                >
                  <CircleSlash />
                  忽略
                </Button>
              </>
            ) : null}

            {onRemove ? (
              <Button
                variant="outline"
                className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]"
                onClick={() => onRemove(itemId)}
              >
                <Trash2 />
                删除
              </Button>
            ) : null}

            {onRating ? <RatingControl rating={item.rating} onRate={(rating) => onRating(itemId, rating)} /> : null}
          </div>

          {onNote ? <NoteEditor key={`${itemId}-${item.note ?? ''}`} item={item} onSave={onNote} /> : null}
        </CardContent>
      ) : null}
    </Card>
  )
}

function RatingControl({ rating, onRate }: { rating?: number; onRate: (rating: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-[#c7d2fe] bg-white px-3 py-1.5">
      <span className="mr-1 text-xs font-bold text-[#4f46e5]">星标</span>
      {Array.from({ length: 5 }, (_, index) => {
        const value = index + 1
        const active = Boolean(rating && value <= rating)
        return (
          <button
            key={value}
            type="button"
            className={active ? 'text-[#7c3aed]' : 'text-[#b7c2e6]'}
            onClick={() => onRate(value)}
            aria-label={`${value} 星`}
          >
            <Star className={['size-4', active ? 'fill-current' : ''].join(' ')} />
          </button>
        )
      })}
    </div>
  )
}

function SavedList({
  title,
  emptyText,
  items,
  expanded,
  onToggle,
  onNote,
  onRating,
  onRemove,
}: {
  title: string
  emptyText: string
  items: SavedItem[]
  expanded: Set<string>
  onToggle: (repo: string) => void
  onNote: (repo: string, note: string) => void
  onRating: (repo: string, rating: number) => void
  onRemove: (repo: string) => void
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-3xl font-black tracking-normal text-[#172033]">{title}</h2>
        <span className="text-sm font-semibold text-[#4f46e5]">按星级排序</span>
      </div>
      {items.length === 0 ? <EmptyState text={emptyText} /> : null}
      {items.map((item, index) => (
        <ProjectCard
          key={item.repo}
          index={index + 1}
          item={item}
          isExpanded={expanded.has(item.repo)}
          onToggle={() => onToggle(item.repo)}
          onNote={onNote}
          onRating={onRating}
          onRemove={onRemove}
        />
      ))}
    </section>
  )
}

function NoteEditor({ item, onSave }: { item: ReportItem; onSave: (repo: string, note: string) => void }) {
  const [note, setNote] = useState(item.note ?? '')
  const itemId = getItemId(item)

  return (
    <div className="rounded-[1.25rem] border border-[#c7d2fe] bg-white/80 p-4">
      <label className="mb-2 block text-xs font-bold text-[#4f46e5]" htmlFor={`note-${itemId}`}>
        我的备注
      </label>
      <textarea
        id={`note-${itemId}`}
        className="min-h-24 w-full resize-y rounded-2xl border border-[#c7d2fe] bg-[#f8fbff] p-3 text-sm text-[#172033] outline-none focus:border-[#7c3aed]"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="写下你为什么收藏、准备怎么用、后续要验证什么。"
      />
      <div className="mt-3 flex justify-end">
        <Button className="rounded-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]" onClick={() => onSave(itemId, note)}>
          保存备注
        </Button>
      </div>
    </div>
  )
}

function SettingsDialog({
  settings,
  onClose,
  onSaved,
}: {
  settings: PublicApiSettings | null
  onClose: () => void
  onSaved: (settings: PublicApiSettings) => void
}) {
  const [providerName, setProviderName] = useState(settings?.providerName ?? 'DeepSeek')
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? 'https://api.deepseek.com')
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  async function saveSettings() {
    setMessage(null)
    const data = (await fetchJson('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerName, baseUrl, apiKey }),
    })) as { settings: PublicApiSettings }
    onSaved(data.settings)
    setApiKey('')
    setMessage('已保存到本地配置。')
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#172033]/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black tracking-normal text-[#172033]">配置 APIK</h2>
            <p className="mt-1 text-sm text-[#61708f]">按 OpenAI-compatible 的 /chat/completions 格式调用。</p>
          </div>
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="grid gap-4">
          <Field label="供应商名称" value={providerName} onChange={setProviderName} placeholder="DeepSeek" />
          <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.deepseek.com" />
          <Field
            label="APIK"
            value={apiKey}
            onChange={setApiKey}
            placeholder={settings?.hasApiKey ? '已保存，留空则不修改' : '粘贴你的 APIK'}
            type="password"
          />
        </div>

        {message ? <p className="mt-4 text-sm text-[#61708f]">{message}</p> : null}

        <div className="mt-6 flex justify-end">
          <Button className="rounded-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]" onClick={() => void saveSettings()}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-bold text-[#4f46e5]">{label}</span>
      <input
        className="h-11 rounded-2xl border border-[#c7d2fe] bg-[#f8fbff] px-4 text-[#172033] outline-none focus:border-[#7c3aed]"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <section className="rounded-[2rem] border border-white/80 bg-white/75 px-6 py-14 text-center shadow-sm">
      <p className="text-sm font-semibold text-[#61708f]">{text}</p>
    </section>
  )
}

function SourceCostNote({ cost }: { cost?: SourceCost }) {
  if (!cost) {
    return null
  }

  const total =
    cost.estimatedMin === cost.estimatedMax
      ? formatCny(cost.estimatedMin)
      : `${formatCny(cost.estimatedMin)}-${formatCny(cost.estimatedMax)}`
  const details = cost.details.map((detail) => `${detail.label} ${detail.requests} 次`).join('，')

  return (
    <p className="text-xs leading-6 text-[#61708f]">
      本次极致了 API 预估费用：<span className="font-semibold text-[#4f46e5]">{total}</span>
      {details ? `（${details}）` : ''}。{cost.note}
    </p>
  )
}

function formatCny(value: number): string {
  return `¥${value.toFixed(2)}`
}

function LoadingList() {
  return (
    <section className="grid gap-4">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="rounded-[1.75rem] bg-white/75 p-6 shadow-sm">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="mt-4 h-6 w-4/5" />
        </div>
      ))}
    </section>
  )
}

function upsertSavedItem(items: SavedItem[], item: SavedItem): SavedItem[] {
  const index = items.findIndex((current) => getItemId(current) === getItemId(item))
  if (index === -1) {
    return [item, ...items]
  }

  return items.map((current) => (getItemId(current) === getItemId(item) ? { ...current, ...item } : current))
}

function sortSavedItems(items: SavedItem[]): SavedItem[] {
  return [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || getItemTitle(a).localeCompare(getItemTitle(b)))
}

function sourceItemToReportItem(item: SourceReport['items'][number]): ReportItem {
  return {
    ...item,
    repo: item.itemId,
    name: item.title,
    url: item.originalUrl,
    description: item.contentSummary,
    language: item.sourceKey,
    stars: item.likes ?? 0,
    todayStars: 0,
    score: item.likes ?? 0,
    matchedTracks: [],
    brief: item.contentSummary,
    useAdvice: item.essenceSummary,
  }
}

function getItemId(item: Pick<ReportItem, 'repo' | 'itemId'>): string {
  return item.itemId ?? item.repo
}

function getItemSource(item: Pick<ReportItem, 'sourceKey'>): SourceKey {
  return item.sourceKey ?? 'github'
}

function getItemTitle(item: Pick<ReportItem, 'name' | 'title'>): string {
  return item.title ?? item.name
}

function formatRunStatus(status: CollectSourcesResult['results'][number]['status']): string {
  if (status === 'success') {
    return '成功'
  }
  if (status === 'skipped') {
    return '已跳过'
  }
  return '失败'
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed: ${response.status}`)
  }

  return data
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value)
}

function formatDate(value?: string): string {
  if (!value) {
    return '未知'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

export default App
