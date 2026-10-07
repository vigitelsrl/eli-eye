// Toolbar glyphs, drawn to match the macOS originals' proportions.

const svg = (vb, body) =>
  `<svg viewBox="${vb}" aria-hidden="true" fill="currentColor">${body}</svg>`;

export const ICONS = {
  fourUp: svg('0 0 24 18',
    '<rect x="1" y="1" width="10" height="7" rx="1.2"/><rect x="13" y="1" width="10" height="7" rx="1.2"/>' +
    '<rect x="1" y="10" width="10" height="7" rx="1.2"/><rect x="13" y="10" width="10" height="7" rx="1.2"/>'),
  single: svg('0 0 24 18', '<rect x="2" y="1.5" width="20" height="15" rx="1.8"/>'),
  video: svg('0 0 26 18',
    '<rect x="1" y="2.5" width="16" height="13" rx="2.2"/><path d="M18.5 7.4 25 3.6v10.8l-6.5-3.8z"/>'),
  camera: svg('0 0 28 22',
    '<path d="M9.6 2.2c.3-.8 1-1.2 1.8-1.2h5.2c.8 0 1.5.4 1.8 1.2l.8 1.8H24a3 3 0 0 1 3 3V18a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4.8z"/>' +
    '<circle cx="14" cy="12.2" r="5.6" fill="var(--glyph-cut)"/><circle cx="14" cy="12.2" r="3.9"/>'),
  videoGlyph: svg('0 0 28 20',
    '<rect x="1" y="2" width="18" height="16" rx="3"/><path d="M20.5 7.6 27 3.8v12.4l-6.5-3.8z"/>'),
  stop: svg('0 0 20 20', '<rect x="3" y="3" width="14" height="14" rx="2.5"/>'),
  share: svg('0 0 20 24',
    '<path d="M10 1.2 5.6 5.6l1.3 1.3 2.2-2.2v10.5h1.8V4.7l2.2 2.2 1.3-1.3z"/>' +
    '<path d="M6.5 9H3.8A1.8 1.8 0 0 0 2 10.8v10.4A1.8 1.8 0 0 0 3.8 23h12.4a1.8 1.8 0 0 0 1.8-1.8V10.8A1.8 1.8 0 0 0 16.2 9h-2.7v1.8h2.7v10.4H3.8V10.8h2.7z"/>'),
  live: svg('0 0 28 22',
    '<path d="M9.6 2.2c.3-.8 1-1.2 1.8-1.2h5.2c.8 0 1.5.4 1.8 1.2l.8 1.8H24a3 3 0 0 1 3 3V18a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4.8z"/>' +
    '<circle cx="14" cy="12.2" r="5.6" fill="var(--glyph-cut)"/><circle cx="14" cy="12.2" r="3.9"/>'),
  left: svg('0 0 10 16', '<path d="M7.6 1.4 1.9 8l5.7 6.6 1.3-1.1L4.2 8l4.7-5.5z"/>'),
  right: svg('0 0 10 16', '<path d="M2.4 1.4 8.1 8l-5.7 6.6-1.3-1.1L5.8 8 1.1 2.5z"/>'),
  badgeVideo: svg('0 0 26 18',
    '<rect x="1" y="2.5" width="16" height="13" rx="2.2"/><path d="M18.5 7.4 25 3.6v10.8l-6.5-3.8z"/>'),
  noCamera: svg('0 0 64 52',
    '<path d="M22 4.6C22.7 3 24.2 2 26 2h12c1.8 0 3.3 1 4 2.6L43.8 9H55a7 7 0 0 1 7 7v27a7 7 0 0 1-7 7H9a7 7 0 0 1-7-7V16a7 7 0 0 1 7-7h11.2z" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<circle cx="32" cy="28.5" r="11" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M6 46 58 6" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>'),
};
