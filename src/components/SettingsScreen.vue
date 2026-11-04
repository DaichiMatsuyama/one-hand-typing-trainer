<script setup>
import { BUILD_ID } from '../buildInfo.js'
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

      <button type="button" class="start-practice-button" data-testid="start-practice" @click="emit('start')">
        練習を始める
      </button>
    </section>

    <small class="build-id" data-testid="build-id">{{ BUILD_ID }}</small>
  </main>
</template>
