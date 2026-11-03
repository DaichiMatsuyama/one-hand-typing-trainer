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

  it('左手15キー、右手15キーを定義する', () => {
    expect(getLayoutKeys('left')).toHaveLength(15)
    expect(getLayoutKeys('right')).toHaveLength(15)
  })

  it('記号OFFでは記号を出さず、右手の記号ONでは対象記号を混ぜる', () => {
    const withoutSymbols = createQuestionBank({ hand: 'right', level: 3, includeSymbols: false })
    const withSymbols = createQuestionBank({ hand: 'right', level: 3, includeSymbols: true })
    expect(withoutSymbols.join('')).not.toMatch(/[;,./]/)
    expect(withSymbols.join('')).toMatch(/[;,./]/)
    withSymbols.forEach((question, index) => {
      const hasSymbol = /[;,./]/.test(question)
      expect(hasSymbol).toBe((index + 1) % 4 === 0)
    })
  })

  it('同じ条件ならバンク全体が決定論的に同じになる', () => {
    const options = { hand: 'left', level: 2, includeSymbols: false }
    expect(createQuestionBank(options)).toEqual(createQuestionBank(options))
    expect(getQuestion(options, 7)).toBe(getQuestion(options, 7))
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
