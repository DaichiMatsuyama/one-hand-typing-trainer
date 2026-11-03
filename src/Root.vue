<script setup>
import { ref } from 'vue'
import App from './App.vue'
import AccessGate from './components/AccessGate.vue'
import { REMOTE_ENDPOINT } from './remoteConfig.js'
import { evaluateGate, isStandaloneDisplay, loadAccess } from './services/access.js'

const props = defineProps({
  endpoint: { type: String, default: REMOTE_ENDPOINT },
})

const gate = ref(evaluateGate({
  endpoint: props.endpoint,
  hostname: window.location.hostname,
  search: window.location.search,
  standalone: isStandaloneDisplay(window),
  access: loadAccess(),
}))
</script>

<template>
  <App v-if="gate === 'open'" />
  <AccessGate v-else :mode="gate" :endpoint="endpoint" @granted="gate = 'open'" />
</template>
