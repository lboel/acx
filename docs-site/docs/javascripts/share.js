(() => {
  const ready = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true })
    else fn()
  }

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    if (!copied) throw new Error('clipboard unavailable')
  }

  const bindShareActions = () => {
    const shareButton = document.querySelector('[data-acx-share]')
    const shareStatus = document.querySelector('[data-acx-share-status]')
    if (shareButton && !shareButton.dataset.acxBound) {
      shareButton.dataset.acxBound = 'true'
      shareButton.addEventListener('click', async () => {
        const data = {
          title: 'ACX — share agents, workflows, and Agent Graphs',
          text: 'Share an AI agent, team workflow, or information architecture as one signed, verifiable artifact.',
          url: window.location.href,
        }
        try {
          if (navigator.share) {
            await navigator.share(data)
            if (shareStatus) shareStatus.textContent = 'Shared.'
          } else {
            await copyText(window.location.href)
            if (shareStatus) shareStatus.textContent = 'Link copied.'
          }
        } catch (error) {
          if (error?.name !== 'AbortError' && shareStatus) {
            shareStatus.textContent = 'Copy this page URL from the address bar.'
          }
        }
      })
    }

    document.querySelectorAll('[data-acx-copy]').forEach((button) => {
      if (button.dataset.acxBound) return
      button.dataset.acxBound = 'true'
      button.addEventListener('click', async () => {
        const status = button.parentElement?.querySelector('[data-acx-copy-status]')
        try {
          await copyText(button.dataset.acxCopy || '')
          if (status) status.textContent = 'Copied.'
        } catch {
          if (status) status.textContent = 'Select the command above and copy it.'
        }
      })
    })
  }

  ready(() => {
    bindShareActions()
    if (typeof document$ !== 'undefined') document$.subscribe(bindShareActions)
  })
})()
