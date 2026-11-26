export interface OutboundGuardOptions {
  allowedHostnamePattern?: RegExp
  timeoutMs?: number
  maxResponseBytes?: number
}

export class LmsOutboundGuard {
  private readonly allowedHostnamePattern: RegExp
  readonly timeoutMs: number
  readonly maxResponseBytes: number

  constructor(options: OutboundGuardOptions = {}) {
    this.allowedHostnamePattern = options.allowedHostnamePattern ?? /(^|\.)edu\.gov\.qa$/i
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.maxResponseBytes = options.maxResponseBytes ?? 1_000_000
  }

  validateUrl(value: string): URL {
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('LMS URLs must use HTTPS.')
    if (!this.allowedHostnamePattern.test(url.hostname)) throw new Error('LMS host is not approved.')
    if (url.username || url.password) throw new Error('Credentials are not permitted in LMS URLs.')
    return url
  }

  validateRedirect(currentUrl: URL, location: string): URL {
    const next = new URL(location, currentUrl)
    return this.validateUrl(next.toString())
  }

  async readLimitedText(response: Response): Promise<string> {
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > this.maxResponseBytes) throw new Error('LMS response exceeds the configured size limit.')
    if (!response.body) return response.text()
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > this.maxResponseBytes) throw new Error('LMS response exceeds the configured size limit.')
      chunks.push(part.value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(merged)
  }
}
