/**
 * Extracts frames from a video element and provides them as a canvas
 * suitable for Three.js texture updates on the sphere.
 */

export class VideoFrameExtractor {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private animationId: number | null = null
  private onFrame: (() => void) | null = null

  constructor() {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
  }

  /**
   * Extract a single frame from the video and draw it to the canvas.
   * Canvas auto-sizes to match the video's native resolution.
   */
  extractFrame(video: HTMLVideoElement): HTMLCanvasElement {
    if (video.videoWidth && video.videoHeight) {
      if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
        this.canvas.width = video.videoWidth
        this.canvas.height = video.videoHeight
        console.log(`[FrameExtractor] Canvas resized to ${video.videoWidth}x${video.videoHeight}`)
      }
    }
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height)
    return this.canvas
  }

  /**
   * Start a continuous frame extraction loop using requestAnimationFrame.
   * Calls onFrame callback each frame so the caller can update the sphere texture.
   */
  startLoop(video: HTMLVideoElement, onFrame: (canvas: HTMLCanvasElement) => void): void {
    this.stopLoop()

    const loop = () => {
      if (!video.paused && !video.ended && video.readyState >= 2) {
        this.extractFrame(video)
        onFrame(this.canvas)
      }
      this.animationId = requestAnimationFrame(loop)
    }

    this.animationId = requestAnimationFrame(loop)
  }

  /**
   * Stop the frame extraction loop
   */
  stopLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  /**
   * Get the canvas (for initial texture creation)
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas
  }

  destroy(): void {
    this.stopLoop()
    this.canvas.remove()
  }
}
