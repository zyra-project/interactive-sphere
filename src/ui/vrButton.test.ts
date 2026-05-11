import { describe, it, expect } from 'vitest'
import { isHandheldArUserAgent } from './vrButton'

/**
 * Coverage for the UA-based "this AR session will be screen-tap"
 * heuristic that gates the phone-AR opt-in. Worth pinning because a
 * false positive on a controller-class device would hide Enter AR
 * unexpectedly for that user, and a false negative on Android would
 * leak the unfinished phone-AR UX past the flag.
 */

describe('isHandheldArUserAgent', () => {
  it('matches a stock Android Chrome UA', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36'
    expect(isHandheldArUserAgent(ua)).toBe(true)
  })

  it('matches Samsung Galaxy Chrome', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; SM-S908U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    expect(isHandheldArUserAgent(ua)).toBe(true)
  })

  it('does NOT match a Quest browser UA even though it contains Android', () => {
    // Quest's UA carries both `Android` and `Quest`. classifyXrDevice
    // resolves the conflict by matching `Quest` before the Android-AR
    // catch-all; otherwise the gate would hide Enter AR on the
    // reference platform.
    const ua = 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/30.0 Chrome/120.0.0.0 VR Safari/537.36'
    expect(isHandheldArUserAgent(ua)).toBe(false)
  })

  it('does NOT match a Pico headset UA even though it contains Android', () => {
    // Pico's UA also includes Android. Same disambiguation rule —
    // classifyXrDevice matches `Pico` first, so the controller-class
    // headset doesn't get its Enter AR button hidden behind the
    // phone opt-in. Caught in Copilot review of #96.
    const ua = 'Mozilla/5.0 (Linux; Android 12; Pico Neo 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile VR Safari/537.36'
    expect(isHandheldArUserAgent(ua)).toBe(false)
  })

  it('does NOT match desktop / PCVR Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    expect(isHandheldArUserAgent(ua)).toBe(false)
  })

  it('does NOT match Vision Pro Safari', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    expect(isHandheldArUserAgent(ua)).toBe(false)
  })

  it('returns false on an empty UA string (defensive)', () => {
    expect(isHandheldArUserAgent('')).toBe(false)
  })
})
