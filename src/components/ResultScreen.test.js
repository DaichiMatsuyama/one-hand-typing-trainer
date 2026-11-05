import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import ResultScreen from './ResultScreen.vue'

function summary(overrides = {}) {
  return {
    mode: 'timeAttack', endedBy: 'completed', targetCount: 10, timeLimitSec: null,
    activeMs: 12_300, inputMs: 10_000, completedQuestions: 10, correctCount: 60,
    mistakes: 2, attempts: 62, accuracy: 97, kpm: 100, menuOpenCount: 0,
    analysis: {
      rank: 'A', rankVersion: 1,
      personalBest: { eligible: true, isFirst: false, isNewBest: true, reason: null },
      nextRank: {
        targetRank: 'S',
        requirements: ['KPMあと20', 'ノーミス'],
        text: 'Sランクまで KPMあと20・ノーミス',
      },
      growth: { improvements: [{ type: 'accuracy', text: '正解率が前回より+3%' }] },
      weakKeys: [{ key: 'a', shown: 8, misses: 3, rate: 0.375 }],
      message: { id: 'best-1', text: '自己ベスト更新！一歩ずつ速くなっています。' },
    },
    ...overrides,
  }
}

describe('ResultScreen', () => {
  it('競技モードでランク・自己ベスト・次ランク・成長・苦手キー・メッセージを表示する', () => {
    const wrapper = mount(ResultScreen, { props: { summary: summary() } })
    expect(wrapper.get('.run-result-body').classes()).toContain('is-full-content')
    expect(wrapper.get('[data-testid="result-rank"]').text()).toBe('A')
    expect(wrapper.get('[data-testid="result-personal-best"]').text()).toBe('⭐ 自己ベスト更新')
    expect(wrapper.get('[data-testid="result-next-rank"]').text()).toContain('KPMあと20')
    expect(wrapper.get('[data-testid="result-next-rank"]').attributes('aria-label'))
      .toBe('Sランクまで KPMあと20・ノーミス')
    expect(wrapper.findAll('.next-rank-chunk').map((chunk) => chunk.text()))
      .toEqual(['Sランクまで', 'KPMあと20', 'ノーミス'])
    expect(wrapper.get('.next-rank-chunks').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('[data-testid="result-growth"]').text()).toContain('正解率が前回より+3%')
    expect(wrapper.get('[data-testid="result-weak-keys"]').text()).toContain('ミス 3/8')
    expect(wrapper.get('[data-testid="result-message"]').attributes('aria-live')).toBe('polite')
    expect(wrapper.get('.run-result-overview').element.contains(wrapper.get('[data-testid="result-message"]').element)).toBe(true)
    expect(wrapper.get('.run-result-details').element.contains(wrapper.get('[data-testid="result-message"]').element)).toBe(false)
    expect(wrapper.get('.run-result-details').element.contains(wrapper.get('.run-result-grid').element)).toBe(true)
    expect(wrapper.get('.run-result-insights').element.contains(wrapper.get('[data-testid="result-growth"]').element)).toBe(true)
    expect(wrapper.get('.run-result-actions').element.contains(wrapper.get('[data-testid="result-scroll-area"]').element)).toBe(false)
  })

  it('成長と苦手キーの有無に応じて本文の密度クラスを切り替える', async () => {
    const wrapper = mount(ResultScreen, { props: { summary: summary() } })
    const body = () => wrapper.get('.run-result-body')

    expect(body().classes()).toContain('is-full-content')

    const medium = summary()
    medium.analysis = {
      ...medium.analysis,
      growth: { improvements: [] },
    }
    await wrapper.setProps({ summary: medium })
    expect(body().classes()).toContain('is-medium-content')
    expect(body().classes()).not.toContain('is-full-content')

    const otherMedium = summary()
    otherMedium.analysis = {
      ...otherMedium.analysis,
      weakKeys: [],
    }
    await wrapper.setProps({ summary: otherMedium })
    expect(body().classes()).toContain('is-medium-content')

    const sparse = summary()
    sparse.analysis = {
      ...sparse.analysis,
      growth: { improvements: [] },
      weakKeys: [],
    }
    await wrapper.setProps({ summary: sparse })
    expect(body().classes()).toContain('is-sparse-content')
    expect(body().classes()).not.toContain('is-medium-content')
  })

  it('初回ベストは星付きで「初めての記録」と表示する', () => {
    const value = summary()
    value.analysis.personalBest = { eligible: true, isFirst: true, isNewBest: false, reason: null }
    value.analysis.growth = { improvements: [] }
    value.analysis.weakKeys = []
    const wrapper = mount(ResultScreen, { props: { summary: value } })
    expect(wrapper.get('[data-testid="result-personal-best"]').text()).toBe('⭐ 初めての記録')
    expect(wrapper.find('[data-testid="result-growth"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="result-weak-keys"]').exists()).toBe(false)
    expect(wrapper.get('.run-result-body').exists()).toBe(true)
    expect(wrapper.get('.run-result-actions').exists()).toBe(true)
  })

  it('成長の数値と単位を分離しない', () => {
    const value = summary()
    value.analysis.growth = {
      improvements: [{ type: 'kpm', text: '入力速度が前回より+264 KPM' }],
    }
    const wrapper = mount(ResultScreen, { props: { summary: value } })

    expect(wrapper.get('[data-testid="result-growth"]').text())
      .toContain('入力速度が前回より+264 KPM')
    expect(wrapper.get('.number-unit').text()).toBe('+264 KPM')
  })

  it('応援メッセージと成長文の末尾を分離せず、textContentを変えない', () => {
    const value = summary()
    value.analysis.message = { id: 'speed-1', text: '入力速度が前回より伸びました！' }
    value.analysis.growth = {
      improvements: [
        { type: 'kpm', text: '入力速度が前回より+12 KPM！' },
        { type: 'mistakes', text: 'ミスが2回減りました。' },
      ],
    }
    const wrapper = mount(ResultScreen, { props: { summary: value } })
    const message = wrapper.get('[data-testid="result-message"]')
    const growthRows = wrapper.findAll('.result-growth-list li')

    expect(message.element.textContent).toBe(value.analysis.message.text)
    expect(message.get('.kinsoku-tail').text()).toBe('した！')
    expect(growthRows.map((row) => row.element.textContent))
      .toEqual(value.analysis.growth.improvements.map((item) => item.text))
    expect(growthRows[0].get('.kinsoku-tail').text()).toContain('！')
    expect(growthRows[1].get('.kinsoku-tail').text()).toBe('した。')
  })

  it('結果の補足文も末尾を分離せずtextContentを保つ', () => {
    const value = summary({ mode: 'timeLimit', endedBy: 'ended', targetCount: null, timeLimitSec: 60 })
    value.analysis.rank = null
    value.analysis.personalBest = null
    const wrapper = mount(ResultScreen, { props: { summary: value } })

    expect(wrapper.get('[data-testid="result-ended-guide"]').element.textContent)
      .toBe('最後まで続けるとランクが付きます')
    expect(wrapper.get('[data-testid="result-best-exclusion"]').element.textContent)
      .toBe('途中終了の回は自己ベストの対象外です')
    expect(wrapper.findAll('.kinsoku-tail').length).toBeGreaterThanOrEqual(3)
  })

  it('フリーではランクと自己ベストを出さず、苦手キーとメッセージは表示する', () => {
    const value = summary({ mode: 'free', endedBy: 'ended', targetCount: null })
    value.analysis.rank = null
    value.analysis.personalBest = null
    const wrapper = mount(ResultScreen, { props: { summary: value } })
    expect(wrapper.find('[data-testid="result-rank"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="result-personal-best"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="result-ended-guide"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="result-weak-keys"]').text()).toContain('3/8')
    expect(wrapper.get('[data-testid="result-message"]').exists()).toBe(true)
  })

  it('途中終了ではランクと自己ベストを出さず、案内と対象外理由を表示する', () => {
    const value = summary({ mode: 'timeLimit', endedBy: 'ended', targetCount: null, timeLimitSec: 60 })
    value.analysis.rank = null
    value.analysis.personalBest = null
    const wrapper = mount(ResultScreen, { props: { summary: value } })
    expect(wrapper.find('[data-testid="result-rank"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="result-personal-best"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="result-ended-guide"]').text()).toBe('最後まで続けるとランクが付きます')
    expect(wrapper.get('[data-testid="result-best-exclusion"]').text()).toContain('途中終了')
  })

  it('メニューを使った競技回は自己ベスト対象外理由を表示する', () => {
    const value = summary()
    value.analysis.personalBest = { eligible: false, isFirst: false, isNewBest: false, reason: 'menu' }
    const wrapper = mount(ResultScreen, { props: { summary: value } })
    expect(wrapper.find('[data-testid="result-personal-best"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="result-best-exclusion"]').text()).toContain('メニューで止めた回')
  })

  it('KPMを算出できない完了済み競技回はランクの代わりに案内を表示する', () => {
    const value = summary({ kpm: null, inputMs: 500 })
    value.analysis.rank = null
    value.analysis.personalBest = null
    value.analysis.nextRank = null
    const wrapper = mount(ResultScreen, { props: { summary: value } })

    expect(wrapper.find('[data-testid="result-rank"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="result-rank-unavailable"]').text())
      .toBe('入力が少なく、ランクを判定できませんでした')
  })

  it.each([
    ['フリー', { mode: 'free', endedBy: 'ended', targetCount: null }],
    ['競技の途中終了', { mode: 'timeLimit', endedBy: 'ended', targetCount: null, timeLimitSec: 60 }],
  ])('%sでも応援メッセージを左カラムへ表示する', (_label, overrides) => {
    const value = summary(overrides)
    value.analysis.rank = null
    value.analysis.personalBest = null
    const wrapper = mount(ResultScreen, { props: { summary: value } })
    const message = wrapper.get('[data-testid="result-message"]').element

    expect(wrapper.get('.run-result-overview').element.contains(message)).toBe(true)
    expect(wrapper.get('.run-result-details').element.contains(message)).toBe(false)
  })

  it('本文があふれた間だけ下端フェードの継続合図を有効にし、末尾で消す', async () => {
    const wrapper = mount(ResultScreen, { props: { summary: summary() } })
    const area = wrapper.get('[data-testid="result-scroll-area"]')
    Object.defineProperties(area.element, {
      scrollHeight: { configurable: true, value: 420 },
      clientHeight: { configurable: true, value: 200 },
    })
    window.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(wrapper.get('.run-result-scroll-frame').classes()).toContain('has-overflow')
    expect(wrapper.get('.run-result-scroll-frame').classes()).not.toContain('at-scroll-end')
    expect(wrapper.get('[data-testid="result-scroll-cue"]').text()).toBe('▼')

    area.element.scrollTop = 220
    await area.trigger('scroll')
    expect(wrapper.get('.run-result-scroll-frame').classes()).toContain('at-scroll-end')
  })

  describe('ホームポジション確認の成績', () => {
    const withHomePosition = (overrides = {}) => summary({
      homePosition: true,
      hpSuccessCount: 12,
      hpSkipCount: 1,
      hpAvgReturnMs: 1234,
      hpMinReturnMs: 800,
      ...overrides,
    })

    it('確認ONのrunでは成功・スキップ・平均復帰・最短を小数1桁の秒で表示する', () => {
      const wrapper = mount(ResultScreen, { props: { summary: withHomePosition() } })
      const card = wrapper.get('[data-testid="result-home-position"]')
      expect(card.get('h2').text()).toBe('ホームポジション確認')
      expect(card.get('[data-testid="result-hp-success"]').text()).toBe('12回')
      expect(card.get('[data-testid="result-hp-skip"]').text()).toBe('1回')
      expect(card.get('[data-testid="result-hp-avg"]').text()).toBe('1.2秒')
      expect(card.get('[data-testid="result-hp-min"]').text()).toBe('0.8秒')
      expect(card.findAll('dt').map((item) => item.text())).toEqual(['成功', 'スキップ', '平均復帰', '最短'])
      expect(card.attributes('aria-labelledby')).toBe('home-position-heading')
    })

    it('成功が0回なら平均・最短は「-」にする', () => {
      const wrapper = mount(ResultScreen, {
        props: {
          summary: withHomePosition({
            hpSuccessCount: 0, hpSkipCount: 4, hpAvgReturnMs: null, hpMinReturnMs: null,
          }),
        },
      })
      expect(wrapper.get('[data-testid="result-hp-success"]').text()).toBe('0回')
      expect(wrapper.get('[data-testid="result-hp-skip"]').text()).toBe('4回')
      expect(wrapper.get('[data-testid="result-hp-avg"]').text()).toBe('-')
      expect(wrapper.get('[data-testid="result-hp-min"]').text()).toBe('-')
    })

    it('確認の回数がまだ0回でもONのrunなら表示する', () => {
      const wrapper = mount(ResultScreen, {
        props: {
          summary: withHomePosition({
            hpSuccessCount: 0, hpSkipCount: 0, hpAvgReturnMs: null, hpMinReturnMs: null,
          }),
        },
      })
      expect(wrapper.get('[data-testid="result-hp-success"]').text()).toBe('0回')
      expect(wrapper.get('[data-testid="result-hp-avg"]').text()).toBe('-')
    })

    it.each([
      ['OFFのrun', { homePosition: false, hpSuccessCount: 0, hpSkipCount: 0 }],
      ['項目のない旧形式', {}],
    ])('%sでは何も表示しない', (_label, overrides) => {
      const wrapper = mount(ResultScreen, { props: { summary: summary(overrides) } })
      expect(wrapper.find('[data-testid="result-home-position"]').exists()).toBe(false)
      expect(wrapper.find('.home-position-summary').exists()).toBe(false)
      expect(wrapper.get('.run-result-body').classes()).not.toContain('has-home-position')
    })

    it('途中終了のrunでも、確認の集計を表示する', () => {
      const wrapper = mount(ResultScreen, {
        props: { summary: withHomePosition({ endedBy: 'ended', analysis: { ...summary().analysis, rank: null, personalBest: null } }) },
      })
      expect(wrapper.get('[data-testid="result-ended-early"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="result-hp-success"]').text()).toBe('12回')
    })

    it('フリーのrunでも表示し、成績カードは左カラム(overview)の末尾へ置く', () => {
      const wrapper = mount(ResultScreen, {
        props: {
          summary: withHomePosition({
            mode: 'free', endedBy: 'ended', targetCount: null,
            analysis: { rank: null, personalBest: null, growth: { improvements: [] }, weakKeys: [], message: { id: 'a', text: 'おつかれさまでした。' } },
          }),
        },
      })
      const overview = wrapper.get('.run-result-overview').element
      const card = wrapper.get('[data-testid="result-home-position"]').element
      expect(overview.contains(card)).toBe(true)
      expect(overview.lastElementChild).toBe(card)
      expect(wrapper.get('.run-result-details').element.contains(card)).toBe(false)
    })

    it('最悪ケース(自己ベスト+成長3行+苦手キー3つ+確認の成績)でも全項目を1画面の構成で表示する', () => {
      const value = withHomePosition()
      value.analysis.growth = {
        improvements: [
          { type: 'kpm', text: '入力速度が前回より+12 KPM！' },
          { type: 'accuracy', text: '正解率が前回より+3%' },
          { type: 'mistakes', text: 'ミスが2回減りました。' },
        ],
      }
      value.analysis.weakKeys = [
        { key: 'a', shown: 8, misses: 3, rate: 0.375 },
        { key: 's', shown: 8, misses: 2, rate: 0.25 },
        { key: 'd', shown: 8, misses: 1, rate: 0.125 },
      ]
      value.mode = 'timeLimit'
      value.timeLimitSec = 60
      value.targetCount = null
      value.endedBy = 'timeUp'
      const wrapper = mount(ResultScreen, { props: { summary: value } })
      expect(wrapper.get('.run-result-body').classes()).toEqual(
        expect.arrayContaining(['is-full-content', 'has-home-position']),
      )
      expect(wrapper.get('[data-testid="result-personal-best"]').exists()).toBe(true)
      expect(wrapper.findAll('.result-growth-list li')).toHaveLength(3)
      expect(wrapper.findAll('.weak-key-list li')).toHaveLength(3)
      expect(wrapper.get('[data-testid="result-home-position"]').exists()).toBe(true)
      expect(wrapper.findAll('.run-result-grid > div')).toHaveLength(7)
    })

    it('成績カードの分だけ密度を一段階詰める(sparse→medium、medium→full)', () => {
      const sparse = withHomePosition()
      sparse.analysis = { ...sparse.analysis, growth: { improvements: [] }, weakKeys: [] }
      expect(mount(ResultScreen, { props: { summary: sparse } }).get('.run-result-body').classes())
        .toContain('is-medium-content')

      const medium = withHomePosition()
      medium.analysis = { ...medium.analysis, growth: { improvements: [] } }
      expect(mount(ResultScreen, { props: { summary: medium } }).get('.run-result-body').classes())
        .toContain('is-full-content')

      // OFFのときの密度は従来どおり
      const off = summary()
      off.analysis = { ...off.analysis, growth: { improvements: [] }, weakKeys: [] }
      expect(mount(ResultScreen, { props: { summary: off } }).get('.run-result-body').classes())
        .toContain('is-sparse-content')
    })
  })
})
