import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PromptView from './PromptView.vue'

function mountPrompt(props = {}) {
  return mount(PromptView, {
    props: { question: 'asd', position: 3, hand: 'left', isComplete: true, ...props },
  })
}

const check = (overrides = {}) => ({
  id: 1, hand: 'left', keys: ['a', 's', 'd', 'f'], established: false, ...overrides,
})

describe('PromptView', () => {
  it('確認中でなければ従来どおり問題文字を出し、スキップを出さない', () => {
    const wrapper = mountPrompt({ position: 1, isComplete: false })
    expect(wrapper.find('.prompt-text').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-skip"]').exists()).toBe(false)
    expect(wrapper.get('.prompt-card').classes()).not.toContain('home-check')
    expect(wrapper.get('[data-testid="home-check-live"]').text()).toBe('')
  })

  it('確認中は問題文字の代わりに左手の案内文を出し、出題欄の右端にスキップを出す', () => {
    const wrapper = mountPrompt({ homeCheck: check() })
    expect(wrapper.find('.prompt-text').exists()).toBe(false)
    expect(wrapper.get('[data-testid="home-check-text"]').text()).toBe('A S D F に指を置いてください')
    expect(wrapper.get('.prompt-card').classes()).toContain('home-check')
    expect(wrapper.get('.prompt-card').classes()).not.toContain('complete')
    const children = [...wrapper.get('.prompt-card').element.children]
    const skipIndex = children.indexOf(wrapper.get('[data-testid="home-skip"]').element)
    const textIndex = children.indexOf(wrapper.get('[data-testid="home-check-text"]').element)
    expect(textIndex).toBeGreaterThanOrEqual(0)
    expect(skipIndex).toBeGreaterThan(textIndex)
    expect(wrapper.get('[data-testid="home-skip"]').text()).toBe('スキップ')
  })

  it('右手の案内文は J K L ; に指を置いてください', () => {
    const wrapper = mountPrompt({
      hand: 'right', homeCheck: check({ hand: 'right', keys: ['j', 'k', 'l', ';'] }),
    })
    expect(wrapper.get('[data-testid="home-check-text"]').text()).toBe('J K L ; に指を置いてください')
    expect(wrapper.get('[data-testid="home-check-live"]').text())
      .toBe('ホームポジション確認。J K L ; に指を置いてください')
  })

  it('成立すると案内を「確認できました。指を離すと次へ進みます」へ切り替える', async () => {
    const wrapper = mountPrompt({ homeCheck: check() })
    await wrapper.setProps({ homeCheck: check({ established: true }) })
    expect(wrapper.get('[data-testid="home-check-text"]').text())
      .toBe('✓確認できました。指を離すと次へ進みます')
    expect(wrapper.get('.prompt-card').classes()).toContain('home-established')
  })

  it('読み上げ用の常設live領域(polite)が確認の開始と成立を伝える', async () => {
    const wrapper = mountPrompt()
    const live = () => wrapper.get('[data-testid="home-check-live"]')
    expect(live().attributes('aria-live')).toBe('polite')
    expect(live().attributes('role')).toBe('status')

    await wrapper.setProps({ homeCheck: check() })
    // 同じ要素のまま内容だけが変わる(新規挿入では読み上げられないことがあるため)
    expect(live().text()).toBe('ホームポジション確認。A S D F に指を置いてください')
    await wrapper.setProps({ homeCheck: check({ established: true }) })
    expect(live().text()).toBe('確認できました。指を離すと次へ進みます')
    await wrapper.setProps({ homeCheck: null })
    expect(live().text()).toBe('')
  })

  it('見た目の案内文は読み上げ領域と二重に読まれないようaria-hiddenにする', () => {
    const wrapper = mountPrompt({ homeCheck: check() })
    expect(wrapper.get('[data-testid="home-check-text"]').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.prompt-card').attributes('aria-label')).toBe('ホームポジション確認')
  })

  it('スキップのaria-labelに対象キーを含める', () => {
    expect(mountPrompt({ homeCheck: check() }).get('[data-testid="home-skip"]').attributes('aria-label'))
      .toBe('ホームポジション確認をスキップ(A S D F)')
    expect(mountPrompt({
      hand: 'right', homeCheck: check({ hand: 'right', keys: ['j', 'k', 'l', ';'] }),
    }).get('[data-testid="home-skip"]').attributes('aria-label'))
      .toBe('ホームポジション確認をスキップ(J K L ;)')
  })

  it('スキップを押すとskip-homeを通知する', async () => {
    const wrapper = mountPrompt({ homeCheck: check() })
    await wrapper.get('[data-testid="home-skip"]').trigger('click')
    expect(wrapper.emitted('skip-home')).toHaveLength(1)
  })
})
