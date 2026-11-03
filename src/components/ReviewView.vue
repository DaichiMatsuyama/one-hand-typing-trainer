<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ADMIN_LONG_PRESS_MS } from '../appConfig.js'
import { getKeyboardLayout, getKeySpokenName } from '../data/keyboardLayouts.js'
import {
  accuracyPercent,
  accuracyPoints,
  dailyBars,
  formatDateLabel,
  formatJstDate,
  formatPracticeTime,
  heatLevel,
  keyMissStats,
  shortDeviceId,
  summarizeDaily,
  weakestKeys,
} from '../domain/review.js'
import { fetchDevices, fetchDeviceStats, fetchStats } from '../services/statsApi.js'

const props = defineProps({
  endpoint: { type: String, required: true },
  access: { type: Object, required: true },
  hand: { type: String, default: 'left' },
  fetchImpl: { type: Function, default: undefined },
  adminPressMs: { type: Number, default: ADMIN_LONG_PRESS_MS },
})

const root = ref(null)
const ADMIN_KEY = 'one-hand-typing-trainer:admin:v1'
const RELOAD_INTERVAL_MS = 20_000
const MAX_CONFUSIONS_SHOWN = 5

const state = ref('idle') // idle | loading | ready | error
const errorReason = ref('')
const stats = ref(null)
const heatHand = ref(props.hand === 'right' ? 'right' : 'left')
let lastLoadedAt = 0
let loadGeneration = 0

// 管理者表示
const adminOpen = ref(false)
const adminCodeInput = ref('')
const adminBusy = ref(false)
const adminError = ref('')
const devices = ref(null)
const viewing = ref(null) // null=この端末 / { deviceId, label }

