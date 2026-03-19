/**
 * Triggers a real file download that works on both mobile and desktop browsers.
 *
 * `window.open()` and `<a target="_blank">` just open media in a new tab on
 * mobile Safari/Chrome instead of downloading. This function fetches the file
 * as a blob and triggers a download via a temporary anchor with the `download`
 * attribute, which works reliably across all browsers.
 *
 * If the blob fetch fails (e.g. CORS), it falls back to an `<a download>`
 * link which still hints to the browser that a download is intended.
 */
export async function downloadFile(url: string, fallbackFilename?: string): Promise<void> {
  const filename =
    fallbackFilename || decodeURIComponent(url.split("/").pop()?.split("?")[0] || "download");

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    triggerAnchorDownload(blobUrl, filename);

    // Clean up blob URL after a short delay to ensure the download starts
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  } catch {
    // Blob fetch failed (likely CORS). Fall back to <a download> which
    // still works for same-origin and hints to the browser for cross-origin.
    // This is strictly better than window.open which just plays the video.
    triggerAnchorDownload(url, filename);
  }
}

function triggerAnchorDownload(href: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  // Small delay so Safari processes the click before removal
  setTimeout(() => anchor.remove(), 100);
}
