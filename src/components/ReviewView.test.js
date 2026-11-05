import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REVIEW_FLUSH_WAIT_MS, REVIEW_REFRESH_INTERVAL_MS } from '../appConfig.js'
import ReviewView from './ReviewView.vue'

const ENDPOINT = 'https://script.google.com/macros/s/test/exec'
const access = { granted: true, code: 'code-1', deviceId: 'dev-mine', grantedAt: 1 }
const ADMIN_KEY = 'one-hand-typing-trainer:admin:v1'
const REVIEW_CACHE_KEY = 'one-hand-typing-trainer:review-cache:v1'

enableAutoUnmount(afterEach)

const day = (date, records, practiceMs, attempts, mistakes) => ({ date, records, practiceMs, attempts, mistakes })
const daily = Array.from({ length: 14 }, (_, index) => day(`2026-10-${String(21 + index).padStart(2, '0')}`, 0, 0, 0, 0))
  .map((entry) => (entry.date === '2026-10-31' ? entry : entry))
daily[11] = day('2026-11-01', 2, 120_000, 20, 5)
daily[13] = day('2026-11-03', 3, 90_000, 30, 3)

const stats = {
  generatedAt: 0,
  totals: { records: 5, practiceMs: 210_000, attempts: 50, mistakes: 8, days: 2, firstDate: '2026-11-01', lastDate: '2026-11-03' },
  today: day('2026-11-03', 3, 90_000, 30, 3),
  streak: 2,
  daily,
  keys: {
    f: { shown: 10, misses: 5 },
    j: { shown: 10, misses: 0 },
    d: { shown: 10, misses: 0 },
    a: { shown: 10, misses: 1 },
    g: { shown: 2, misses: 2 },
  },
  confusions: [
    { expected: 'f', pressed: 'g', count: 4 },
    { expected: 'a', pressed: 's', count: 1 },
  ],
}

const run = (overrides = {}) => ({
  ts: '2026-11-03T04:00:00.000Z', mode: 'timeAttack', hand: 'left', level: 1,
  includeSymbols: false, layout: 'jis', targetCount: 10, timeLimitSec: null,
  homePosition: false, endedBy: 'completed', activeMs: 12_000, inputMs: 10_000,
  completedQuestions: 10, correctCount: 40, mistakes: 2, attempts: 42, accuracy: 95,
  kpm: 240, menuOpenCount: 0, hpSuccessCount: 0, hpSkipCount: 0,
  hpAvgReturnMs: null, hpMinReturnMs: null, rankVersion: null,
  ...overrides,
})

const statsWithRuns = {
  ...stats,
  runs: [
    run(),
    run({
      ts: '2026-11-03T03:00:00.000Z', mode: 'timeLimit', targetCount: null,
      timeLimitSec: 60, homePosition: true, endedBy: 'ended', activeMs: 13_000,
      hpSuccessCount: 5, hpSkipCount: 1, hpAvgReturnMs: 1000, hpMinReturnMs: 800,
    }),
    run({ ts: '2026-11-02T04:00:00.000Z', activeMs: 14_000, inputMs: 12_000, kpm: 200 }),
  ],
}

const emptyStats = {
  ...stats,
  totals: { records: 0, practiceMs: 0, attempts: 0, mistakes: 0, days: 0, firstDate: null, lastDate: null },
  today: day('2026-11-03', 0, 0, 0, 0),
  streak: 0,
  daily: daily.map((entry) => day(entry.date, 0, 0, 0, 0)),
  keys: {},
  confusions: [],
}

function mockApi(handlers) {
  return vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    const handler = handlers[body.action]
    const payload = handler ? handler(body) : { ok: false, error: 'bad_request' }
    return { ok: true, json: async () => payload }
  })
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => { values.set(key, value) }),
    removeItem: vi.fn((key) => { values.delete(key) }),
    clear: vi.fn(() => { values.clear() }),
  }
}

function installMatchMedia(initialPortrait) {
  const state = {
    portrait: initialPortrait,
    listeners: new Set(),
    set(value) {
      state.portrait = value
      state.listeners.forEach((listener) => listener({ matches: value }))
    },
  }
  window.matchMedia = vi.fn((query) => ({
    get matches() { return query.includes('orientation: portrait') ? state.portrait : false },
    media: query,
    addEventListener: (_type, listener) => state.listeners.add(listener),
    removeEventListener: (_type, listener) => state.listeners.delete(listener),
  }))
  return state
}

function enabledSync(flushPending = vi.fn().mockResolvedValue({ sent: 0, remaining: 0 })) {
  return { isEnabled: vi.fn(() => true), flushPending }
}

// テストでは長押しの時間を短くする(本番は appConfig の ADMIN_LONG_PRESS_MS)
const TEST_PRESS_MS = 5

