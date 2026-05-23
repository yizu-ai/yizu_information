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
  DailyReport,
  FeedbackValue,
  PublicApiSettings,
  ReportItem,
  SavedItem,
} from '@/types'

type MainView = 'sources' | 'favorites'
type SourceKey = 'github' | 'x' | 'wechat'

const sourceTabs: Array<{ key: SourceKey; label: string; icon: typeof GitBranch }> = [
  { key: 'github', label: 'GitHub Trending', icon: GitBranch },
  { key: 'x', label: 'X.com', icon: Rss },
  { key: 'wechat', label: '微信公众号', icon: Newspaper },
]

const viewTabs: Array<{ key: MainView; label: string; icon: typeof Bookmark }> = [
  { key: 'sources', label: '推荐池', icon: Rss },
  { key: 'favorites', label: '收藏', icon: Bookmark },
]

function App() {
  const [dates, setDates] = useState<string[]>([])
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [favorites, setFavorites] = useState<SavedItem[]>([])
  const [settings, setSettings] = useState<PublicApiSettings | null>(null)
  const [activeView, setActiveView] = useState<MainView>('sources')
  const [activeSource, setActiveSource] = useState<SourceKey>('github')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadAll()
  }, [])

  const visibleReportItems = useMemo(() => {
    return report?.items.filter((item) => item.feedback !== 'ignore') ?? []
  }, [report])

  const sortedFavorites = useMemo(() => sortSavedItems(favorites), [favorites])

  async function loadAll() {
    setIsLoading(true)
    setError(null)

    try {
      const [bootstrap, favoriteData, settingsData] = await Promise.all([
        fetchJson('/api/bootstrap') as Promise<BootstrapResponse>,
        fetchJson('/api/favorites') as Promise<{ items: SavedItem[] }>,
        fetchJson('/api/settings') as Promise<{ settings: PublicApiSettings }>,
      ])
      setDates(bootstrap.dates)
      setActiveDate(bootstrap.activeDate)
      setReport(bootstrap.report)
      setFavorites(sortSavedItems(favoriteData.items))
      setSettings(settingsData.settings)
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

  async function submitFeedback(repo: string, feedback: FeedbackValue) {
    if (!report) {
      return
    }

    const selectedItem = report.items.find((item) => item.repo === repo)
    const current = selectedItem?.feedback ?? null
    const nextFeedback = current === feedback ? null : feedback

    patchItem(repo, { feedback: nextFeedback })
    if (selectedItem) {
      if (nextFeedback === 'favorite') {
        setFavorites((items) => sortSavedItems(upsertSavedItem(items, { ...selectedItem, feedback: 'favorite' })))
      } else {
        setFavorites((items) => items.filter((item) => item.repo !== repo))
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
    const currentItem =
      report?.items.find((item) => item.repo === repo) ?? favorites.find((item) => item.repo === repo)
    const nextRating = currentItem?.rating === rating ? undefined : rating

    patchItem(repo, { rating: nextRating })
    setFavorites((items) =>
      sortSavedItems(items.map((item) => (item.repo === repo ? { ...item, rating: nextRating } : item))),
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
      sortSavedItems(items.map((item) => (item.repo === repo ? { ...item, note: trimmedNote || undefined } : item))),
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
    setFavorites((items) => items.filter((item) => item.repo !== repo))

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
        <Hero onRefresh={loadAll} />

        {error ? (
          <Alert className="border-[#c7d2fe] bg-white/85 text-[#172033] shadow-sm">
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {activeView === 'sources' ? (
          <section className="flex flex-col gap-5">
            <PillTabs
              items={sourceTabs}
              activeKey={activeSource}
              onSelect={(key) => setActiveSource(key as SourceKey)}
            />

            {activeSource === 'github' ? (
              <>
                <DateTabs activeDate={activeDate} dates={dates} onSelect={selectDate} />
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
              <PlaceholderSource label={activeSource === 'x' ? 'X.com' : '微信公众号'} />
            )}
          </section>
        ) : null}

        {activeView === 'favorites' ? (
          <SavedList
            title="收藏项目"
            emptyText="收藏过的项目会出现在这里。"
            items={sortedFavorites}
            expanded={expanded}
            onToggle={toggleExpanded}
            onNote={submitNote}
            onRating={submitRating}
            onRemove={removeFavorite}
          />
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

function Hero({ onRefresh }: { onRefresh: () => void }) {
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
            onClick={onRefresh}
          >
            <RefreshCw />
            刷新信息池
          </Button>
          <span className="rounded-full border border-[#c7d2fe] bg-white/70 px-4 py-2 text-sm font-medium text-[#4f46e5]">
            GitHub Trending 已接入
          </span>
        </div>
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
  onSelect,
}: {
  activeDate: string | null
  dates: string[]
  onSelect: (date: string) => void
}) {
  if (dates.length === 0) {
    return <div className="text-sm text-[#61708f]">暂无历史日期</div>
  }

  return (
    <div className="flex max-w-full gap-2 overflow-x-auto">
      {dates.map((date) => (
        <button
          key={date}
          type="button"
          className={[
            'h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition',
            activeDate === date ? 'bg-[#172033] text-white' : 'bg-white/75 text-[#4f46e5] hover:bg-white',
          ].join(' ')}
          onClick={() => onSelect(date)}
        >
          {date}
        </button>
      ))}
    </div>
  )
}

function CardList({
  items,
  expanded,
  onToggle,
  onFeedback,
  onRating,
  onNote,
}: {
  items: ReportItem[]
  expanded: Set<string>
  onToggle: (repo: string) => void
  onFeedback: (repo: string, feedback: FeedbackValue) => void
  onRating: (repo: string, rating: number) => void
  onNote: (repo: string, note: string) => void
}) {
  if (items.length === 0) {
    return <EmptyState text="当前没有可展示的项目。" />
  }

  return (
    <section className="grid gap-4">
      {items.map((item, index) => (
        <ProjectCard
          key={item.repo}
          index={index + 1}
          item={item}
          isExpanded={expanded.has(item.repo)}
          onToggle={() => onToggle(item.repo)}
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
                {item.name}
                {item.nameZh ? (
                  <span className="ml-2 text-base font-semibold text-[#4f46e5]">{item.nameZh}</span>
                ) : null}
              </CardTitle>
              <p className="mt-3 text-sm leading-7 text-[#3f4d6b]">{item.brief ?? item.purpose ?? item.summary}</p>
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
      </CardHeader>

      {isExpanded ? (
        <CardContent className="grid gap-5 border-t border-[#edf2ff] px-5 pb-5 pt-5 sm:px-6">
          <div className="rounded-[1.25rem] bg-[#eef7ff] p-4">
            <div className="mb-2 text-xs font-bold text-[#4f46e5]">运用建议</div>
            <p className="text-sm leading-7 text-[#3f4d6b]">{item.useAdvice ?? item.relevanceReason}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-[#61708f]">
            <span className="break-all font-semibold text-[#172033]">{item.repo}</span>
            <a
              className="inline-flex items-center gap-1 font-bold text-[#4f46e5] hover:underline"
              href={item.url}
              rel="noreferrer"
              target="_blank"
            >
              打开 GitHub
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]">
              Stars {formatCompactNumber(item.stars)}
            </Badge>
            <Badge variant="outline" className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]">
              最近更新 {formatDate(item.updatedAt)}
            </Badge>
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
                  onClick={() => onFeedback(item.repo, 'favorite')}
                >
                  <Bookmark />
                  收藏
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full border-[#c7d2fe] bg-white text-[#4f46e5]"
                  onClick={() => onFeedback(item.repo, 'ignore')}
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
                onClick={() => onRemove(item.repo)}
              >
                <Trash2 />
                删除
              </Button>
            ) : null}

            {onRating ? <RatingControl rating={item.rating} onRate={(rating) => onRating(item.repo, rating)} /> : null}
          </div>

          {onNote ? <NoteEditor key={`${item.repo}-${item.note ?? ''}`} item={item} onSave={onNote} /> : null}
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

  return (
    <div className="rounded-[1.25rem] border border-[#c7d2fe] bg-white/80 p-4">
      <label className="mb-2 block text-xs font-bold text-[#4f46e5]" htmlFor={`note-${item.repo}`}>
        我的备注
      </label>
      <textarea
        id={`note-${item.repo}`}
        className="min-h-24 w-full resize-y rounded-2xl border border-[#c7d2fe] bg-[#f8fbff] p-3 text-sm text-[#172033] outline-none focus:border-[#7c3aed]"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="写下你为什么收藏、准备怎么用、后续要验证什么。"
      />
      <div className="mt-3 flex justify-end">
        <Button className="rounded-full bg-[#7c3aed] text-white hover:bg-[#6d28d9]" onClick={() => onSave(item.repo, note)}>
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

function PlaceholderSource({ label }: { label: string }) {
  return <EmptyState text={`${label} 板块已预留。`} />
}

function EmptyState({ text }: { text: string }) {
  return (
    <section className="rounded-[2rem] border border-white/80 bg-white/75 px-6 py-14 text-center shadow-sm">
      <p className="text-sm font-semibold text-[#61708f]">{text}</p>
    </section>
  )
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
  const index = items.findIndex((current) => current.repo === item.repo)
  if (index === -1) {
    return [item, ...items]
  }

  return items.map((current) => (current.repo === item.repo ? { ...current, ...item } : current))
}

function sortSavedItems(items: SavedItem[]): SavedItem[] {
  return [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name))
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
