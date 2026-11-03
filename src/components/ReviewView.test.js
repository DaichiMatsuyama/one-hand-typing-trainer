import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewView from './ReviewView.vue'

const ENDPOINT = 'https://script.google.com/macros/s/test/exec'
const access = { granted: true, code: 'code-1', deviceId: 'dev-mine', grantedAt: 1 }
const ADMIN_KEY = 'one-hand-typing-trainer:admin:v1'

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

  it('記録がまだ無いときは、案内だけを出し、グラフは出さない', async () => {
    const wrapper = await mountReview(mockApi({ stats: () => ({ ok: true, stats: emptyStats }) }))
    expect(wrapper.get('[data-testid="review-empty"]').text()).toContain('まだ記録がありません')
    expect(wrapper.find('[data-testid="heatmap"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="chart-daily"]').exists()).toBe(false)
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
      admin_stats: (body) => (body.targetDeviceId === 'dev-friend-1234567' ? { ok: true, stats } : { ok: false, error: 'bad_request' }),
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
      const last = fetchImpl.mock.calls.at(-1)
      expect(JSON.parse(last[1].body)).toEqual({
        action: 'admin_stats', code: 'code-1', adminCode: 'adm-ok', targetDeviceId: 'dev-friend-1234567',
      })

      await wrapper.get('[data-testid="review-back"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="review-viewing"]').exists()).toBe(false)
      expect(JSON.parse(fetchImpl.mock.calls.at(-1)[1].body).action).toBe('stats')
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
  })
})
