export const APP_STORE_URL = '';
export const GOOGLE_PLAY_URL = '';

const STORE_RULES = {
  apple: 'https://apps.apple.com/',
  google: 'https://play.google.com/store/apps/',
};

export function allowlistedStoreUrl(store, value) {
  const prefix = STORE_RULES[store];
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!prefix || !candidate.startsWith(prefix)) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (store === 'apple' && url.hostname !== 'apps.apple.com') return '';
    if (store === 'google'
      && (url.hostname !== 'play.google.com' || !url.pathname.startsWith('/store/apps/'))) return '';
    return candidate;
  } catch {
    return '';
  }
}

export function renderStoreLinks(root = document) {
  const urls = { apple: APP_STORE_URL, google: GOOGLE_PLAY_URL };
  for (const badge of root.querySelectorAll('[data-store]')) {
    const store = badge.dataset.store;
    const href = allowlistedStoreUrl(store, urls[store]);
    if (!href) continue;
    const link = root.createElement('a');
    link.className = badge.className;
    link.dataset.store = store;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${store === 'apple' ? 'App Store' : 'Google Play'} で見る`;
    badge.replaceWith(link);
  }
}

if (typeof document !== 'undefined') renderStoreLinks(document);
