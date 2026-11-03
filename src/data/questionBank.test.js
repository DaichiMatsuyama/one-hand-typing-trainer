import { describe, expect, it } from 'vitest'
import { getKeyboardLayout, getLayoutKeys } from './keyboardLayouts.js'
import {
  QUESTION_COUNT,
  createQuestionBank,
  getQuestion,
  validateQuestions,
} from './questionBank.js'

describe('questionBank', () => {
  for (const layoutVariant of ['jis', 'us']) {
    for (const hand of ['left', 'right']) {
      for (const level of [1, 2, 3]) {
        for (const includeSymbols of [false, true]) {
          it(`${layoutVariant}/${hand}/Lv.${level}/記号${includeSymbols ? 'あり' : 'なし'}は選択中のキーだけで構成される`, () => {
            const options = { layoutVariant, hand, level, includeSymbols }
            const questions = createQuestionBank(options)
            expect(questions).toHaveLength(QUESTION_COUNT)
            expect(validateQuestions(questions, options)).toBe(true)

            const lengths = questions.map((question) => question.length)
            if (level === 1) expect(lengths.every((length) => length === 1)).toBe(true)
            if (level === 2) expect(lengths.every((length) => length >= 3 && length <= 5)).toBe(true)
            if (level === 3) expect(lengths.every((length) => length >= 5 && length <= 10)).toBe(true)

            if (level === 1) {
              expect(questions.every((question, index) => index === 0 || question !== questions[index - 1])).toBe(true)
              expect(new Set(questions).size).toBe(
                getLayoutKeys(hand, layoutVariant, { includeSymbols }).length,
              )
            } else {
              expect(new Set(questions).size).toBe(QUESTION_COUNT)
              expect(questions.every((question) => new Set(question).size > 1)).toBe(true)
              expect(questions.every((question) => (
                [...question].every((character, index) => index === 0 || character !== question[index - 1])
              ))).toBe(true)
            }
          })
        }
      }
    }
  }

  it('JIS右手だけ6列目を追加し、USと左手は従来のキー数を保つ', () => {
    expect(getLayoutKeys('left', 'jis')).toHaveLength(15)
    expect(getLayoutKeys('left', 'us')).toHaveLength(15)
    expect(getLayoutKeys('right', 'jis')).toHaveLength(18)
    expect(getLayoutKeys('right', 'us')).toHaveLength(15)
  })

  it('JIS右手の6列配置・offset・小指担当を定義する', () => {
    const layout = getKeyboardLayout('right', 'jis')
    expect(layout.rows.map((row) => row.offset)).toEqual([0, 0.25, 0.75])
    expect(layout.rows.map((row) => row.keys.map((item) => item.value))).toEqual([
      ['y', 'u', 'i', 'o', 'p', '@'],
      ['h', 'j', 'k', 'l', ';', ':'],
      ['n', 'm', ',', '.', '/', '_'],
    ])
    for (const symbol of ['@', ':', '_']) {
      expect(getLayoutKeys('right', 'jis').find((item) => item.value === symbol)).toMatchObject({
        finger: 'rightPinky',
        isSymbol: true,
      })
    }
  })

  it('記号OFFでは記号を出さず、JIS右手の記号ONでは7記号を定率で混ぜる', () => {
    const withoutSymbols = createQuestionBank({ hand: 'right', level: 3, includeSymbols: false })
    const withSymbols = createQuestionBank({ hand: 'right', level: 3, includeSymbols: true })
    const symbolPattern = /[;,.\/@:_]/
    expect(withoutSymbols.join('')).not.toMatch(symbolPattern)
    expect(new Set([...withSymbols.join('')].filter((character) => symbolPattern.test(character)))).toEqual(
      new Set([';', ',', '.', '/', '@', ':', '_']),
    )
    withSymbols.forEach((question, index) => {
      const hasSymbol = symbolPattern.test(question)
      expect(hasSymbol).toBe((index + 1) % 4 === 0)
    })
  })

  it('US右手の記号ONにはJIS専用の@ : _を出さない', () => {
    const questions = createQuestionBank({
      hand: 'right',
      level: 3,
      includeSymbols: true,
      layoutVariant: 'us',
    })
    expect(questions.join('')).toMatch(/[;,.\/]/)
    expect(questions.join('')).not.toMatch(/[@:_]/)
  })

  it('同じ条件ならバンク全体が決定論的に同じになる', () => {
    const options = { hand: 'left', level: 2, includeSymbols: false }
    expect(createQuestionBank(options)).toEqual(createQuestionBank(options))
    expect(getQuestion(options, 7)).toBe(getQuestion(options, 7))
  })

  it('周回ごとに順序を変えつつ、再現性・品質・周回境界を維持する', () => {
    for (const hand of ['left', 'right']) {
      for (const level of [1, 2, 3]) {
        for (const includeSymbols of [false, true]) {
          const options = { hand, level, includeSymbols }
          const banks = [0, 1, 2].map((cycle) => createQuestionBank({ ...options, cycle }))
          expect(banks[1]).not.toEqual(banks[0])
          expect(banks[2]).not.toEqual(banks[1])

          banks.forEach((bank) => {
            expect(validateQuestions(bank, options)).toBe(true)
            expect(bank.every((question) => (
              [...question].every((character, index) => index === 0 || character !== question[index - 1])
            ))).toBe(true)
            if (level > 1) expect(new Set(bank).size).toBe(QUESTION_COUNT)
            if (hand === 'right' && includeSymbols) {
              const symbolPattern = /[;,.\/@:_]/
              bank.forEach((question, index) => {
                expect(symbolPattern.test(question)).toBe((index + 1) % 4 === 0)
              })
            }
          })

          for (const cycle of [1, 2]) {
            const boundaryIndex = cycle * QUESTION_COUNT
            expect(getQuestion(options, boundaryIndex - 1)).not.toBe(getQuestion(options, boundaryIndex))
            expect(getQuestion(options, boundaryIndex)).toBe(getQuestion(options, boundaryIndex))
          }
        }
      }
    }
  })

  it.each([
    ['left', new Set(['a', 's', 'd', 'f', 'g'])],
    ['right', new Set(['h', 'j', 'k', 'l'])],
  ])('Lv.1の%s手はホーム段を多めに出題する', (hand, homeKeys) => {
    const questions = createQuestionBank({ hand, level: 1, includeSymbols: false })
    const homeCount = questions.filter((question) => homeKeys.has(question)).length
    expect(homeCount).toBeGreaterThan(questions.length - homeCount)
  })

  it('上下段は実物のQWERTYに合わせたオフセットを持つ', () => {
    for (const hand of ['left', 'right']) {
      expect(getKeyboardLayout(hand).rows.map((row) => row.offset)).toEqual([0, 0.25, 0.75])
    }
  })

  it('許可されていないキーを検出する', () => {
    expect(validateQuestions(['asdf', 'y'], { hand: 'left' })).toBe(false)
  })
})
