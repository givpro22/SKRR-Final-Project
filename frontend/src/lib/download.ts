/** Blob을 파일로 저장한다. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  openLink(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 링크(presigned URL 등)를 새 탭 또는 다운로드로 연다. */
export function openLink(url: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  if (filename) anchor.download = filename;
  else anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
