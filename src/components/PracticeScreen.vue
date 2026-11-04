<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import KeyboardView from './KeyboardView.vue'
import LevelSelector from './LevelSelector.vue'
import PromptView from './PromptView.vue'
import ResultView from './ResultView.vue'

const props = defineProps({
  engine: { type: Object, required: true },
})

const {
  settings,
  session,
  resetNotice,
  layout,
  nextKey,
  nextFinger,
  totalStats,
  elapsedText,
  pressKey,
  resetQuestion,
  resetAllStats,
  selectHand,
  selectLevel,
  toggleSymbols,
} = props.engine

onMounted(() => props.engine.attach())
onBeforeUnmount(() => props.engine.detach())
</script>

<template>
  <main class="practice-layout">
    <section
      class="info-strip"
      :class="{ complete: session.isComplete }"
      data-testid="info-strip"
      aria-label="練習内容と設定"
    >
      <header class="compact-header">
        <div class="brand">
          <p class="brand-kicker">キー位置を片手ずつ覚える</p>
          <h1>片手タイピング</h1>
        </div>

        <div class="control-stack">
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

          <LevelSelector :model-value="settings.level" @update:model-value="selectLevel" />

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
              <span class="symbol-label-full" aria-hidden="true">
                <span>記号を</span><span>含める</span>
              </span>
              <span class="symbol-label-compact" aria-hidden="true">記号</span>
              <small v-if="settings.hand === 'left'" id="symbol-hand-hint">右手のみ</small>
            </span>
          </label>
        </div>
      </header>

      <PromptView
        :question="session.question"
        :position="session.position"
        :hand="settings.hand"
        :layout-variant="settings.layoutVariant"
        :is-complete="session.isComplete"
      />

      <ResultView
        :elapsed-text="elapsedText"
        :accuracy="totalStats.accuracy"
        :mistakes="totalStats.mistakes"
        :is-complete="session.isComplete"
        :feedback="session.feedback"
        :notice="resetNotice"
        :next-key="nextKey"
        :next-finger="nextFinger"
        :completed-questions="totalStats.completedQuestions"
        @reset="resetQuestion"
        @reset-all="resetAllStats"
      />
    </section>

    <KeyboardView
      :layout="layout"
      :next-key="nextKey"
      :feedback="session.feedback"
      :disabled="session.isComplete"
      @press="pressKey"
    />
  </main>
</template>
