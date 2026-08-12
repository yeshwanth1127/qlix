import type { LiveArtifactFormat } from './waitPolicy.types.js';

const FORMAT_EXTENSION: Record<LiveArtifactFormat, string> = {
  xlsx: 'xlsx',
  csv: 'csv',
  json: 'json',
  pdf: 'pdf',
  pptx: 'pptx',
  md: 'md',
  html: 'html',
};

/** Infer output format from the user's goal (before LLM column picking runs). */
export function inferLiveArtifactFormatFromGoal(goal: string): LiveArtifactFormat {
  const g = goal.toLowerCase();
  if (/\b(pptx|powerpoint|\bppt\b|slides?\b|deck)\b/.test(g)) return 'pptx';
  if (/\b(pdf)\b/.test(g)) return 'pdf';
  if (/\b(html|web page)\b/.test(g)) return 'html';
  if (/\b(markdown|\bmd\b)\b/.test(g)) return 'md';
  if (/\b(csv)\b/.test(g)) return 'csv';
  if (/\b(json)\b/.test(g)) return 'json';
  if (/\b(sheet|spreadsheet|excel|xlsx|workbook)\b/.test(g)) return 'xlsx';
  return 'xlsx';
}

export function extensionForFormat(format: LiveArtifactFormat): string {
  return FORMAT_EXTENSION[format] ?? 'bin';
}

export function inferFormatFromFileName(fileName: string): LiveArtifactFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  for (const [format, mapped] of Object.entries(FORMAT_EXTENSION)) {
    if (mapped === ext) return format as LiveArtifactFormat;
  }
  return null;
}

export function isTabularLiveFormat(format: LiveArtifactFormat): boolean {
  return format === 'xlsx' || format === 'csv' || format === 'json';
}

export type LiveArtifactPreviewKind = 'table' | 'pdf' | 'office' | 'html' | 'markdown' | 'download';

export function previewKindForFormat(format: LiveArtifactFormat): LiveArtifactPreviewKind {
  if (isTabularLiveFormat(format)) return 'table';
  if (format === 'pdf') return 'pdf';
  if (format === 'pptx') return 'office';
  if (format === 'html') return 'html';
  if (format === 'md') return 'markdown';
  return 'download';
}

/** Sandbox URL suitable for inline browser preview (PDF iframe, Office embed). */
export function inlinePreviewUrl(downloadUrl: string): string {
  if (!downloadUrl) return downloadUrl;
  return downloadUrl.includes('?') ? `${downloadUrl}&inline=1` : `${downloadUrl}?inline=1`;
}

export function officeEmbedUrl(downloadUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(inlinePreviewUrl(downloadUrl))}`;
}
