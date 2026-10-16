/** How a camera's frames are placed on the 16:9 output; mirrors the NORMALIZE shader. */
export interface SourceGeometry {
  /** Video width / height as decoded. */
  aspect: number;
  /** Quarter turns clockwise. */
  rotation: number;
  mirror: boolean;
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/**
 * Maps MediaPipe landmarks (normalized image coords, origin top-left, z ≈ depth in image widths,
 * negative toward the camera) into output pixels (origin bottom-left, y up, z toward the camera).
 */
export function landmarksToOutput(
  landmarks: readonly Landmark[],
  geometry: SourceGeometry,
  out: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const rot = ((geometry.rotation % 4) + 4) % 4;
  const displayAspect = rot % 2 ? 1 / geometry.aspect : geometry.aspect;
  const r = displayAspect / (width / height);
  const sx = r > 1 ? 1 : r;
  const sy = r > 1 ? 1 / r : 1;
  const imageWidthPx = rot % 2 ? sy * height : sx * width;
  for (let i = 0; i < landmarks.length; i++) {
    const { x, y, z } = landmarks[i];
    const qx = x;
    const qy = 1 - y;
    let px = qx;
    let py = qy;
    if (rot === 1) [px, py] = [qy, 1 - qx];
    else if (rot === 2) [px, py] = [1 - qx, 1 - qy];
    else if (rot === 3) [px, py] = [1 - qy, qx];
    if (geometry.mirror) px = 1 - px;
    out[i * 3] = ((px - 0.5) * sx + 0.5) * width;
    out[i * 3 + 1] = ((py - 0.5) * sy + 0.5) * height;
    out[i * 3 + 2] = -z * imageWidthPx;
  }
  return out;
}
