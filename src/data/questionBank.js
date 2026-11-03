import { getKeyboardLayout, getLayoutKeys } from './keyboardLayouts.js'

export const QUESTION_COUNT = 32
export const SYMBOL_QUESTION_INTERVAL = 4

const LEVEL_LENGTHS = {
  1: [1],
  2: [3, 4, 5],
  3: [5, 6, 7, 8, 9, 10],
}

const HOME_KEY_WEIGHT = 4
const UNIQUE_GENERATION_ATTEMPTS = 128

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

function seedFromOptions({ hand, level, includeSymbols, layoutVariant, cycle }) {
  const source = `${layoutVariant}:${hand}:${level}:${includeSymbols ? 1 : 0}:${cycle}`
  let hash = 2166136261
  for (const character of source) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function weightedLetterKeys(hand, layoutVariant) {
  const layout = getKeyboardLayout(hand, layoutVariant)
  const letterKeys = layout.rows.flatMap((row) => row.keys).filter((item) => !item.isSymbol)
  const homeValues = new Set(
    layout.rows.find((row) => row.id === 'home').keys
      .filter((item) => !item.isSymbol)
      .map((item) => item.value),
  )

  return letterKeys.flatMap((item) => (
    Array(homeValues.has(item.value) ? HOME_KEY_WEIGHT : 1).fill(item.value)
  ))
}

function createWeightedPicker(weightedKeys, random) {
  let bag = []

  return function pickLetter(previous = '') {
    if (bag.length === 0) bag = [...weightedKeys]
    let candidateIndexes = bag
      .map((value, index) => ({ value, index }))
      .filter((candidate) => candidate.value !== previous)
    if (candidateIndexes.length === 0) {
      bag.push(...weightedKeys)
      candidateIndexes = bag
        .map((value, index) => ({ value, index }))
        .filter((candidate) => candidate.value !== previous)
    }
    const selected = candidateIndexes[Math.floor(random() * candidateIndexes.length)]
    return bag.splice(selected.index, 1)[0]
  }
}

function generatedLetters(pickLetter, length) {
  const characters = []
  while (characters.length < length) {
    characters.push(pickLetter(characters.at(-1)))
  }
  return characters
}

function addScheduledSymbol(characters, symbols, questionIndex, random) {
  const shouldUseSymbol = symbols.length > 0 && (questionIndex + 1) % SYMBOL_QUESTION_INTERVAL === 0
  if (!shouldUseSymbol) return characters

  const result = [...characters]
  const symbol = symbols[Math.floor(questionIndex / SYMBOL_QUESTION_INTERVAL) % symbols.length]
  result[Math.floor(random() * result.length)] = symbol
  return result
}

function generateQuestionBank({ hand, level, includeSymbols, layoutVariant, cycle }) {
  const weightedKeys = weightedLetterKeys(hand, layoutVariant)
  const symbols = includeSymbols
    ? getLayoutKeys(hand, layoutVariant).filter((item) => item.isSymbol).map((item) => item.value)
    : []
  const lengths = LEVEL_LENGTHS[level]
  const random = mulberry32(seedFromOptions({ hand, level, includeSymbols, layoutVariant, cycle }))
  const pickLetter = createWeightedPicker(weightedKeys, random)
  const questions = []

  for (let questionIndex = 0; questionIndex < QUESTION_COUNT; questionIndex += 1) {
    const length = lengths[questionIndex % lengths.length]

    if (level === 1) {
      const scheduledSymbol = addScheduledSymbol([''], symbols, questionIndex, random)[0]
      const previous = questions.at(-1) ?? ''
      questions.push(scheduledSymbol || pickLetter(previous))
      continue
    }

    let question = ''
    for (let attempt = 0; attempt < UNIQUE_GENERATION_ATTEMPTS; attempt += 1) {
      const characters = generatedLetters(pickLetter, length)
      const candidate = addScheduledSymbol(characters, symbols, questionIndex, random).join('')
      question = candidate
      if (!questions.includes(candidate)) break
    }
    questions.push(question)
  }

  return questions
}

function avoidBoundaryDuplicate(questions, previousQuestion, level) {
  if (!previousQuestion || questions[0] !== previousQuestion) return questions

  const firstHasSymbol = /[;,./]/.test(questions[0])
  for (let index = 1; index < questions.length - 1; index += 1) {
    if (/[;,./]/.test(questions[index]) !== firstHasSymbol) continue
    const candidate = [...questions]
    const firstQuestion = candidate[0]
    candidate[0] = candidate[index]
    candidate[index] = firstQuestion
    const hasAdjacentDuplicate = level === 1
      && candidate.some((question, candidateIndex) => (
        candidateIndex > 0 && question === candidate[candidateIndex - 1]
      ))
    if (candidate[0] !== previousQuestion && !hasAdjacentDuplicate) return candidate
  }
  return questions
}

export function createQuestionBank({
  hand = 'left',
  level = 1,
  includeSymbols = false,
  layoutVariant = 'jis',
  cycle = 0,
} = {}) {
  const normalizedLevel = [1, 2, 3].includes(Number(level)) ? Number(level) : 1
  const normalizedCycle = Number.isSafeInteger(cycle) && cycle >= 0 ? cycle : 0
  const options = {
    hand,
    level: normalizedLevel,
    includeSymbols,
    layoutVariant,
    cycle: normalizedCycle,
  }
  const questions = generateQuestionBank(options)
  if (normalizedCycle === 0) return questions

  const previousQuestions = generateQuestionBank({ ...options, cycle: normalizedCycle - 1 })
  return avoidBoundaryDuplicate(questions, previousQuestions.at(-1), normalizedLevel)
}

export function validateQuestions(questions, { hand = 'left', includeSymbols = false, layoutVariant = 'jis' } = {}) {
  const allowed = new Set(
    getLayoutKeys(hand, layoutVariant, { includeSymbols }).map((item) => item.value.toLowerCase()),
  )

  return questions.every((question) => (
    typeof question === 'string'
    && question.length > 0
    && [...question.toLowerCase()].every((character) => allowed.has(character))
  ))
}

export function getQuestion(options, questionIndex = 0) {
  const normalizedIndex = Number.isSafeInteger(questionIndex) && questionIndex >= 0 ? questionIndex : 0
  const cycle = Math.floor(normalizedIndex / QUESTION_COUNT)
  const questions = createQuestionBank({ ...options, cycle })
  if (!validateQuestions(questions, options)) {
    throw new Error('選択中の手で入力できない問題が含まれています。')
  }
  return questions[normalizedIndex % questions.length]
}