function readAdminCode() {
  try {
    return localStorage.getItem(ADMIN_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveAdminCode(code) {
  try {
    localStorage.setItem(ADMIN_KEY, code)
  } catch {
    // 保存できなくても表示は続ける
  }
}

function forgetAdminCode() {
  try {
    localStorage.removeItem(ADMIN_KEY)
  } catch {
    // 何もしない
  }
}

function clearAdminSession(message) {
  forgetAdminCode()
  devices.value = null
  viewing.value = null
  adminCodeInput.value = ''
  adminOpen.value = true
  adminError.value = message
}

async function load({ force = false } = {}) {
  if (!force && state.value === 'ready' && Date.now() - lastLoadedAt < RELOAD_INTERVAL_MS) return
  const generation = ++loadGeneration
  const target = viewing.value ? { ...viewing.value } : null
  state.value = 'loading'
  errorReason.value = ''
  // 端末名だけが先に切り替わり、直前の端末の成績が見える状態を作らない。
  stats.value = null
  const common = { endpoint: props.endpoint, access: props.access, fetchImpl: props.fetchImpl }
  const result = target
    ? await fetchDeviceStats({
      ...common,
      adminCode: readAdminCode(),
      targetDeviceId: target.deviceId,
    })
    : await fetchStats(common)
  const currentTargetId = viewing.value?.deviceId ?? null
  if (generation !== loadGeneration || currentTargetId !== (target?.deviceId ?? null)) return
  if (result.ok) {
    stats.value = result.stats
    state.value = 'ready'
    lastLoadedAt = Date.now()
  } else {
    if (result.reason === 'invalid_admin') clearAdminSession(ERROR_TEXT.invalid_admin)
    errorReason.value = result.reason
    state.value = 'error'
  }
}

const ERROR_TEXT = {
  network: '通信できませんでした。電波のよい場所で、もう一度ひらいてください。',
  locked: 'しばらく表示できません。少し待ってから、もう一度ひらいてください。',
  invalid_admin: '管理者用コードが違います。',
  admin_not_configured: '管理者用コードがまだ設定されていません。',
  server: '成績を読み込めませんでした。しばらくしてから、もう一度ひらいてください。',
}
const errorText = computed(() => ERROR_TEXT[errorReason.value] ?? ERROR_TEXT.server)

// 管理者表示の入口: 見出しの長押し(画面には何も表示しない)
let adminPressTimer

function startAdminPress(event) {
  if (event.button !== undefined && event.button !== 0) return
  clearTimeout(adminPressTimer)
  adminPressTimer = setTimeout(() => {
    openAdmin()
    scrollToTop()
  }, props.adminPressMs)
}

function cancelAdminPress() {
  clearTimeout(adminPressTimer)
}

function closeAdmin() {
  adminOpen.value = false
}

async function openAdmin() {
  adminOpen.value = true
  adminError.value = ''
  const stored = readAdminCode()
  if (stored && !devices.value) await loadDevices(stored)
}

async function loadDevices(code) {
  adminBusy.value = true
  adminError.value = ''
  const result = await fetchDevices({
    endpoint: props.endpoint,
    access: props.access,
    adminCode: code,
    fetchImpl: props.fetchImpl,
  })
  adminBusy.value = false
  if (!result.ok) {
    const message = ERROR_TEXT[result.reason] ?? ERROR_TEXT.server
    if (result.reason === 'invalid_admin') clearAdminSession(message)
    else adminError.value = message
    return
  }
  saveAdminCode(code)
  devices.value = result.devices
}

async function submitAdmin() {
  const code = adminCodeInput.value.trim()
  if (!code || adminBusy.value) return
  await loadDevices(code)
  if (devices.value) adminCodeInput.value = ''
}

function deviceLabel(device) {
  const own = device.deviceId === props.access.deviceId ? '(この端末)' : ''
  return `端末 ${shortDeviceId(device.deviceId)}${own}`
}

function deviceDetail(device) {
  return `最終 ${formatJstDate(device.lastMs)}・${device.records}問・${formatPracticeTime(device.practiceMs)}`
}

// 端末の一覧は画面の一番下にあるので、切り替えたら先頭に戻して成績をすぐ見られるようにする
function scrollToTop() {
  root.value?.scrollTo?.({ top: 0, behavior: 'smooth' })
}

async function viewDevice(device) {
  viewing.value = device.deviceId === props.access.deviceId
    ? null
    : { deviceId: device.deviceId, label: `${deviceLabel(device)}(${deviceDetail(device)})` }
  scrollToTop()
  await load({ force: true })
}

async function backToSelf() {
  viewing.value = null
  scrollToTop()
  await load({ force: true })
}

// ---- 表示用の集計 ---------------------------------------------------------
const hasRecords = computed(() => (stats.value?.totals?.records ?? 0) > 0)
const today = computed(() => stats.value?.today ?? { records: 0, practiceMs: 0, attempts: 0, mistakes: 0 })
const todayAccuracy = computed(() => accuracyPercent(today.value.attempts, today.value.mistakes))
const totals = computed(() => stats.value?.totals ?? { records: 0, practiceMs: 0, days: 0 })

const keyStats = computed(() => keyMissStats(stats.value?.keys))
const heatLayout = computed(() => getKeyboardLayout(heatHand.value, 'jis'))
const weakKeys = computed(() => weakestKeys(stats.value?.keys, 3))

function heatPercent(stat) {
  return stat?.enough ? `${Math.round(stat.rate * 100)}%` : ''
}

function heatAria(item) {
  const stat = keyStats.value[item.value]
  const name = `${getKeySpokenName(item.value)}キー`
  if (!stat || stat.shown === 0) return `${name}: まだ出題されていません`
  if (!stat.enough) return `${name}: 出題${stat.shown}回、ミス${stat.misses}回(回数が少ないため割合は未表示)`
  return `${name}: 出題${stat.shown}回、ミス${stat.misses}回(${Math.round(stat.rate * 100)}%)`
}

const bars = computed(() => dailyBars(stats.value?.daily))
const dailySummary = computed(() => summarizeDaily(stats.value?.daily))
const points = computed(() => accuracyPoints(stats.value?.daily))
const confusions = computed(() => (stats.value?.confusions ?? []).slice(0, MAX_CONFUSIONS_SHOWN))

// SVGの座標(2つのグラフで共通の横幅・高さ)
const CHART = { width: 336, height: 150, top: 18, bottom: 28 }
const plotHeight = CHART.height - CHART.top - CHART.bottom

const barGeometry = computed(() => {
  const left = 8
  const slot = (CHART.width - left * 2) / Math.max(1, bars.value.length)
  return bars.value.map((bar, index) => {
    const height = bar.ratio * plotHeight
    return {
      ...bar,
      x: left + index * slot + (slot - 16) / 2,
      centerX: left + index * slot + slot / 2,
      height,
      y: CHART.top + plotHeight - height,
      showLabel: index % 2 === 0 || index === bars.value.length - 1,
    }
  })
})

const LINE_LEFT = 32
// 正答率がすべて50%以上なら、縦軸を50〜100%に拡大して、変化を見やすくする
const accuracyFloor = computed(() => (
  points.value.length > 0 && points.value.every((point) => point.percent >= 50) ? 50 : 0
))
const accuracyLevels = computed(() => [accuracyFloor.value, (accuracyFloor.value + 100) / 2, 100])

function accuracyY(percent) {
  const floor = accuracyFloor.value
  return CHART.top + plotHeight - ((percent - floor) / (100 - floor)) * plotHeight
}

const lineGeometry = computed(() => {
  const count = Math.max(1, stats.value?.daily?.length ?? 1)
  const slot = (CHART.width - LINE_LEFT - 8) / count
  const dots = points.value.map((point) => ({
    ...point,
    x: LINE_LEFT + (point.index + 0.5) * slot,
    y: accuracyY(point.percent),
  }))
  return {
    dots,
    path: dots.map((dot) => `${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(' '),
    labels: (stats.value?.daily ?? []).map((day, index) => ({
      x: LINE_LEFT + (index + 0.5) * slot,
      text: formatDateLabel(day.date),
      show: index % 2 === 0 || index === count - 1,
    })),
  }
})

const barsAria = computed(() => (
  `直近14日の練習時間。${dailySummary.value.practicedDays}日練習し、合計${formatPracticeTime(dailySummary.value.practiceMs)}です。`
))
const lineAria = computed(() => {
  if (points.value.length === 0) return '正答率の記録はまだありません。'
  const last = points.value.at(-1)
  return `正答率の推移。最後の記録は${last.label}の${last.percent}%です。`
})

// ---- 画面の向きに合わせた読み込み ------------------------------------------
const portraitQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(orientation: portrait) and (max-width: 700px)')
  : null

function onOrientationChange() {
  if (!portraitQuery || portraitQuery.matches) load()
}

onMounted(() => {
  portraitQuery?.addEventListener?.('change', onOrientationChange)
  onOrientationChange()
})

onBeforeUnmount(() => {
  clearTimeout(adminPressTimer)
  portraitQuery?.removeEventListener?.('change', onOrientationChange)
})

defineExpose({ load })
</script>

<template>
  <aside ref="root" class="review-screen" aria-labelledby="review-title" data-testid="review-screen">
    <header class="review-header">
      <h2
        id="review-title"
        class="review-title"
        data-testid="review-title"
        @pointerdown="startAdminPress"
        @pointerup="cancelAdminPress"
        @pointercancel="cancelAdminPress"
        @pointerleave="cancelAdminPress"
        @contextmenu.prevent
      >振り返り</h2>
      <p class="review-rotate">横向きにすると、練習できます。</p>
    </header>

    <section v-if="adminOpen" class="review-admin" aria-labelledby="review-admin-title">
      <div class="admin-panel" data-testid="admin-panel">
        <h3 id="review-admin-title">管理者として見る</h3>

        <form v-if="!devices" class="admin-form" @submit.prevent="submitAdmin">
          <label for="admin-code">管理者用コード</label>
          <input
            id="admin-code"
            v-model="adminCodeInput"
            data-testid="admin-code"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            :disabled="adminBusy"
          />
          <button type="submit" class="review-button" data-testid="admin-submit" :disabled="adminBusy || !adminCodeInput.trim()">
            {{ adminBusy ? '確認中…' : '表示する' }}
          </button>
        </form>

        <p v-if="adminError" class="review-error" role="alert" data-testid="admin-error">{{ adminError }}</p>

        <ul v-if="devices" class="device-list" data-testid="device-list">
          <li v-if="devices.length === 0">記録のある端末は、まだありません。</li>
          <li v-for="device in devices" :key="device.deviceId">
            <button type="button" class="device-button" :data-device="device.deviceId" @click="viewDevice(device)">
              <strong>{{ deviceLabel(device) }}</strong>
              <span>{{ deviceDetail(device) }}</span>
            </button>
          </li>
        </ul>
      </div>
      <button type="button" class="review-link" data-testid="admin-close" @click="closeAdmin">閉じる</button>
    </section>

    <p v-if="viewing" class="review-viewing" data-testid="review-viewing">
      <span>管理者表示: {{ viewing.label }}</span>
      <button type="button" class="review-link" data-testid="review-back" @click="backToSelf">自分の記録に戻る</button>
    </p>

    <p v-if="state === 'loading' && !stats" class="review-message" role="status">読み込み中…</p>

    <div v-else-if="state === 'error'" class="review-message" role="alert" data-testid="review-error">
      <p>{{ errorText }}</p>
      <button type="button" class="review-button" data-testid="review-retry" @click="load({ force: true })">もう一度読み込む</button>
    </div>

    <template v-if="stats && (state === 'ready' || state === 'loading')">
      <p v-if="!hasRecords" class="review-message" data-testid="review-empty">
        まだ記録がありません。横向きにして練習すると、ここに成績が出ます。
      </p>

      <template v-else>
        <section class="review-section" aria-labelledby="review-today">
          <h3 id="review-today">今日のまとめ</h3>
          <dl class="review-cards">
            <div><dt>練習時間</dt><dd data-testid="today-time">{{ formatPracticeTime(today.practiceMs) }}</dd></div>
            <div><dt>クリア</dt><dd data-testid="today-count">{{ today.records }}問</dd></div>
            <div><dt>正答率</dt><dd data-testid="today-accuracy">{{ todayAccuracy === null ? '-' : `${todayAccuracy}%` }}</dd></div>
            <div><dt>連続練習</dt><dd data-testid="streak">{{ stats.streak }}日</dd></div>
          </dl>
          <p class="review-total" data-testid="review-total">
            これまでの合計: {{ totals.days }}日 ・ {{ totals.records }}問 ・ {{ formatPracticeTime(totals.practiceMs) }}
          </p>
        </section>

        <section class="review-section" aria-labelledby="review-keys">
          <h3 id="review-keys">キーごとのミス</h3>
          <div class="review-tabs" role="group" aria-label="表示する手">
            <button
              v-for="option in ['left', 'right']"
              :key="option"
              type="button"
              :class="{ selected: heatHand === option }"
              :aria-pressed="heatHand === option"
              :data-testid="`heat-${option}`"
              @click="heatHand = option"
            >{{ option === 'left' ? '左手' : '右手' }}</button>
          </div>

          <div class="heatmap" data-testid="heatmap">
            <div
              v-for="row in heatLayout.rows"
              :key="row.id"
              class="heat-row"
              :style="{ '--row-offset': row.offset }"
            >
              <div
                v-for="item in row.keys"
                :key="item.value"
                class="heat-key"
                :class="`heat-${heatLevel(keyStats[item.value])}`"
                role="img"
                :aria-label="heatAria(item)"
                :data-key="item.value"
              >
                <span class="heat-char" aria-hidden="true">{{ item.value }}</span>
                <span class="heat-rate" aria-hidden="true">{{ heatPercent(keyStats[item.value]) }}</span>
              </div>
            </div>
          </div>

          <ul class="heat-legend" aria-label="色の見方">
            <li><span class="swatch heat-none"></span>回数が少ない</li>
            <li><span class="swatch heat-clean"></span>ミスなし</li>
            <li><span class="swatch heat-l1"></span><span class="swatch heat-l2"></span><span class="swatch heat-l3"></span><span class="swatch heat-l4"></span>ミスが多い</li>
          </ul>

          <p v-if="weakKeys.length" class="review-note" data-testid="weak-keys">
            苦手なキー:
            <span v-for="(weak, index) in weakKeys" :key="weak.key">{{ index ? '、' : '' }}<strong>{{ weak.key.toUpperCase() }}</strong>({{ Math.round(weak.rate * 100) }}%)</span>
          </p>
          <p v-else class="review-note">ミスの多いキーは、まだありません。</p>
        </section>

        <section class="review-section" aria-labelledby="review-daily">
          <h3 id="review-daily">日ごとの練習時間(分)</h3>
          <svg class="review-chart" :viewBox="`0 0 ${CHART.width} ${CHART.height}`" role="img" :aria-label="barsAria" data-testid="chart-daily">
            <line :x1="8" :x2="CHART.width - 8" :y1="CHART.top + plotHeight" :y2="CHART.top + plotHeight" class="axis" />
            <g v-for="bar in barGeometry" :key="bar.date">
              <rect v-if="bar.practiceMs > 0" :x="bar.x" :y="bar.y" width="16" :height="bar.height" rx="3" class="bar" data-testid="bar" />
              <text v-if="bar.practiceMs > 0" :x="bar.centerX" :y="bar.y - 3" text-anchor="middle" class="value">{{ bar.minutes === 0 ? '<1' : bar.minutes }}</text>
              <text v-if="bar.showLabel" :x="bar.centerX" :y="CHART.top + plotHeight + 14" text-anchor="middle" class="tick">{{ bar.label }}</text>
            </g>
          </svg>
        </section>

        <section class="review-section" aria-labelledby="review-accuracy">
          <h3 id="review-accuracy">正答率の推移</h3>
          <svg class="review-chart" :viewBox="`0 0 ${CHART.width} ${CHART.height}`" role="img" :aria-label="lineAria" data-testid="chart-accuracy">
            <g v-for="level in accuracyLevels" :key="level">
              <line :x1="LINE_LEFT" :x2="CHART.width - 8" :y1="accuracyY(level)" :y2="accuracyY(level)" :class="level === accuracyFloor ? 'axis' : 'grid'" />
              <text :x="LINE_LEFT - 4" :y="accuracyY(level) + 3" text-anchor="end" class="tick">{{ level }}%</text>
            </g>
            <polyline v-if="lineGeometry.dots.length > 1" :points="lineGeometry.path" class="line" />
            <g v-for="dot in lineGeometry.dots" :key="dot.date">
              <circle :cx="dot.x" :cy="dot.y" r="3.5" class="dot" data-testid="dot" />
              <text :x="dot.x" :y="dot.y - 7" text-anchor="middle" class="value">{{ dot.percent }}</text>
            </g>
            <text v-for="(label, index) in lineGeometry.labels" v-show="label.show" :key="index" :x="label.x" :y="CHART.top + plotHeight + 14" text-anchor="middle" class="tick">{{ label.text }}</text>
          </svg>
        </section>

        <section class="review-section" aria-labelledby="review-confusions">
          <h3 id="review-confusions">よくある押し間違い</h3>
          <ol v-if="confusions.length" class="confusions" data-testid="confusions">
            <li v-for="item in confusions" :key="`${item.expected}${item.pressed}`">
              <span class="pair"><strong>{{ item.expected.toUpperCase() }}</strong> のつもりで <strong>{{ item.pressed.toUpperCase() }}</strong> を押した</span>
              <span class="count">{{ item.count }}回</span>
            </li>
          </ol>
          <p v-else class="review-note">押し間違いの記録は、まだありません。</p>
        </section>
      </template>
    </template>

  </aside>
</template>
