export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"'`=\/]/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#x60;',
    '=': '&#x3D;',
    '/': '&#x2F;',
  }[match]));
}
