<script setup>
import { BUILD_ID } from '../buildInfo.js'
import { TIME_ATTACK_COUNTS, TIME_LIMIT_SECONDS } from '../appConfig.js'
import LevelSelector from './LevelSelector.vue'

const props = defineProps({
  engine: { type: Object, required: true },
})

const emit = defineEmits(['start'])
const { settings, updateSettings } = props.engine

function selectHand(hand) {
  if (hand !== settings.value.hand) updateSettings({ hand })
}

function selectLevel(level) {
  if (level !== settings.value.level) updateSettings({ level })
}

function toggleSymbols(event) {
  updateSettings({ includeSymbols: event.target.checked })
}

// 練習モード・手・レベルとは独立した設定。問題はそのままで、確認の有無だけを切り替える。
function toggleHomePosition(event) {
  updateSettings({ homePosition: event.target.checked })
}

function selectMode(mode) {
  if (mode !== settings.value.mode) updateSettings({ mode })
}

function selectTargetCount(targetCount) {
  updateSettings({ targetCount })
}

function selectTimeLimit(timeLimitSec) {
  updateSettings({ timeLimitSec })
}

const modeLabels = { free: 'フリー', timeAttack: 'タイムアタック', timeLimit: '制限時間' }
const modeDescriptions = {
  free: '時間も問題数も気にせず練習',
  timeAttack: '規定の問題数を、できるだけ速く',
  timeLimit: '決まった時間で、何問できるか',
}

function limitLabel(seconds) {
  return seconds < 60 ? `${seconds}秒` : `${seconds / 60}分`
}
</script>

<template>
  <main class="settings-screen" data-testid="settings-screen">
    <section class="settings-card">
      <header class="settings-heading">
        <p class="brand-kicker">キー位置を片手ずつ覚える</p>
        <h1>片手タイピング</h1>
      </header>

      <div class="settings-grid">
        <section class="setting-group">
          <h2>練習する手</h2>
          <fieldset class="segmented hand-selector" aria-label="練習する手">
            <legend class="visually-hidden">練習する手</legend>
            <button
              v-for="hand in ['left', 'right']"
              :key="hand"
              type="button"
              :class="{ selected: settings.hand === hand }"
              :aria-pressed="settings.hand === hand"
              :data-testid="`hand-${hand}`"
              @click="selectHand(hand)"
            >
              {{ hand === 'left' ? '左手' : '右手' }}
            </button>
          </fieldset>
        </section>

        <section class="setting-group level-setting">
          <h2>出題レベル</h2>
          <LevelSelector :model-value="settings.level" @update:model-value="selectLevel" />
          <p class="level-lengths" data-testid="level-lengths">
            <span>Lv.1 1文字</span><span>Lv.2 3〜5文字</span><span>Lv.3 5〜10文字</span>
          </p>
        </section>

        <section class="setting-group symbol-setting">
          <h2>出題する文字</h2>
          <label class="symbol-toggle">
            <input
              type="checkbox"
              :checked="settings.includeSymbols"
              :disabled="settings.hand === 'left'"
              aria-label="記号を含める"
              :aria-describedby="settings.hand === 'left' ? 'symbol-hand-hint' : undefined"
              :title="settings.hand === 'left' ? '記号は右手の練習でのみ出題できます' : '記号を問題に含める'"
              data-testid="include-symbols"
              @change="toggleSymbols"
            />
            <span class="symbol-label">
              <span>記号を含める</span>
              <small v-if="settings.hand === 'left'" id="symbol-hand-hint">右手のみ</small>
            </span>
          </label>
        </section>
      </div>

      <section class="mode-setting-row" aria-labelledby="mode-setting-title">
        <div class="mode-setting-main">
          <h2 id="mode-setting-title">練習モード</h2>
          <fieldset class="segmented mode-selector" aria-label="練習モード">
            <legend class="visually-hidden">練習モード</legend>
            <button
              v-for="mode in ['free', 'timeAttack', 'timeLimit']"
              :key="mode"
              type="button"
              :class="{ selected: settings.mode === mode }"
              :aria-pressed="settings.mode === mode"
              :data-testid="`mode-${mode}`"
              @click="selectMode(mode)"
            >{{ modeLabels[mode] }}</button>
          </fieldset>
        </div>

        <fieldset v-if="settings.mode === 'timeAttack'" class="segmented mode-options" aria-label="問題数">
          <legend class="visually-hidden">問題数</legend>
          <button
            v-for="count in TIME_ATTACK_COUNTS"
            :key="count"
            type="button"
            :class="{ selected: settings.targetCount === count }"
            :aria-pressed="settings.targetCount === count"
            :data-testid="`count-${count}`"
            @click="selectTargetCount(count)"
          >{{ count }}問</button>
        </fieldset>

        <fieldset v-if="settings.mode === 'timeLimit'" class="segmented mode-options" aria-label="制限時間">
          <legend class="visually-hidden">制限時間</legend>
          <button
            v-for="seconds in TIME_LIMIT_SECONDS"
            :key="seconds"
            type="button"
            :class="{ selected: settings.timeLimitSec === seconds }"
            :aria-pressed="settings.timeLimitSec === seconds"
            :data-testid="`limit-${seconds}`"
            @click="selectTimeLimit(seconds)"
          >{{ limitLabel(seconds) }}</button>
        </fieldset>

        <p class="mode-description" data-testid="mode-description">{{ modeDescriptions[settings.mode] }}</p>
      </section>

      <div class="settings-footer">
        <label class="symbol-toggle home-position-toggle">
          <input
            type="checkbox"
            :checked="settings.homePosition"
            aria-label="ホームポジション確認"
            aria-describedby="home-position-description"
            data-testid="home-position"
            @change="toggleHomePosition"
          />
          <span class="symbol-label">
            <span>ホームポジション確認</span>
            <small id="home-position-description">問題ごとに、指を置き直したか確認します</small>
          </span>
        </label>
        <button type="button" class="start-practice-button" data-testid="start-practice" @click="emit('start')">
          練習を始める
        </button>
      </div>
    </section>

    <small class="build-id" data-testid="build-id">{{ BUILD_ID }}</small>
  </main>
</template>
