(() => {
  'use strict';

  const commons = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1280`;
  const vehicles = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'];
  const routes = [
    {
      id: 'a686-hartside', name: 'Hartside Pass', region: 'Cumbria & Northumberland', road: 'A686 · Penrith to Haydon Bridge',
      distance: 37, minutes: 70, difficulty: 'Challenging', vehicles,
      description: 'A high Pennine crossing with long sightlines, sweeping bends and a memorable descent into the South Tyne valley.',
      note: 'A motorbike-first A-road ride. Smaller bikes and scooters can use it without a motorway, but should allow extra climbing time.',
      highlights: ['Hartside summit', 'Alston', 'South Tyne valley'],
      safety: ['Exposed summit weather changes quickly.', 'Ice and winter closures can affect the Alston section.'],
      start: [54.6641, -2.7527], end: [54.974, -2.2472], waypoints: [[54.8128, -2.4393]],
      image: commons('The A686 below Hartside - geograph.org.uk - 1073084.jpg'), alt: 'The A686 below Hartside summit',
      credit: 'Andrew Smith · CC BY-SA 2.0', source: 'https://commons.wikimedia.org/wiki/File:The_A686_below_Hartside_-_geograph.org.uk_-_1073084.jpg',
      license: 'https://creativecommons.org/licenses/by-sa/2.0/',
      conditions: 'https://one.network/uk', routeSource: 'https://www.adventurebikerider.com/abrs-weekend-ride-crossing-the-pennines-on-the-a686/',
    },
    {
      id: 'a82-glencoe', name: 'Glencoe Run', region: 'Scottish Highlands', road: 'A82 · Tyndrum to Glencoe',
      distance: 35, minutes: 55, difficulty: 'Moderate', vehicles,
      description: 'A dramatic Highland run past Rannoch Moor and the mountains guarding Glencoe.',
      note: 'An approachable surfaced A-road for road bikes of every capacity, with exposed weather and tourist traffic to respect.',
      highlights: ['Rannoch Moor', 'Buachaille Etive Mòr', 'Glencoe'],
      safety: ['Expect fast weather changes and crosswinds.', 'Viewpoint traffic can be heavy in peak season.'],
      start: [56.4343, -4.7148], end: [56.6826, -5.1023], waypoints: [[56.6466, -4.8378]],
      image: commons('A82 towards Glencoe - geograph.org.uk - 3149881.jpg'), alt: 'The A82 heading towards Glencoe',
      credit: 'N Chadwick · CC BY-SA 2.0', source: 'https://commons.wikimedia.org/wiki/File:A82_towards_Glencoe_-_geograph.org.uk_-_3149881.jpg',
      license: 'https://creativecommons.org/licenses/by-sa/2.0/',
      conditions: 'https://www.traffic.gov.scot/', routeSource: 'https://www.seelochlomond.co.uk/discover/a82-loch-lomond-road-trip',
    },
    {
      id: 'snowroads', name: 'SnowRoads', region: 'Cairngorms National Park', road: 'A93, A939 & A940',
      distance: 90, minutes: 180, difficulty: 'Challenging', vehicles,
      description: 'Britain’s highest public roads through Glenshee, Braemar, Ballater and Tomintoul.',
      note: 'An unhurried full-day motorcycle route. Smaller bikes work well when fuel range, weather and daylight are planned carefully.',
      highlights: ['Glenshee', 'Braemar', 'Lecht Road', 'Tomintoul'],
      safety: ['Snow gates and winter closures are possible.', 'Fuel stops are widely spaced.'],
      start: [56.5916, -3.34], end: [57.3297, -3.608], waypoints: [[57.0065, -3.3962], [57.0491, -3.04], [57.252, -3.377]],
      image: commons('Cairngorms National Park road (Unsplash).jpg'), alt: 'A mountain road through Cairngorms National Park',
      credit: 'Milada Vigerova · CC0 1.0', source: 'https://commons.wikimedia.org/wiki/File:Cairngorms_National_Park_road_(Unsplash).jpg',
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      conditions: 'https://www.traffic.gov.scot/', routeSource: 'https://www.visitcairngorms.com/inspire-me/snowroads/',
    },
    {
      id: 'a470-mid-wales', name: 'Cambrian Spine', region: 'Mid Wales', road: 'A470 · Brecon to Dolgellau',
      distance: 88, minutes: 135, difficulty: 'Moderate', vehicles,
      description: 'A cross-country ride through reservoirs, open moorland and the mountain approaches to Eryri.',
      note: 'Continuous A-road touring without motorways. Suitable for 125cc machines when distance and faster overtaking traffic are planned for.',
      highlights: ['Bannau Brycheiniog', 'Rhayader', 'Bwlch Oerddrws'],
      safety: ['Watch for livestock, damp bends and changing visibility.', 'Times are planning estimates.'],
      start: [51.946, -3.391], end: [52.742, -3.886], waypoints: [[52.149, -3.404], [52.299, -3.511], [52.724, -3.685]],
      image: commons('A470 at Bwlch Oerddrws.jpg'), alt: 'The A470 at Bwlch Oerddrws',
      credit: 'Martin Bodman · CC BY-SA 2.0', source: 'https://commons.wikimedia.org/wiki/File:A470_at_Bwlch_Oerddrws.jpg',
      license: 'https://creativecommons.org/licenses/by-sa/2.0/',
      conditions: 'https://traffic.wales/', routeSource: 'https://en.wikipedia.org/wiki/A470_road',
    },
    {
      id: 'causeway-coast', name: 'Causeway Coast', region: 'County Antrim', road: 'A2 · Belfast to Derry/Londonderry',
      distance: 120, minutes: 210, difficulty: 'Moderate', vehicles,
      description: 'A full coastal journey through glens, beaches and the Giant’s Causeway landscape.',
      note: 'The main A2 corridor suits road motorcycles and scooters; this overview deliberately excludes the tighter Torr Head detour.',
      highlights: ['Glens of Antrim', 'Ballycastle', 'Giant’s Causeway'],
      safety: ['Coastal wind, spray and tourist traffic can slow progress.', 'Plan this as a full-day ride.'],
      start: [54.5973, -5.9301], end: [54.9966, -7.3086], waypoints: [[54.857, -5.811], [55.205, -6.249], [55.204, -6.523]],
      image: commons('Causeway Coastal Route, Dunseverick - geograph.org.uk - 5572416.jpg'), alt: 'Causeway Coastal Route at Dunseverick',
      credit: 'David Dixon · CC BY-SA 2.0', source: 'https://commons.wikimedia.org/wiki/File:Causeway_Coastal_Route,_Dunseverick_-_geograph.org.uk_-_5572416.jpg',
      license: 'https://creativecommons.org/licenses/by-sa/2.0/',
      conditions: 'https://www.trafficwatchni.com/', routeSource: 'https://discovernorthernireland.com/destinations/causeway-coastal-route/getting-here/',
    },
    {
      id: 'a466-wye-valley', name: 'Wye Valley Sweep', region: 'Monmouthshire', road: 'A466 · Monmouth to Chepstow',
      distance: 19, minutes: 40, difficulty: 'Easy', vehicles,
      description: 'A compact riverside ride through wooded gorge scenery, Tintern and the lower Wye Valley.',
      note: 'A lower-speed first scenic ride for 125cc riders and scooters that remains enjoyable on larger bikes.',
      highlights: ['Wye gorge', 'Tintern Abbey', 'Chepstow'],
      safety: ['Expect cyclists and slow traffic near Tintern.', 'Wooded bends can remain damp after rain.'],
      start: [51.8126, -2.7158], end: [51.6419, -2.6756], waypoints: [[51.697, -2.681]],
      image: commons('A466 Wye valley road - geograph.org.uk - 1402565.jpg'), alt: 'The A466 following the Wye Valley',
      credit: 'Jonathan Billinger · CC BY-SA 2.0', source: 'https://commons.wikimedia.org/wiki/File:A466_Wye_valley_road_-_geograph.org.uk_-_1402565.jpg',
      license: 'https://creativecommons.org/licenses/by-sa/2.0/',
      conditions: 'https://traffic.wales/', routeSource: 'https://www.visitwales.com/destinations/south-wales/wye-valley-and-vale-usk/must-do-wye-valley-and-vale-usk',
    },
  ];

  const labels = { all: 'All bikes', motorcycle_small: '125cc & small', motorcycle_large: 'Larger bikes', scooter: 'Scooters' };
  let filter = 'all';
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const mapsUrl = (route) => {
    const params = new URLSearchParams({ api: '1', origin: route.start.join(','), destination: route.end.join(','), travelmode: 'driving' });
    if (route.waypoints.length) params.set('waypoints', route.waypoints.map((point) => point.join(',')).join('|'));
    return `https://www.google.com/maps/dir/?${params}`;
  };

  function prepareLayout() {
    const mount = document.querySelector('#curatedRoutesMount');
    if (!mount || document.querySelector('#curatedRouteList')) return Boolean(document.querySelector('#curatedRouteList'));

    const featuredHeading = document.createElement('div');
    featuredHeading.className = 'section-heading routes-featured-heading';
    featuredHeading.innerHTML = '<div><span class="eyebrow">Curated for riders</span><h2>Featured rides</h2></div><span class="routes-count">6 UK routes</span>';
    const filters = document.createElement('div');
    filters.id = 'curatedRouteFilters';
    filters.className = 'chip-row';
    filters.setAttribute('aria-label', 'Filter editorial routes');
    const list = document.createElement('div');
    list.id = 'curatedRouteList';
    list.className = 'curated-route-list';
    list.setAttribute('aria-live', 'polite');
    mount.append(featuredHeading, filters, list);
    return true;
  }

  function renderFilters() {
    const root = document.querySelector('#curatedRouteFilters');
    if (!root) return;
    root.innerHTML = Object.entries(labels).map(([key, label]) => `<button class="chip${filter === key ? ' active' : ''}" data-curated-filter="${key}">${label}</button>`).join('');
    root.querySelectorAll('[data-curated-filter]').forEach((button) => button.addEventListener('click', () => {
      filter = button.dataset.curatedFilter;
      renderFilters();
      renderRoutes();
    }));
  }

  function renderRoutes() {
    const root = document.querySelector('#curatedRouteList');
    if (!root) return;
    const visible = filter === 'all' ? routes : routes.filter((route) => route.vehicles.includes(filter));
    root.innerHTML = visible.map((route) => `<button class="curated-route-card" data-curated-route="${route.id}" aria-label="View ${escapeHtml(route.name)} route overview">
      <img src="${route.image}" alt="${escapeHtml(route.alt)}" loading="lazy" referrerpolicy="no-referrer">
      <span class="route-photo-fallback" aria-hidden="true"><svg><use href="#i-route"/></svg></span>
      <span class="curated-route-overlay"><span class="route-region">${escapeHtml(route.region)}</span><strong>${escapeHtml(route.name)}</strong><small>${escapeHtml(route.road)}</small><span class="route-quick-stats"><b>${route.distance} mi</b><b>${Math.round(route.minutes / 15) * 15} min</b><b>${route.difficulty}</b></span></span>
    </button>`).join('');
    root.querySelectorAll('img').forEach((image) => image.addEventListener('error', () => image.closest('.curated-route-card')?.classList.add('image-failed'), { once: true }));
    root.querySelectorAll('[data-curated-route]').forEach((button) => button.addEventListener('click', () => openRoute(button.dataset.curatedRoute)));
  }

  function openRoute(id) {
    const route = routes.find((item) => item.id === id);
    if (!route) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'route-detail-backdrop';
    backdrop.innerHTML = `<section class="route-detail" role="dialog" aria-modal="true" aria-labelledby="routeDetailTitle">
      <div class="route-detail-photo"><img src="${route.image}" alt="${escapeHtml(route.alt)}"><button class="icon-button route-detail-close" aria-label="Close route overview">×</button><div><span>${escapeHtml(route.region)}</span><h2 id="routeDetailTitle">${escapeHtml(route.name)}</h2><p>${escapeHtml(route.road)}</p></div></div>
      <div class="route-detail-body"><div class="route-detail-stats"><span><b>${route.distance}</b> miles</span><span><b>${Math.round(route.minutes / 15) * 15}</b> minutes</span><span><b>${route.difficulty}</b> ride</span></div>
      <p>${escapeHtml(route.description)}</p><div class="rider-note"><strong>Rider note</strong><p>${escapeHtml(route.note)}</p></div>
      <div><h3>Highlights</h3><div class="badge-row">${route.highlights.map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join('')}</div></div>
      <div class="safety-box"><svg><use href="#i-shield"/></svg><div><strong>Before you ride</strong>${route.safety.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div></div>
      <a class="button primary wide" href="${mapsUrl(route)}" target="_blank" rel="noopener">Open route in Maps</a>
      <div class="route-links"><a href="${route.conditions}" target="_blank" rel="noopener">Live conditions</a><a href="${route.routeSource}" target="_blank" rel="noopener">Route source</a><a href="${route.source}" target="_blank" rel="noopener">Photo: ${escapeHtml(route.credit)}</a><a href="${route.license}" target="_blank" rel="noopener">Photo licence</a></div>
      <p class="caption">Distance and time are planning estimates. Follow live road signs, restrictions and navigation guidance.</p></div>
    </section>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('.route-detail-close').addEventListener('click', close);
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector('.route-detail-close').focus();
  }

  function init() {
    if (!prepareLayout()) return;
    renderFilters();
    renderRoutes();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
