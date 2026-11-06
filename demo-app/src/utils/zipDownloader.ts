/**
 * Client-Side ZIP Downloader for GuardRuntime Complete Project & Research Suite
 * Optimized for sandboxed iframes, standard browser tabs, and direct downloads.
 */

export function getZipDownloadUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/export/zip`;
  }
  return '/api/export/zip';
}

export async function downloadCompleteProjectZip(
  onProgress?: (status: 'downloading' | 'ready' | 'error', message?: string) => void
): Promise<boolean> {
  if (onProgress) onProgress('downloading', 'Fetching project archive (~300 KB)...');

  try {
    const res = await fetch('/api/export/zip');
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}: ${res.statusText}`);
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = 'guardruntime-complete.zip';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 2000);

    if (onProgress) {
      onProgress('ready', 'guardruntime-complete.zip saved to your Downloads folder!');
    }
    return true;
  } catch (err: any) {
    console.error('ZIP blob fetch failed, trying direct location navigation:', err);
    try {
      const a = document.createElement('a');
      a.href = '/api/export/zip';
      a.download = 'guardruntime-complete.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
      }, 1000);

      if (onProgress) onProgress('ready', 'Download stream initiated!');
      return true;
    } catch (fallbackErr: any) {
      if (onProgress) onProgress('error', err.message || 'Download failed');
      return false;
    }
  }
}


