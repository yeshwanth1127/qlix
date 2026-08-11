import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { extractTextFromUpload } from '../aiBrain/brainExtractText.js';
import { storeSandboxFile } from '../sandbox/sandboxClient.js';

export const CHAT_ATTACHMENT_MAX_FILES = 8;
export const CHAT_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_MB = 50;

export interface ChatAttachmentMeta {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
  textPreview?: string;
}

interface ProcessedChatAttachment extends ChatAttachmentMeta {
  extractedText?: string;
}

function toStoredAttachment(processed: ProcessedChatAttachment): ChatAttachmentMeta {
  const { extractedText: _omit, ...stored } = processed;
  return stored;
}

function guessMimeType(fileName: string, reported?: string): string {
  const trimmed = reported?.trim();
  if (trimmed && trimmed !== 'application/octet-stream') return trimmed;
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  return trimmed || 'application/octet-stream';
}

async function processOneFile(file: Express.Multer.File): Promise<ProcessedChatAttachment> {
  const fileName = (file.originalname || 'upload').slice(0, 255);
  const mimeType = guessMimeType(fileName, file.mimetype);
  const stored = await storeSandboxFile(file.buffer, fileName, mimeType);

  let extractedText: string | undefined;
  try {
    extractedText = await extractTextFromUpload(file.buffer, fileName);
  } catch {
    // Binary or unsupported — URL-only attachment is fine.
  }

  return {
    id: randomUUID(),
    fileName,
    mimeType,
    url: stored.url,
    sizeBytes: file.buffer.length,
    ...(extractedText ? { extractedText, textPreview: extractedText.slice(0, 500) } : {}),
  };
}

export async function processChatUploads(
  files: Express.Multer.File[],
  maxFiles: number = CHAT_ATTACHMENT_MAX_FILES,
): Promise<ProcessedChatAttachment[]> {
  if (files.length === 0) return [];
  if (files.length > maxFiles) {
    throw Object.assign(new Error(`Too many files (max ${maxFiles}).`), {
      code: 'too_many_files',
      status: 400,
    });
  }
  for (const file of files) {
    if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      throw Object.assign(
        new Error(`"${file.originalname || 'file'}" is too large (max ${CHAT_ATTACHMENT_MAX_MB} MB).`),
        {
          code: 'file_too_large',
          status: 413,
        },
      );
    }
  }
  return Promise.all(files.map(processOneFile));
}

export function storedChatAttachments(processed: ProcessedChatAttachment[]): ChatAttachmentMeta[] {
  return processed.map(toStoredAttachment);
}

export function buildPromptWithAttachments(
  userText: string,
  attachments: ProcessedChatAttachment[],
): string {
  if (attachments.length === 0) return userText.trim();

  const blocks = attachments.map((a) => {
    let block = `### ${a.fileName} (${a.mimeType}, ${Math.round(a.sizeBytes / 1024)} KB)\nDownload: ${a.url}`;
    if (a.extractedText) {
      block += `\n\nExtracted content:\n${a.extractedText}`;
    } else if (a.mimeType.startsWith('image/')) {
      block += '\n\n[Image — use the download URL if you need to reference it.]';
    } else {
      block += '\n\n[File attached — download from URL above.]';
    }
    return block;
  });

  const fileSection = blocks.join('\n\n---\n\n');
  const trimmed = userText.trim();
  if (trimmed) {
    return `${trimmed}\n\n---\nAttached files (${attachments.length}):\n\n${fileSection}`;
  }
  return `Attached files (${attachments.length}):\n\n${fileSection}`;
}