async function mountReview(fetchImpl, props = {}) {
  const wrapper = mount(ReviewView, {
    props: { endpoint: ENDPOINT, access, hand: 'left', fetchImpl, adminPressMs: TEST_PRESS_MS, ...props },
  })
  await flushPromises()
  return wrapper
}

// 管理者表示の入口は、見出しの長押し
async function openAdminPanel(wrapper) {
  await wrapper.get('[data-testid="review-title"]').trigger('pointerdown')
  await new Promise((resolve) => { setTimeout(resolve, TEST_PRESS_MS * 6) })
  await flushPromises()
}

describe('ReviewView(振り返り画面)', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete window.matchMedia
  })

  it('読み込み中を表示し、成功したら今日のまとめと合計を出す', async () => {
    let release
    const fetchImpl = vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, json: async () => ({ ok: true, stats }) })
    }))
    const wrapper = mount(ReviewView, { props: { endpoint: ENDPOINT, access, fetchImpl } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('読み込み中')
    release()
    await flushPromises()

    expect(wrapper.get('[data-testid="today-time"]').text()).toBe('2分')
    expect(wrapper.get('[data-testid="today-count"]').text()).toBe('3問')
    expect(wrapper.get('[data-testid="today-accuracy"]').text()).toBe('90%')
    expect(wrapper.get('[data-testid="streak"]').text()).toBe('2日')
    expect(wrapper.get('[data-testid="review-total"]').text()).toBe('これまでの合計: 2日 ・ 5問 ・ 4分')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ action: 'stats', code: 'code-1', deviceId: 'dev-mine' })
  })

  it('ヒートマップに、ミスの割合に応じた色の段階とパーセントを出す', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
    const key = (value) => wrapper.get(`.heat-key[data-key="${value}"]`)

    expect(key('f').classes()).toContain('heat-l4') // 50%
    expect(key('f').text()).toContain('50%')
    expect(key('d').classes()).toContain('heat-clean')
    expect(key('a').classes()).toContain('heat-l2') // 10%
    expect(key('g').classes()).toContain('heat-none') // 出題2回は少ない
    expect(key('g').text()).not.toContain('%')
    expect(key('q').classes()).toContain('heat-none') // 出題なし
    expect(key('f').attributes('aria-label')).toContain('出題10回、ミス5回(50%)')
    expect(key('g').attributes('aria-label')).toContain('回数が少ないため')
    expect(wrapper.get('[data-testid="weak-keys"]').text()).toContain('F(50%)')
  })

  it('既定では端末の手のキーを出し、左手・右手を切り替えられる(右手は記号も出る)', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }), { hand: 'right' })
    expect(wrapper.find('.heat-key[data-key="j"]').exists()).toBe(true)
    expect(wrapper.find('.heat-key[data-key="@"]').exists()).toBe(true)
    expect(wrapper.find('.heat-key[data-key="a"]').exists()).toBe(false)

    await wrapper.get('[data-testid="heat-left"]').trigger('click')
    expect(wrapper.find('.heat-key[data-key="a"]').exists()).toBe(true)
    expect(wrapper.find('.heat-key[data-key="j"]').exists()).toBe(false)
  })

  it('日ごとの棒グラフは練習した日だけ棒を描き、折れ線は練習した日の点を打つ', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
    expect(wrapper.findAll('[data-testid="bar"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="dot"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="chart-daily"]').attributes('aria-label')).toContain('2日練習')
    expect(wrapper.get('[data-testid="chart-accuracy"]').attributes('aria-label')).toContain('11/3の90%')
  })

  it('正答率がすべて50%以上なら縦軸を50〜100%に拡大し、50%未満があれば0〜100%にする', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
    const axisText = () => wrapper.get('[data-testid="chart-accuracy"]').findAll('text').map((t) => t.text())
    expect(axisText()).toEqual(expect.arrayContaining(['50%', '75%', '100%']))
    expect(axisText()).not.toContain('0%')

    const low = { ...stats, daily: stats.daily.map((entry, index) => (index === 13 ? day(entry.date, 3, 90_000, 30, 20) : entry)) }
    const second = await mountReview(mockApi({ stats: () => ({ ok: true, stats: low }) }))
    const lowAxis = second.get('[data-testid="chart-accuracy"]').findAll('text').map((t) => t.text())
    expect(lowAxis).toEqual(expect.arrayContaining(['0%', '50%', '100%']))
    expect(lowAxis).not.toContain('75%')
  })

  it('よくある押し間違いを多い順に出す', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
    const items = wrapper.findAll('[data-testid="confusions"] li')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('F のつもりで G を押した')
    expect(items[0].text()).toContain('4回')
  })

  it('旧GAS応答(runsなし)では既存項目を表示し、run関連セクションだけを出さない', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
    expect(wrapper.get('[data-testid="review-total"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="review-recent-runs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="review-personal-bests"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="review-kpm"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="review-home-position"]').exists()).toBe(false)
  })

  it('最近の練習・自己ベスト・KPM推移・ホームポジション成績を既存項目の下へ表示する', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats: statsWithRuns }) }))
    const recent = wrapper.get('[data-testid="review-recent-runs"]')
    expect(recent.text()).toContain('11/3 13:00')
    expect(recent.text()).toContain('タイムアタック10問')
    expect(recent.text()).toContain('制限時間60秒')
    expect(recent.text()).toContain('HP')
    expect(recent.text()).toContain('途中')
    expect(recent.text()).toContain('ランクB')
    expect(recent.text()).toContain('KPM240')
    expect(recent.text()).toContain('正答率95%')

    const best = wrapper.get('[data-testid="review-personal-bests"]')
    expect(best.text()).toContain('タイムアタック10問・左手・Lv.1')
    expect(best.text()).toContain('B・240 KPM')
    expect(wrapper.findAll('[data-testid="kpm-dot"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="chart-kpm"]').attributes('aria-label')).toContain('最新は11/3の240 KPM')

    const hp = wrapper.get('[data-testid="review-home-position"]')
    expect(hp.text()).toContain('成功5回')
    expect(hp.text()).toContain('スキップ1回')
    expect(hp.text()).toContain('平均復帰1.0秒')
    expect(wrapper.findAll('[data-testid="hp-dot"]')).toHaveLength(1)

    const headings = wrapper.findAll('.review-section h3').map((heading) => heading.text())
    expect(headings.indexOf('最近の練習')).toBeGreaterThan(headings.indexOf('よくある押し間違い'))
  })

  it('KPMの既定選択は表示タブの先頭で、endedだけが多い条件はタブに出さない', async () => {
    const withKpmChoices = {
      ...stats,
      runs: [
        run({ ts: '2026-11-03T05:00:00.000Z', hand: 'right' }),
        run({ ts: '2026-11-03T04:00:00.000Z', level: 3, endedBy: 'ended' }),
        run({ ts: '2026-11-03T03:00:00.000Z', level: 3, endedBy: 'ended' }),
        run({ ts: '2026-11-03T02:00:00.000Z' }),
        run({ ts: '2026-11-03T01:00:00.000Z' }),
      ],
    }
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats: withKpmChoices }) }))
    const tabs = wrapper.findAll('.review-condition-tabs button')

    expect(tabs).toHaveLength(1)
    expect(tabs[0].text()).toContain('左手・Lv.1')
    expect(tabs[0].attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.review-condition-current').text()).toContain('左手・Lv.1')
    expect(wrapper.findAll('[data-testid="kpm-dot"]')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('タイムアタック10問・左手・Lv.3・記号なし・JIS・HPなし')
  })

  it('候補がなければ自己ベストは「まだありません」、KPMが2回未満なら案内を出し、HPなしならHP成績を隠す', async () => {
    const onlyFree = {
      ...stats,
      runs: [run({ mode: 'free', targetCount: null, endedBy: 'ended' })],
    }
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats: onlyFree }) }))
    expect(wrapper.get('[data-testid="review-best-empty"]').text()).toBe('まだありません。')
    expect(wrapper.get('[data-testid="review-kpm-empty"]').text()).toContain('2回以上')
    expect(wrapper.find('[data-testid="chart-kpm"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="review-home-position"]').exists()).toBe(false)
  })

  it('不正なrun行だけを捨て、正常行は表示する', async () => {
    const malformed = { ...statsWithRuns, runs: [run(), { ...run(), attempts: 99 }] }
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats: malformed }) }))
    expect(wrapper.findAll('.review-run-list > li')).toHaveLength(1)
  })

  it('記録がまだ無いときは、案内だけを出し、グラフは出さない', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats: emptyStats }) }))
    expect(wrapper.get('[data-testid="review-empty"]').text()).toContain('まだ記録がありません')
    expect(wrapper.find('[data-testid="heatmap"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="chart-daily"]').exists()).toBe(false)
  })

  it('recordsが0件でも未完了runがあれば空案内を出さず、最近の練習と0件のまとめを表示する', async () => {
    const runsOnly = {
      ...emptyStats,
      runs: [run({ endedBy: 'ended', completedQuestions: 1 })],
    }
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats: runsOnly }) }))

    expect(wrapper.find('[data-testid="review-empty"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="review-recent-runs"]').text()).toContain('途中')
    expect(wrapper.get('[data-testid="today-count"]').text()).toBe('0問')
    expect(wrapper.get('[data-testid="today-accuracy"]').text()).toBe('-')
  })

  it('通信に失敗したらエラーと「もう一度」を出し、押すと再読み込みする', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true, stats }) })
    const wrapper = await mountReview(fetchImpl)
    expect(wrapper.get('[data-testid="review-error"]').text()).toContain('通信できませんでした')
    await wrapper.get('[data-testid="review-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="review-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="streak"]').text()).toBe('2日')
  })

  describe('送信完了を待ってから成績を取得する', () => {
    it('進行中のflushが終わるまでは取得を始めない', async () => {
      let releaseFlush
      const flushPending = vi.fn(() => new Promise((resolve) => { releaseFlush = resolve }))
      const fetchImpl = mockApi({ stats: () => ({ ok: true, stats }) })
      mount(ReviewView, {
        props: { endpoint: ENDPOINT, access, fetchImpl, syncService: enabledSync(flushPending) },
      })
      await flushPromises()
      expect(flushPending).toHaveBeenCalledTimes(1)
      expect(fetchImpl).not.toHaveBeenCalled()

      releaseFlush({ sent: 1, remaining: 0 })
      await flushPromises()
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('flushが上限を超えても成績取得へ進む', async () => {
      vi.useFakeTimers()
      const flushPending = vi.fn(() => new Promise(() => {}))
      const fetchImpl = mockApi({ stats: () => ({ ok: true, stats }) })
      mount(ReviewView, {
        props: { endpoint: ENDPOINT, access, fetchImpl, syncService: enabledSync(flushPending) },
      })
      await flushPromises()
      expect(fetchImpl).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(REVIEW_FLUSH_WAIT_MS)
      await flushPromises()
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('flushが失敗しても成績取得を続け、無効ならflushを呼ばない', async () => {
      const rejectedFlush = vi.fn().mockRejectedValue(new Error('offline'))
      const fetchImpl = mockApi({ stats: () => ({ ok: true, stats }) })
      await mountReview(fetchImpl, { syncService: enabledSync(rejectedFlush) })
      expect(fetchImpl).toHaveBeenCalledTimes(1)

      const disabledFlush = vi.fn()
      const disabledFetch = mockApi({ stats: () => ({ ok: true, stats }) })
      await mountReview(disabledFetch, {
        endpoint: '',
        syncService: { isEnabled: vi.fn(() => false), flushPending: disabledFlush },
      })
      expect(disabledFlush).not.toHaveBeenCalled()
      expect(disabledFetch).toHaveBeenCalledTimes(1)
    })
  })

  it('縦向きにするたび、直前の取得から20秒以内でも取り直す', async () => {
    const orientation = installMatchMedia(false)
    const fetchImpl = mockApi({ stats: () => ({ ok: true, stats }) })
    mount(ReviewView, { props: { endpoint: ENDPOINT, access, fetchImpl } })
    await flushPromises()
    expect(fetchImpl).not.toHaveBeenCalled()

    orientation.set(true)
    await flushPromises()
    orientation.set(false)
    orientation.set(true)
    await flushPromises()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('同じ対象の再読み込みでは古い表示を残して更新中を出し、失敗しても表示を残す', async () => {
    let releaseRefresh
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, stats }) })
      .mockImplementationOnce(() => new Promise((resolve) => { releaseRefresh = resolve }))
      .mockRejectedValueOnce(new TypeError('offline'))
    const wrapper = await mountReview(fetchImpl)

    const refreshing = wrapper.vm.load()
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="streak"]').text()).toBe('2日')
    expect(wrapper.get('[data-testid="review-refreshing"]').text()).toBe('更新中…')
    expect(wrapper.get('[data-testid="review-refreshing"]').attributes('role')).toBeUndefined()
    expect(wrapper.get('[data-testid="review-refreshing"]').attributes('aria-hidden')).toBe('true')

    releaseRefresh({ ok: true, json: async () => ({ ok: true, stats: { ...stats, streak: 4 } }) })
    await refreshing
    await wrapper.vm.load()
    await flushPromises()
    expect(wrapper.get('[data-testid="streak"]').text()).toBe('4日')
    expect(wrapper.get('[data-testid="review-refresh-error"]').text()).toContain('通信できませんでした')
  })

  it('同じ更新エラーは一度だけ通知し、理由が変わるともう一度通知する', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, stats }) })
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false, error: 'locked' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, stats }) })
      .mockRejectedValueOnce(new TypeError('offline'))
    const wrapper = await mountReview(fetchImpl)

    await wrapper.vm.load()
    expect(wrapper.get('[data-testid="review-refresh-error"]').attributes('role')).toBe('alert')

    await wrapper.vm.load()
    expect(wrapper.get('[data-testid="review-refresh-error"]').attributes('role')).toBeUndefined()
    expect(wrapper.get('[data-testid="review-refresh-error"]').attributes('aria-live')).toBeUndefined()

    await wrapper.vm.load()
    expect(wrapper.get('[data-testid="review-refresh-error"]').text()).toContain('しばらく表示できません')
    expect(wrapper.get('[data-testid="review-refresh-error"]').attributes('role')).toBe('alert')

    await wrapper.vm.load()
    expect(wrapper.find('[data-testid="review-refresh-error"]').exists()).toBe(false)
    await wrapper.vm.load()
    expect(wrapper.get('[data-testid="review-refresh-error"]').attributes('role')).toBe('alert')
  })

  describe('自分の成績キャッシュ', () => {
    it('runsを含む取得結果を必要な3項目だけで保存し、コード類を含めない', async () => {
      const storage = memoryStorage({ [ADMIN_KEY]: 'admin-secret' })
      vi.stubGlobal('localStorage', storage)
      await mountReview(mockApi({ stats: () => ({ ok: true, stats: statsWithRuns }) }))

      const saved = JSON.parse(storage.setItem.mock.calls.find(([key]) => key === REVIEW_CACHE_KEY)[1])
      expect(Object.keys(saved).sort()).toEqual(['deviceId', 'savedAt', 'stats'])
      expect(saved.deviceId).toBe(access.deviceId)
      expect(saved.stats).toEqual(statsWithRuns)
      expect(JSON.stringify(saved)).not.toContain(access.code)
      expect(JSON.stringify(saved)).not.toContain('admin-secret')
    })

    it('起動直後に同じ端末のキャッシュを表示し、そのまま更新する', async () => {
      let release
      const storage = memoryStorage({
        [REVIEW_CACHE_KEY]: JSON.stringify({ stats, savedAt: 123, deviceId: access.deviceId }),
      })
      vi.stubGlobal('localStorage', storage)
      const fetchImpl = vi.fn(() => new Promise((resolve) => { release = resolve }))
      const wrapper = mount(ReviewView, { props: { endpoint: ENDPOINT, access, fetchImpl } })
      await wrapper.vm.$nextTick()

      expect(wrapper.get('[data-testid="streak"]').text()).toBe('2日')
      expect(wrapper.get('[data-testid="review-refreshing"]').exists()).toBe(true)
      release({ ok: true, json: async () => ({ ok: true, stats: { ...stats, streak: 7 } }) })
      await flushPromises()
      expect(wrapper.get('[data-testid="streak"]').text()).toBe('7日')
    })

    it.each([
      ['壊れたJSON', '{oops'],
      ['形が違う値', JSON.stringify({ stats: {}, savedAt: 1, deviceId: access.deviceId })],
      ['別端末の値', JSON.stringify({ stats, savedAt: 1, deviceId: 'dev-other' })],
      ['dailyにnullを含む値', JSON.stringify({ stats: { ...stats, daily: [null] }, savedAt: 1, deviceId: access.deviceId })],
      ['confusionsにnullを含む値', JSON.stringify({ stats: { ...stats, confusions: [null] }, savedAt: 1, deviceId: access.deviceId })],
    ])('%sは使わない', async (_label, cached) => {
      let release
      const storage = memoryStorage({ [REVIEW_CACHE_KEY]: cached })
      vi.stubGlobal('localStorage', storage)
      const fetchImpl = vi.fn(() => new Promise((resolve) => { release = resolve }))
      const wrapper = mount(ReviewView, { props: { endpoint: ENDPOINT, access, fetchImpl } })
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('読み込み中')
      expect(wrapper.find('[data-testid="streak"]').exists()).toBe(false)
      expect(storage.removeItem).toHaveBeenCalledWith(REVIEW_CACHE_KEY)
      release({ ok: true, json: async () => ({ ok: true, stats }) })
      await flushPromises()
    })
  })

  describe('開いている間の自動更新', () => {
    it.each(['横向き', '非表示'])('flush待ち中に%sへ移ると、完了後も取得せず読み込み中を解除する', async (transition) => {
      vi.useFakeTimers()
      const orientation = installMatchMedia(true)
      let releaseFlush
      const flushPending = vi.fn(() => new Promise((resolve) => { releaseFlush = resolve }))
      const fetchImpl = mockApi({ stats: () => ({ ok: true, stats }) })
      const wrapper = mount(ReviewView, {
        props: { endpoint: ENDPOINT, access, fetchImpl, syncService: enabledSync(flushPending) },
      })
      await flushPromises()
      expect(wrapper.text()).toContain('読み込み中')

      if (transition === '横向き') {
        orientation.set(false)
      } else {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        document.dispatchEvent(new Event('visibilitychange'))
      }
      await flushPromises()
      releaseFlush({ sent: 0, remaining: 0 })
      await flushPromises()

      expect(fetchImpl).not.toHaveBeenCalled()
      expect(wrapper.text()).not.toContain('読み込み中')
      expect(wrapper.find('[data-testid="review-refreshing"]').exists()).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('縦向き・表示中だけ定期更新し、非表示と横向きでは止まる', async () => {
      vi.useFakeTimers()
      const orientation = installMatchMedia(true)
      const fetchImpl = mockApi({ stats: () => ({ ok: true, stats }) })
      mount(ReviewView, { props: { endpoint: ENDPOINT, access, fetchImpl } })
      await flushPromises()
      expect(fetchImpl).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_INTERVAL_MS)
      await flushPromises()
      expect(fetchImpl).toHaveBeenCalledTimes(2)

      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_INTERVAL_MS * 2)
      expect(fetchImpl).toHaveBeenCalledTimes(2)

      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(fetchImpl).toHaveBeenCalledTimes(3)

      orientation.set(false)
      await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_INTERVAL_MS * 2)
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('破棄時にタイマーとイベントを解除する', async () => {
      vi.useFakeTimers()
      const orientation = installMatchMedia(true)
      const fetchImpl = mockApi({ stats: () => ({ ok: true, stats }) })
      const wrapper = mount(ReviewView, { props: { endpoint: ENDPOINT, access, fetchImpl } })
      await flushPromises()
      wrapper.unmount()

      await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_INTERVAL_MS * 2)
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
      orientation.set(true)
      await flushPromises()
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('送信待ちの途中で破棄しても上限待ちタイマーを残さない', async () => {
      vi.useFakeTimers()
      installMatchMedia(true)
      const fetchImpl = mockApi({ stats: () => ({ ok: true, stats }) })
      const wrapper = mount(ReviewView, {
        props: {
          endpoint: ENDPOINT,
          access,
          fetchImpl,
          syncService: enabledSync(vi.fn(() => new Promise(() => {}))),
        },
      })
      await flushPromises()
      wrapper.unmount()
      await flushPromises()
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  it('同じ対象の読み込みが競合しても、古い結果で新しい表示を上書きしない', async () => {
    let releaseSlow
    const slow = new Promise((resolve) => { releaseSlow = resolve })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, stats }) })
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, stats: { ...stats, streak: 8 } }) })
    const wrapper = await mountReview(fetchImpl)

    const oldLoad = wrapper.vm.load()
    await Promise.resolve()
    await wrapper.vm.load()
    expect(wrapper.get('[data-testid="streak"]').text()).toBe('8日')
    releaseSlow({ ok: true, json: async () => ({ ok: true, stats: { ...stats, streak: 3 } }) })
    await oldLoad
    await flushPromises()
    expect(wrapper.get('[data-testid="streak"]').text()).toBe('8日')
  })

  describe('管理者表示の入口(画面には何も表示しない)', () => {
    it('通常の画面に「管理者」の文言やボタンは出さない', async () => {
      const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
      expect(wrapper.text()).not.toContain('管理者')
      expect(wrapper.find('[data-testid="admin-open"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="admin-panel"]').exists()).toBe(false)
    })

    it('見出しを短く押しただけ、または途中で指を離したときは開かない', async () => {
      const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
      const title = wrapper.get('[data-testid="review-title"]')
      await title.trigger('pointerdown')
      await title.trigger('pointerup')
      await new Promise((resolve) => { setTimeout(resolve, TEST_PRESS_MS * 6) })
      await title.trigger('pointerdown')
      await title.trigger('pointerleave')
      await new Promise((resolve) => { setTimeout(resolve, TEST_PRESS_MS * 6) })
      expect(wrapper.find('[data-testid="admin-panel"]').exists()).toBe(false)
    })

    it('見出しを長押しすると管理者用コードの入力欄が出て、閉じるで隠せる', async () => {
      const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
      await openAdminPanel(wrapper)
      expect(wrapper.get('[data-testid="admin-panel"]').text()).toContain('管理者用コード')
      await wrapper.get('[data-testid="admin-close"]').trigger('click')
      expect(wrapper.find('[data-testid="admin-panel"]').exists()).toBe(false)
    })

    it('長押しが成立した時点でフォーカスとテキスト選択を解除する', async () => {
      const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }))
      const input = document.createElement('input')
      document.body.append(input)
      input.focus()
      const blur = vi.spyOn(input, 'blur')
      const removeAllRanges = vi.spyOn(window.getSelection(), 'removeAllRanges')

      await openAdminPanel(wrapper)

      expect(blur).toHaveBeenCalledTimes(1)
      expect(removeAllRanges).toHaveBeenCalledTimes(1)
      input.remove()
    })

    it('アンマウント後に長押しのタイマーが残らない', async () => {
      const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats }) }), { adminPressMs: 30 })
      await wrapper.get('[data-testid="review-title"]').trigger('pointerdown')
      wrapper.unmount()
      await new Promise((resolve) => { setTimeout(resolve, 80) })
    })
  })

  describe('管理者として見る', () => {
    const devices = [
      { deviceId: 'dev-friend-1234567', records: 5, practiceMs: 210_000, firstMs: 0, lastMs: Date.UTC(2026, 10, 3, 3) },
      { deviceId: 'dev-mine', records: 1, practiceMs: 30_000, firstMs: 0, lastMs: Date.UTC(2026, 10, 1, 3) },
    ]
    const api = () => mockApi({
      stats: () => ({ ok: true, stats: emptyStats }),
      admin_devices: (body) => (body.adminCode === 'adm-ok' ? { ok: true, devices } : { ok: false, error: 'invalid_admin' }),
      admin_stats: (body) => (body.targetDeviceId === 'dev-friend-1234567' ? { ok: true, stats: statsWithRuns } : { ok: false, error: 'bad_request' }),
    })

    it('管理者用コードが違うとエラーを出し、端末一覧は出さない・コードも保存しない', async () => {
      const wrapper = await mountReview(api())
      await openAdminPanel(wrapper)
      await wrapper.get('[data-testid="admin-code"]').setValue('wrong')
      await wrapper.get('[data-testid="admin-panel"] form').trigger('submit')
      await flushPromises()
      expect(wrapper.get('[data-testid="admin-error"]').text()).toContain('管理者用コードが違います')
      expect(wrapper.find('[data-testid="device-list"]').exists()).toBe(false)
      expect(localStorage.getItem(ADMIN_KEY)).toBeNull()
    })

    it('正しいコードで端末一覧を出し、友人の端末を選ぶと、その成績と管理者表示になる', async () => {
      const fetchImpl = api()
      const wrapper = await mountReview(fetchImpl)
      await openAdminPanel(wrapper)
      await wrapper.get('[data-testid="admin-code"]').setValue('adm-ok')
      await wrapper.get('[data-testid="admin-panel"] form').trigger('submit')
      await flushPromises()

      const buttons = wrapper.findAll('.device-button')
      expect(buttons).toHaveLength(2)
      expect(buttons[0].text()).toContain('端末 dev-frie')
      expect(buttons[0].text()).toContain('最終 11/3・5問・4分')
      expect(buttons[1].text()).toContain('(この端末)')
      expect(localStorage.getItem(ADMIN_KEY)).toBe('adm-ok')

      await buttons[0].trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="review-viewing"]').text()).toContain('管理者表示')
      expect(wrapper.get('[data-testid="streak"]').text()).toBe('2日')
      expect(wrapper.get('[data-testid="review-recent-runs"]').text()).toContain('タイムアタック10問')
      expect(wrapper.get('[data-testid="review-home-position"]').text()).toContain('成功5回')
      expect(JSON.parse(localStorage.getItem(REVIEW_CACHE_KEY)).stats).toEqual(emptyStats)
      const last = fetchImpl.mock.calls.at(-1)
      expect(JSON.parse(last[1].body)).toEqual({
        action: 'admin_stats', code: 'code-1', adminCode: 'adm-ok', targetDeviceId: 'dev-friend-1234567',
      })

      await wrapper.get('[data-testid="review-back"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="review-viewing"]').exists()).toBe(false)
      expect(JSON.parse(fetchImpl.mock.calls.at(-1)[1].body).action).toBe('stats')
    })

    it('pointerdown→pointerupで即座に1回だけ読み込み、続く合成clickを無視する', async () => {
      localStorage.setItem(ADMIN_KEY, 'adm-ok')
      const fetchImpl = api()
      const wrapper = await mountReview(fetchImpl)
      await openAdminPanel(wrapper)
      await flushPromises()
      const button = wrapper.findAll('.device-button')[0]

      await button.trigger('pointerdown', { pointerId: 41, button: 0, clientX: 20, clientY: 30 })
      await button.trigger('pointerup', { pointerId: 41, button: 0, clientX: 25, clientY: 34 })
      await flushPromises()
      expect(fetchImpl.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'admin_stats')).toHaveLength(1)

      // jsdomのtriggerはdetail=0。iOSが0を返す場合でも、直前の押下印があれば合成clickとして抑止する。
      await button.trigger('click')
      await flushPromises()
      expect(fetchImpl.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'admin_stats')).toHaveLength(1)
    })

    it('pointerを伴わないclickだけでも1回読み込む', async () => {
      localStorage.setItem(ADMIN_KEY, 'adm-ok')
      const fetchImpl = api()
      const wrapper = await mountReview(fetchImpl)
      await openAdminPanel(wrapper)
      await flushPromises()

      await wrapper.findAll('.device-button')[0].trigger('click')
      await flushPromises()

      expect(fetchImpl.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'admin_stats')).toHaveLength(1)
    })

    it('移動が10pxを超えたpointer操作とpointercancelでは読み込まない', async () => {
      localStorage.setItem(ADMIN_KEY, 'adm-ok')
      const fetchImpl = api()
      const wrapper = await mountReview(fetchImpl)
      await openAdminPanel(wrapper)
      await flushPromises()
      const button = wrapper.findAll('.device-button')[0]

      await button.trigger('pointerdown', { pointerId: 51, button: 0, clientX: 10, clientY: 10 })
      await button.trigger('pointerup', { pointerId: 51, button: 0, clientX: 21, clientY: 10 })
      await button.trigger('pointerdown', { pointerId: 52, button: 0, clientX: 10, clientY: 10 })
      await button.trigger('pointercancel', { pointerId: 52, button: 0, clientX: 10, clientY: 10 })
      await flushPromises()

      expect(fetchImpl.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'admin_stats')).toHaveLength(0)
    })

    it('保存済みの管理者用コードがあれば、開くだけで端末一覧を出す。拒否されたら保存を消す', async () => {
      localStorage.setItem(ADMIN_KEY, 'adm-ok')
      const wrapper = await mountReview(api())
      await openAdminPanel(wrapper)
      await flushPromises()
      expect(wrapper.findAll('.device-button')).toHaveLength(2)

      localStorage.setItem(ADMIN_KEY, 'changed')
      const second = await mountReview(api())
      await openAdminPanel(second)
      await flushPromises()
      expect(second.get('[data-testid="admin-error"]').text()).toContain('管理者用コードが違います')
      expect(localStorage.getItem(ADMIN_KEY)).toBeNull()
      expect(second.find('[data-testid="admin-code"]').exists()).toBe(true)
    })

    it('「この端末」を選ぶと、管理者表示にならず自分の成績を出す', async () => {
      localStorage.setItem(ADMIN_KEY, 'adm-ok')
      const wrapper = await mountReview(api())
      await openAdminPanel(wrapper)
      await flushPromises()
      await wrapper.findAll('.device-button')[1].trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="review-viewing"]').exists()).toBe(false)
    })

    it('端末を連続で切り替えても、古い成績を表示せず最後の応答だけを採用する', async () => {
      const raceDevices = [
        { ...devices[0], deviceId: 'dev-slow-1234567' },
        { ...devices[0], deviceId: 'dev-fast-1234567' },
      ]
      let releaseSlow
      const slowResponse = new Promise((resolve) => { releaseSlow = resolve })
      const fastStats = { ...stats, streak: 9 }
      const fetchImpl = vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body)
        if (body.action === 'stats') return { ok: true, json: async () => ({ ok: true, stats: emptyStats }) }
        if (body.action === 'admin_devices') return { ok: true, json: async () => ({ ok: true, devices: raceDevices }) }
        if (body.targetDeviceId === 'dev-slow-1234567') return slowResponse
        return { ok: true, json: async () => ({ ok: true, stats: fastStats }) }
      })
      localStorage.setItem(ADMIN_KEY, 'adm-ok')
      const wrapper = await mountReview(fetchImpl)
      await openAdminPanel(wrapper)
      await flushPromises()

      const buttons = wrapper.findAll('.device-button')
      await buttons[0].trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('読み込み中')
      expect(wrapper.find('[data-testid="streak"]').exists()).toBe(false)

      await buttons[1].trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="review-viewing"]').text()).toContain('dev-fast')
      expect(wrapper.get('[data-testid="streak"]').text()).toBe('9日')

      releaseSlow({ ok: true, json: async () => ({ ok: true, stats }) })
      await flushPromises()
      expect(wrapper.get('[data-testid="review-viewing"]').text()).toContain('dev-fast')
      expect(wrapper.get('[data-testid="streak"]').text()).toBe('9日')
    })

    it('端末成績でinvalid_adminになったら、保存コード・一覧・選択を消して入力欄へ戻す', async () => {
      localStorage.setItem(ADMIN_KEY, 'adm-ok')
      const fetchImpl = mockApi({
        stats: () => ({ ok: true, stats: emptyStats }),
        admin_devices: () => ({ ok: true, devices }),
        admin_stats: () => ({ ok: false, error: 'invalid_admin' }),
      })
      const wrapper = await mountReview(fetchImpl)
      await openAdminPanel(wrapper)
      await flushPromises()
      await wrapper.findAll('.device-button')[0].trigger('click')
      await flushPromises()

      expect(localStorage.getItem(ADMIN_KEY)).toBeNull()
      expect(wrapper.find('[data-testid="device-list"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="review-viewing"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="admin-code"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="admin-error"]').text()).toContain('管理者用コードが違います')
    })
  })
})
