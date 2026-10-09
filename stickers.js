// Original campus sticker pack (SVG, generated in the browser — no external files).
window.STICKERS = (() => {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // badge-style die-cut sticker: coloured blob + big glyph + caption ribbon
  function badge({ bg, bg2, glyph, caption, rot = -6, ink = '#fff', ribbon = '#1b1b1b', extra = '' }) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".28"/></filter></defs>
<g transform="rotate(${rot} 80 80)" filter="url(#s)">
<path d="M80 10 C120 8 150 36 150 76 C152 118 122 150 80 150 C38 152 10 120 10 78 C8 38 40 12 80 10Z" fill="url(#g)" stroke="#fff" stroke-width="7"/>
${extra}
<text x="80" y="92" font-size="62" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${glyph}</text>
<g transform="rotate(${-rot / 2} 80 128)"><rect x="14" y="110" width="132" height="32" rx="9" fill="${ribbon}" stroke="#fff" stroke-width="4"/>
<text x="80" y="132" font-size="${caption.length > 14 ? 13 : 16}" font-weight="800" text-anchor="middle" fill="${ink}" font-family="Plus Jakarta Sans,Segoe UI,Arial,sans-serif" letter-spacing=".3">${esc(caption)}</text></g>
</g></svg>`;
  }
  const mountain = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0f3"/><stop offset="1" stop-color="#ffe7c2"/></linearGradient>
<filter id="s"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".28"/></filter><clipPath id="c"><rect x="14" y="14" width="132" height="132" rx="30"/></clipPath></defs>
<g transform="rotate(-5 80 80)" filter="url(#s)"><rect x="14" y="14" width="132" height="132" rx="30" fill="url(#sky)" stroke="#fff" stroke-width="7"/>
<g clip-path="url(#c)"><circle cx="112" cy="48" r="14" fill="#ffc94d"/>
<path d="M0 120 L40 62 L62 92 L92 44 L146 120Z" fill="#7c97b3"/><path d="M92 44 L80 62 L90 58 L97 66 L104 58Z" fill="#fff"/><path d="M40 62 L32 74 L41 70 L48 76Z" fill="#fff"/>
<path d="M0 126 C40 108 80 128 160 110 V160 H0Z" fill="#3f7a57"/><path d="M0 140 C50 128 100 146 160 132" stroke="#7cc6e6" stroke-width="6" fill="none"/>
<path d="M28 118 l8 -16 l8 16z M120 114 l7 -14 l7 14z" fill="#1e4434"/></g>
<rect x="22" y="104" width="116" height="30" rx="9" fill="#1e4434" stroke="#fff" stroke-width="4" transform="rotate(4 80 119)"/>
<text x="80" y="125" font-size="13" font-weight="800" text-anchor="middle" fill="#fff" font-family="Plus Jakarta Sans,Segoe UI,Arial,sans-serif" transform="rotate(4 80 119)">KAMAND VIBES</text></g></svg>`;

  const list = [
    { id: 'mountain', name: 'Kamand vibes', svg: mountain },
    { id: 'chai', name: 'Chai break', svg: badge({ bg: '#f7b267', bg2: '#d9732f', glyph: '☕', caption: 'CHAI BREAK?', ribbon: '#5a2d0c' }) },
    { id: 'maggi', name: 'Maggi time', svg: badge({ bg: '#ffe066', bg2: '#f4b400', glyph: '🍜', caption: 'MAGGI @ 2AM', ribbon: '#b23a1d', rot: 5 }) },
    { id: 'deadline', name: 'Deadline', svg: badge({ bg: '#ff8a80', bg2: '#d63031', glyph: '⏰', caption: 'DEADLINE IN 1 HR', ribbon: '#2d0b0b' }) },
    { id: 'mess', name: 'Mess food again', svg: badge({ bg: '#c5e1a5', bg2: '#7cb342', glyph: '🍛', caption: 'MESS FOOD AGAIN', ribbon: '#33521a', rot: 4 }) },
    { id: 'exam', name: 'Exam szn', svg: badge({ bg: '#b39ddb', bg2: '#673ab7', glyph: '📚', caption: 'EXAM SZN', ribbon: '#2a1550' }) },
    { id: 'sleep', name: '8am class', svg: badge({ bg: '#90caf9', bg2: '#3f51b5', glyph: '😴', caption: '8 AM CLASS??', ribbon: '#141a4a', rot: 6 }) },
    { id: 'bus', name: 'Bus to Mandi', svg: badge({ bg: '#ffd54f', bg2: '#ff9800', glyph: '🚌', caption: 'BUS TO MANDI', ribbon: '#3b2600', rot: -4 }) },
    { id: 'rain', name: 'Raining again', svg: badge({ bg: '#b0bec5', bg2: '#546e7a', glyph: '🌧️', caption: 'RAINING AGAIN', ribbon: '#1c2a31' }) },
    { id: 'monkey', name: 'Monkey alert', svg: badge({ bg: '#d7b98e', bg2: '#8d6e63', glyph: '🐒', caption: 'MONKEY ALERT!', ribbon: '#c62828', rot: 5 }) },
    { id: 'party', name: "Let's gooo", svg: badge({ bg: '#f48fb1', bg2: '#ab47bc', glyph: '🎉', caption: "LET'S GOOO", ribbon: '#3d0b3d', rot: -7 }) },
    { id: 'code', name: 'Works on my machine', svg: badge({ bg: '#80cbc4', bg2: '#00796b', glyph: '💻', caption: 'WORKS ON MY PC', ribbon: '#002b26', rot: 3 }) },
    { id: 'goal', name: 'Goal', svg: badge({ bg: '#a5d6a7', bg2: '#2e7d32', glyph: '⚽', caption: 'GOOOAL!', ribbon: '#0d2b0f', rot: -5 }) },
    { id: 'gg', name: 'GG', svg: badge({ bg: '#ffe082', bg2: '#ffb300', glyph: '🏆', caption: 'GG WP', ribbon: '#4a3200', rot: 6 }) },
    { id: 'lgtm', name: 'LGTM', svg: badge({ bg: '#c8e6c9', bg2: '#43a047', glyph: '✅', caption: 'LGTM', ribbon: '#1b3d1c', rot: -3 }) },
    { id: 'thanks', name: 'Thank you', svg: badge({ bg: '#ffccbc', bg2: '#ff7043', glyph: '🙏', caption: 'THANK YOU!', ribbon: '#4a1a0a', rot: 4 }) },
  ];
  const url = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const byId = Object.fromEntries(list.map((s) => [s.id, { ...s, url: url(s.svg) }]));
  return { list: list.map((s) => byId[s.id]), byId };
})();
