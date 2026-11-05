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
})
