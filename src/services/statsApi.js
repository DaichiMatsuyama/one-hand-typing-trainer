import { sanitizeReviewStats } from '../domain/review.js'

const TIMEOUT_MS = 15_000

/**
 * GASへ問い合わせる共通処理。Content-Typeを指定しない(text/plain)ことでCORSのプリフライトを避ける。
 * 戻り値: { ok: true, data } | { ok: false, reason }
 * reason: invalid(アクセスコード拒否) / invalid_admin / admin_not_configured / locked / network / server
 */
async function post(endpoint, payload, fetchImpl = (...args) => globalThis.fetch(...args)) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timeout = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller?.signal,
    })
    if (!response.ok) return { ok: false, reason: 'server' }
    const data = await response.json()
    if (data?.ok === true) return { ok: true, data }
    const known = ['invalid', 'invalid_admin', 'admin_not_configured', 'locked']
    return { ok: false, reason: known.includes(data?.error) ? data.error : 'server' }
  } catch {
    return { ok: false, reason: 'network' }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function fetchStats({ endpoint, access, fetchImpl }) {
  const result = await post(endpoint, { action: 'stats', code: access.code, deviceId: access.deviceId }, fetchImpl)
  return result.ok ? { ok: true, stats: sanitizeReviewStats(result.data.stats) } : result
}

export async function fetchDevices({ endpoint, access, adminCode, fetchImpl }) {
  const result = await post(endpoint, { action: 'admin_devices', code: access.code, adminCode }, fetchImpl)
  return result.ok ? { ok: true, devices: result.data.devices ?? [] } : result
}

export async function fetchDeviceStats({ endpoint, access, adminCode, targetDeviceId, fetchImpl }) {
  const result = await post(
    endpoint,
    { action: 'admin_stats', code: access.code, adminCode, targetDeviceId },
    fetchImpl,
  )
  return result.ok ? { ok: true, stats: sanitizeReviewStats(result.data.stats) } : result
}
