// Section icons: one line style (24 grid, 1.8 stroke) on a small tinted tile, coloured by topic so a section
// can be found at a glance: heat for the Pacific and temperature, dry for dry stages and drought, water for rain
// and reservoirs, teal for everything general.
const P = {
  hourglass: '<path d="M7 3.5h10M7 20.5h10"/><path d="M8 3.5c0 4.2 4 5.2 4 8.5s-4 4.3-4 8.5M16 3.5c0 4.2-4 5.2-4 8.5s4 4.3 4 8.5"/><path d="M10 18.5h4"/>',
  shield: '<path d="M12 3.5l7 2.6v5.3c0 4.4-3 7.8-7 9.1-4-1.3-7-4.7-7-9.1V6.1z"/><path d="M8.9 12.1l2.2 2.2 4.1-4.4"/>',
  drop: '<path d="M12 3.5c3.5 4.2 6 7.4 6 10.5a6 6 0 01-12 0c0-3.1 2.5-6.3 6-10.5z"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="3"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  waves: '<path d="M3 8c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0M3 13c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0M3 18c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.7v.3"/>',
  thermo: '<path d="M10 14.3V5.5a2 2 0 014 0v8.8a4 4 0 11-4 0z"/><path d="M12 9.5v7"/>',
  rain: '<path d="M7.2 14.5h10.3a3.8 3.8 0 00.3-7.6 5.6 5.6 0 00-10.8 1.6 3 3 0 00.2 6z"/><path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>',
  gauge: '<path d="M4.3 17a8.2 8.2 0 1115.4 0"/><path d="M12 16.5l3.8-5.2"/><circle cx="12" cy="16.5" r="1.1"/>',
  mountain: '<path d="M3 19l6-9 4 5 3-4 5 8z"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.2 4 2.2 4H5.5"/>',
};

// A burning flame for active fires: three tongues that flicker at different rates over a pulsing ground glow
// (css/brief.css). Its base sits at the bottom centre. Solid fills, no gradient ids, so many can share a page.
export const flame = () => '<svg class="flame" viewBox="0 0 24 28" aria-hidden="true"><ellipse class="fl-g" cx="12" cy="24.2" rx="7.5" ry="2.4"/>'
  + '<path class="fl-o" d="M12 1c1.6 4.6 7.4 8.5 7.4 15.6A7.4 7.4 0 0 1 4.6 16.6c0-3.7 1.9-6.2 3.8-8.3.3 2.5 1.4 3.9 2.6 4.4C11.2 9.4 11 5.2 12 1z"/>'
  + '<path class="fl-m" d="M12.3 8.6c1 3 4.4 5.4 4.4 9.8a4.7 4.7 0 0 1-9.4 0c0-2.3 1.1-3.9 2.4-5.2.2 1.5.9 2.4 1.7 2.8-.1-2.5.3-4.8.9-7.4z"/>'
  + '<path class="fl-i" d="M12 14.6c.6 1.7 2.7 3.1 2.7 5.7a2.7 2.7 0 0 1-5.4 0c0-1.4.7-2.4 1.5-3.2.1.9.5 1.4 1 1.7-.1-1.5.1-2.8.2-4.2z"/></svg>';

// <span class="hico t-dry">…</span>; tone is heat, dry, water or teal
export function hico(name, tone = 'teal') {
  const p = P[name];
  return p ? `<span class="hico t-${tone}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg></span>` : '';
}
