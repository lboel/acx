export function preferredShareUrl(declaredUrl, canonicalUrl, currentUrl) {
  for (const candidate of [declaredUrl, canonicalUrl, currentUrl]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

export async function copyText(text, {
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
} = {}) {
  if (!text) throw new Error('share URL is unavailable')

  if (navigatorObject?.clipboard?.writeText) {
    try {
      await navigatorObject.clipboard.writeText(text)
      return
    } catch {
      // Clipboard permissions vary by browser and origin. Use the local,
      // selection-based fallback before asking the reader to copy manually.
    }
  }

  if (!documentObject?.body || !documentObject.createElement) {
    throw new Error('clipboard fallback is unavailable')
  }
  const field = documentObject.createElement('textarea')
  field.value = text
  field.className = 'clipboard-proxy'
  field.setAttribute('readonly', '')
  field.setAttribute('aria-hidden', 'true')
  documentObject.body.appendChild(field)
  field.select()
  const copied = documentObject.execCommand?.('copy')
  field.remove()
  if (!copied) throw new Error('clipboard fallback was refused')
}

export function bindCopyLinks(root = globalThis.document) {
  if (!root?.querySelectorAll) return

  const canonicalUrl = root.querySelector('link[rel="canonical"]')?.href
  root.querySelectorAll('[data-acx-copy-link]').forEach((button) => {
    if (button.dataset.acxBound === 'true') return
    button.dataset.acxBound = 'true'

    button.addEventListener('click', async () => {
      const statusId = button.getAttribute('aria-describedby')
      const status = statusId && root.getElementById
        ? root.getElementById(statusId)
        : null
      const shareUrl = preferredShareUrl(
        button.dataset.acxCopyLink,
        canonicalUrl,
        globalThis.location?.href,
      )

      try {
        await copyText(shareUrl)
        if (status) status.textContent = 'Canonical share link copied.'
      } catch {
        if (status) status.textContent = 'Copy unavailable. Use the address bar to copy this page.'
      }
    })
  })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bindCopyLinks(), { once: true })
  } else {
    bindCopyLinks()
  }
}
