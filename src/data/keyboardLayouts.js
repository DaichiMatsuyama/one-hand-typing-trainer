export const FINGERS = {
  leftPinky: { id: 'leftPinky', label: '小指', shortLabel: '小' },
  leftRing: { id: 'leftRing', label: '薬指', shortLabel: '薬' },
  leftMiddle: { id: 'leftMiddle', label: '中指', shortLabel: '中' },
  leftIndex: { id: 'leftIndex', label: '人差し指', shortLabel: '人' },
  rightIndex: { id: 'rightIndex', label: '人差し指', shortLabel: '人' },
  rightMiddle: { id: 'rightMiddle', label: '中指', shortLabel: '中' },
  rightRing: { id: 'rightRing', label: '薬指', shortLabel: '薬' },
  rightPinky: { id: 'rightPinky', label: '小指', shortLabel: '小' },
}

const key = (value, finger, options = {}) => ({
  value,
  finger,
  isHome: false,
  isSymbol: false,
  ...options,
})

const createCommonLayouts = () => ({
  left: {
    hand: 'left',
    label: '左手',
    rows: [
      { id: 'top', offset: 0, keys: [key('q', 'leftPinky'), key('w', 'leftRing'), key('e', 'leftMiddle'), key('r', 'leftIndex'), key('t', 'leftIndex')] },
      { id: 'home', offset: 0.25, keys: [key('a', 'leftPinky'), key('s', 'leftRing'), key('d', 'leftMiddle'), key('f', 'leftIndex', { isHome: true }), key('g', 'leftIndex')] },
      { id: 'bottom', offset: 0.75, keys: [key('z', 'leftPinky'), key('x', 'leftRing'), key('c', 'leftMiddle'), key('v', 'leftIndex'), key('b', 'leftIndex')] },
    ],
  },
  right: {
    hand: 'right',
    label: '右手',
    rows: [
      { id: 'top', offset: 0, keys: [key('y', 'rightIndex'), key('u', 'rightIndex'), key('i', 'rightMiddle'), key('o', 'rightRing'), key('p', 'rightPinky')] },
      { id: 'home', offset: 0.25, keys: [key('h', 'rightIndex'), key('j', 'rightIndex', { isHome: true }), key('k', 'rightMiddle'), key('l', 'rightRing'), key(';', 'rightPinky', { isSymbol: true })] },
      { id: 'bottom', offset: 0.75, keys: [key('n', 'rightIndex'), key('m', 'rightIndex'), key(',', 'rightMiddle', { isSymbol: true }), key('.', 'rightRing', { isSymbol: true }), key('/', 'rightPinky', { isSymbol: true })] },
    ],
  },
})

// MVP対象キーはJIS/USで共通。別オブジェクトにして将来の差分追加を容易にする。
export const keyboardLayouts = {
  jis: createCommonLayouts(),
  us: createCommonLayouts(),
}

export function getKeyboardLayout(hand, layoutVariant = 'jis') {
  const variant = keyboardLayouts[layoutVariant] ? layoutVariant : 'jis'
  const selectedHand = hand === 'right' ? 'right' : 'left'
  return keyboardLayouts[variant][selectedHand]
}

export function getLayoutKeys(hand, layoutVariant = 'jis', { includeSymbols = true } = {}) {
  return getKeyboardLayout(hand, layoutVariant).rows
    .flatMap((row) => row.keys)
    .filter((item) => includeSymbols || !item.isSymbol)
}

export function getFinger(fingerId) {
  return FINGERS[fingerId]
}
