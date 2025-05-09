export interface ResolutionTarget {
  width: number;
  height: number;
  baseBitrate: number;
  crf: number;
}

export interface VariantPlaylist {
  width: number;
  height: number;
  bitrate: string;
  resolution: string;
  playlist: string;
}