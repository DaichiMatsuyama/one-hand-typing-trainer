import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccessGate from './AccessGate.vue'
import { ACCESS_KEY, loadAccess } from '../services/access.js'

const ENDPOINT = 'https://script.google.com/macros/s/test/exec'

function mockFetch(body, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function submitCode(wrapper, code) {
  await wrapper.get('[data-testid="access-code"]').setValue(code)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('AccessGate', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('ホーム画面以外では、追加手順だけを表示し、入力欄は出さない', () => {
    const wrapper = mount(AccessGate, { props: { mode: 'need-standalone', endpoint: ENDPOINT } })
    expect(wrapper.get('[data-testid="install-steps"]').text()).toContain('ホーム画面に追加')
    expect(wrapper.find('[data-testid="access-code"]').exists()).toBe(false)
    expect(wrapper.find('.key').exists()).toBe(false)
  })

  it('コード入力画面は、iOSで拡大・自動補正されない入力欄と、記録送信の説明を持つ', () => {
    const wrapper = mount(AccessGate, { props: { mode: 'need-code', endpoint: ENDPOINT } })
    const input = wrapper.get('[data-testid="access-code"]')
    expect(input.attributes('autocapitalize')).toBe('off')
    expect(input.attributes('autocorrect')).toBe('off')
    expect(input.attributes('autocomplete')).toBe('off')
    expect(wrapper.text()).toContain('練習情報(日時・手・レベル・出題・所要時間・ミスしたキー)が記録されます')
    expect(wrapper.get('[data-testid="access-submit"]').attributes('disabled')).toBeDefined()
  })

  it('正しいコードなら保存して granted を通知する(前後の空白は無視)', async () => {
    const fetchMock = mockFetch({ ok: true })
    const wrapper = mount(AccessGate, { props: { mode: 'need-code', endpoint: ENDPOINT } })
    await submitCode(wrapper, '  abc12345  ')

    expect(wrapper.emitted('granted')).toHaveLength(1)
    const saved = loadAccess()
    expect(saved.code).toBe('abc12345')
    expect(saved.deviceId).toBeTruthy()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: 'verify', code: 'abc12345' })
  })

  it.each([
    ['invalid', 'コードが違います'],
    ['locked', 'しばらく入力できません'],
  ])('%s のときはエラーを表示し、保存も通知もしない', async (error, message) => {
    mockFetch({ ok: false, error })
    const wrapper = mount(AccessGate, { props: { mode: 'need-code', endpoint: ENDPOINT } })
    await submitCode(wrapper, 'wrong')

    expect(wrapper.get('[data-testid="access-error"]').text()).toContain(message)
    expect(wrapper.emitted('granted')).toBeUndefined()
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
  })

  it('通信できないときは、やり直しを促すエラーを表示する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const wrapper = mount(AccessGate, { props: { mode: 'need-code', endpoint: ENDPOINT } })
    await submitCode(wrapper, 'abc12345')
    expect(wrapper.get('[data-testid="access-error"]').text()).toContain('通信できませんでした')
    expect(wrapper.emitted('granted')).toBeUndefined()
  })

  it('確認成功後にコードを保存できなければ、練習画面を開かずエラーを出す', async () => {
    mockFetch({ ok: true })
    // jsdomの本物のlocalStorage(Node 22)ではメソッドを差し替えられないため、グローバルごと保存できない代用品にする
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('blocked') },
      removeItem: () => {},
    })
    const wrapper = mount(AccessGate, { props: { mode: 'need-code', endpoint: ENDPOINT } })
    await submitCode(wrapper, 'abc12345')

    expect(wrapper.get('[data-testid="access-error"]').text()).toContain('この端末では、コードを保存できませんでした')
    expect(wrapper.emitted('granted')).toBeUndefined()
  })

  it('確認中は二重送信できない', async () => {
    let finish
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ ok: true, json: async () => ({ ok: true }) })
    })))
    const wrapper = mount(AccessGate, { props: { mode: 'need-code', endpoint: ENDPOINT } })
    await wrapper.get('[data-testid="access-code"]').setValue('abc12345')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(fetch).toHaveBeenCalledTimes(1)
    finish()
    await flushPromises()
    expect(wrapper.emitted('granted')).toHaveLength(1)
  })

  it('同じ端末で再入力しても端末IDは変わらない', async () => {
    mockFetch({ ok: false, error: 'invalid' })
    localStorage.setItem(ACCESS_KEY, JSON.stringify({ granted: true, code: 'old', deviceId: 'dev-keep', grantedAt: 1 }))
    mockFetch({ ok: true })
    const wrapper = mount(AccessGate, { props: { mode: 'need-code', endpoint: ENDPOINT } })
    await submitCode(wrapper, 'new-code-1')
    expect(loadAccess().deviceId).toBe('dev-keep')
    expect(loadAccess().code).toBe('new-code-1')
  })
})
