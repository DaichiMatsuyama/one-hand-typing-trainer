export async function startPractice(wrapper) {
  await wrapper.get('[data-testid="start-practice"]').trigger('click')
  await wrapper.vm.$nextTick()
}

export async function completeCurrentQuestion(wrapper) {
  while (wrapper.find('.prompt-text .current').exists()) {
    const expected = wrapper.get('.prompt-text .current').text()
    await wrapper.get(`[data-key="${expected}"]`).trigger('click')
  }
}

export async function openPracticeMenu(wrapper) {
  await wrapper.get('[data-testid="menu-button"]').trigger('click')
  await wrapper.vm.$nextTick()
}
