const WHATSAPP_KEYWORDS = /\bwhatsapp\b|\bwhats\s*app\b/i;

const DELIVERY_PATTERNS = [
  /\bsend\b[\s\S]{0,120}\b(result|output|summary|final|answer|response)\b[\s\S]{0,120}\bwhatsapp\b/i,
  /\bdeliver\b[\s\S]{0,80}\bwhatsapp\b/i,
  /\bnotify\b[\s\S]{0,80}\bwhatsapp\b/i,
  /\bformatted\s+for\s+whatsapp\b/i,
  /\bon\s+whatsapp\b/i,
];

/**
 * True when user text asks for the run result to be sent via WhatsApp.
 */
export function goalRequestsWhatsAppDelivery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (WHATSAPP_KEYWORDS.test(t)) return true;
  return DELIVERY_PATTERNS.some((re) => re.test(t));
}
