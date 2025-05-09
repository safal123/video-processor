import { ResolutionTarget } from '../types'

export const resolutionTargets: Record<string, ResolutionTarget> = {
  // '4320p': { width: 7680, height: 4320, baseBitrate: 30000, crf: 18 }, // 8K
  '2160p': { width: 3840, height: 2160, baseBitrate: 15000, crf: 20 }, // 4K
  '1440p': { width: 2560, height: 1440, baseBitrate: 8000, crf: 21 }, // 2K
  '1080p': { width: 1920, height: 1080, baseBitrate: 5000, crf: 22 }, // Full HD
  '720p': { width: 1280, height: 720, baseBitrate: 2500, crf: 23 }, // HD
  '480p': { width: 854, height: 480, baseBitrate: 1000, crf: 23 }, // SD
  // '360p': { width: 640, height: 360, baseBitrate: 750, crf: 23 }, // Low quality
  // '240p': { width: 426, height: 240, baseBitrate: 400, crf: 23 }, // Very low quality
  // '144p': { width: 256, height: 144, baseBitrate: 200, crf: 23 }, // Minimum quality
}