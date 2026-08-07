export function gameScreenshotFilename(now = Date.now()): string {
  return `lakecraft-${new Date(now).toISOString().replace("T", "_").replaceAll(":", "-").slice(0, 19)}.png`;
}

/** Starts during the F2 gesture; ClipboardItem may resolve the PNG next frame. */
export function copyGameScreenshot(png: Promise<Blob>): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return Promise.resolve(false);
    return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function downloadGameScreenshot(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
