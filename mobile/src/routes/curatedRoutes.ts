import type { Difficulty, RoadType, VehicleCategory } from '@rider-comms/shared';

export interface RouteCoordinate {
  lat: number;
  lon: number;
  label: string;
}

export interface RouteImageCredit {
  uri: string;
  alt: string;
  author: string;
  licenseName: 'CC0 1.0' | 'CC BY-SA 2.0' | 'CC BY-SA 3.0';
  licenseUrl: string;
  sourceUrl: string;
}

export interface CuratedRoute {
  id: string;
  name: string;
  region: string;
  road: string;
  description: string;
  riderNote: string;
  vehicleSuitability: VehicleCategory[];
  roadType: RoadType;
  distanceMiles: number;
  estimatedDurationMinutes: number;
  difficulty: Difficulty;
  highlights: string[];
  safetyNotices: string[];
  start: RouteCoordinate;
  end: RouteCoordinate;
  waypoints: RouteCoordinate[];
  routeSourceUrl: string;
  conditionsUrl: string;
  reviewedAt: string;
  image: RouteImageCredit;
}

const commonsImage = (filename: string): string =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=1280`;

const allRoadVehicles: VehicleCategory[] = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'];

/**
 * Editorial launch catalogue. Route timings are planning estimates, not live
 * navigation. Every image has a source and reusable licence recorded alongside
 * it; see ROUTE_IMAGE_LICENSES.md before changing or redistributing the media.
 */
export const CURATED_ROUTES: readonly CuratedRoute[] = [
  {
    id: 'a686-hartside',
    name: 'Hartside Pass',
    region: 'Cumbria & Northumberland',
    road: 'A686 · Penrith to Haydon Bridge',
    description: 'A high Pennine crossing with long sightlines, sweeping bends and a memorable descent into the South Tyne valley.',
    riderNote: 'A motorbike-first day ride on public A-roads. Smaller bikes and scooters can use the route without a motorway, but should allow extra climbing time.',
    vehicleSuitability: allRoadVehicles,
    roadType: 'mountain',
    distanceMiles: 37,
    estimatedDurationMinutes: 70,
    difficulty: 'challenging',
    highlights: ['Hartside summit', 'South Tyne valley', 'Alston stop'],
    safetyNotices: ['Exposed summit weather can change quickly.', 'Ice and winter gritting limitations can affect the Alston section.', 'Check closures and conditions before setting off.'],
    start: { lat: 54.6641, lon: -2.7527, label: 'Penrith' },
    end: { lat: 54.974, lon: -2.2472, label: 'Haydon Bridge' },
    waypoints: [{ lat: 54.8128, lon: -2.4393, label: 'Alston' }],
    routeSourceUrl: 'https://www.adventurebikerider.com/abrs-weekend-ride-crossing-the-pennines-on-the-a686/',
    conditionsUrl: 'https://one.network/uk',
    reviewedAt: '2026-09-15',
    image: {
      uri: commonsImage('The A686 below Hartside - geograph.org.uk - 1073084.jpg'),
      alt: 'The A686 descending below Hartside summit',
      author: 'Andrew Smith',
      licenseName: 'CC BY-SA 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:The_A686_below_Hartside_-_geograph.org.uk_-_1073084.jpg',
    },
  },
  {
    id: 'a82-glencoe',
    name: 'Glencoe Run',
    region: 'Scottish Highlands',
    road: 'A82 · Tyndrum to Glencoe',
    description: 'A dramatic Highland run past Rannoch Moor and the mountains guarding Glencoe.',
    riderNote: 'Wide, surfaced A-road riding with no motorway required. It is approachable on smaller road bikes, while exposed weather and tourist traffic still demand care.',
    vehicleSuitability: allRoadVehicles,
    roadType: 'mountain',
    distanceMiles: 35,
    estimatedDurationMinutes: 55,
    difficulty: 'moderate',
    highlights: ['Rannoch Moor', 'Buachaille Etive Mòr', 'Glencoe'],
    safetyNotices: ['Expect fast weather changes and strong crosswinds.', 'Traffic can be heavy at viewpoints and in peak season.', 'Check Traffic Scotland before departure.'],
    start: { lat: 56.4343, lon: -4.7148, label: 'Tyndrum' },
    end: { lat: 56.6826, lon: -5.1023, label: 'Glencoe' },
    waypoints: [{ lat: 56.6466, lon: -4.8378, label: 'Rannoch Moor' }],
    routeSourceUrl: 'https://www.seelochlomond.co.uk/discover/a82-loch-lomond-road-trip',
    conditionsUrl: 'https://www.traffic.gov.scot/',
    reviewedAt: '2026-09-15',
    image: {
      uri: commonsImage('A82 towards Glencoe - geograph.org.uk - 3149881.jpg'),
      alt: 'The A82 heading towards Glencoe',
      author: 'N Chadwick',
      licenseName: 'CC BY-SA 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:A82_towards_Glencoe_-_geograph.org.uk_-_3149881.jpg',
    },
  },
  {
    id: 'snowroads',
    name: 'SnowRoads',
    region: 'Cairngorms National Park',
    road: 'A93, A939 & A940 · Blairgowrie to Grantown-on-Spey',
    description: 'Ninety miles across Britain’s highest public roads, linking Glenshee, Braemar, Ballater and Tomintoul.',
    riderNote: 'Built for an unhurried motorcycle day. The route avoids motorways and is viable on smaller-capacity road bikes when weather, range and daylight are planned carefully.',
    vehicleSuitability: allRoadVehicles,
    roadType: 'mountain',
    distanceMiles: 90,
    estimatedDurationMinutes: 180,
    difficulty: 'challenging',
    highlights: ['Glenshee', 'Braemar', 'Lecht Road', 'Tomintoul'],
    safetyNotices: ['Snow gates and winter closures are possible.', 'Fuel stops are widely spaced; plan range before riding.', 'Allow a full day and check Highland conditions.'],
    start: { lat: 56.5916, lon: -3.34, label: 'Blairgowrie' },
    end: { lat: 57.3297, lon: -3.608, label: 'Grantown-on-Spey' },
    waypoints: [
      { lat: 57.0065, lon: -3.3962, label: 'Braemar' },
      { lat: 57.0491, lon: -3.04, label: 'Ballater' },
      { lat: 57.252, lon: -3.377, label: 'Tomintoul' },
    ],
    routeSourceUrl: 'https://www.visitcairngorms.com/inspire-me/snowroads/',
    conditionsUrl: 'https://www.traffic.gov.scot/',
    reviewedAt: '2026-09-15',
    image: {
      uri: commonsImage('Cairngorms National Park road (Unsplash).jpg'),
      alt: 'A mountain road through Cairngorms National Park',
      author: 'Milada Vigerova',
      licenseName: 'CC0 1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cairngorms_National_Park_road_(Unsplash).jpg',
    },
  },
  {
    id: 'a470-mid-wales',
    name: 'Cambrian Spine',
    region: 'Mid Wales',
    road: 'A470 · Brecon to Dolgellau',
    description: 'A long cross-country section through reservoirs, open moorland and the mountain approaches to Eryri.',
    riderNote: 'A motorbike-led touring route on continuous A-road. It avoids motorways and works for 125cc machines if the longer distance and overtaking traffic are planned for.',
    vehicleSuitability: allRoadVehicles,
    roadType: 'mixed',
    distanceMiles: 88,
    estimatedDurationMinutes: 135,
    difficulty: 'moderate',
    highlights: ['Bannau Brycheiniog', 'Rhayader', 'Bwlch Oerddrws'],
    safetyNotices: ['Distances and times are planning estimates.', 'Watch for livestock, damp bends and changing mountain visibility.', 'Check Traffic Wales for incidents and closures.'],
    start: { lat: 51.946, lon: -3.391, label: 'Brecon' },
    end: { lat: 52.742, lon: -3.886, label: 'Dolgellau' },
    waypoints: [
      { lat: 52.149, lon: -3.404, label: 'Builth Wells' },
      { lat: 52.299, lon: -3.511, label: 'Rhayader' },
      { lat: 52.724, lon: -3.685, label: 'Dinas Mawddwy' },
    ],
    routeSourceUrl: 'https://en.wikipedia.org/wiki/A470_road',
    conditionsUrl: 'https://traffic.wales/',
    reviewedAt: '2026-09-15',
    image: {
      uri: commonsImage('A470 at Bwlch Oerddrws.jpg'),
      alt: 'The A470 at Bwlch Oerddrws looking towards Dolgellau',
      author: 'Martin Bodman',
      licenseName: 'CC BY-SA 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:A470_at_Bwlch_Oerddrws.jpg',
    },
  },
  {
    id: 'causeway-coast',
    name: 'Causeway Coast',
    region: 'County Antrim, Northern Ireland',
    road: 'A2 · Belfast to Derry/Londonderry',
    description: 'A full coastal journey through glens, cliff-backed beaches and the basalt landscape around the Giant’s Causeway.',
    riderNote: 'The main signed A2 corridor suits road motorcycles and scooters; this overview intentionally excludes the tighter Torr Head detour.',
    vehicleSuitability: allRoadVehicles,
    roadType: 'coastal',
    distanceMiles: 120,
    estimatedDurationMinutes: 210,
    difficulty: 'moderate',
    highlights: ['Glens of Antrim', 'Ballycastle', 'Giant’s Causeway'],
    safetyNotices: ['Coastal winds, spray and tourist traffic can slow progress.', 'Treat the route as a full-day ride with planned stops.', 'Check Trafficwatch NI before leaving.'],
    start: { lat: 54.5973, lon: -5.9301, label: 'Belfast' },
    end: { lat: 54.9966, lon: -7.3086, label: 'Derry/Londonderry' },
    waypoints: [
      { lat: 54.857, lon: -5.811, label: 'Larne' },
      { lat: 55.205, lon: -6.249, label: 'Ballycastle' },
      { lat: 55.204, lon: -6.523, label: 'Bushmills' },
    ],
    routeSourceUrl: 'https://discovernorthernireland.com/destinations/causeway-coastal-route/getting-here/',
    conditionsUrl: 'https://www.trafficwatchni.com/',
    reviewedAt: '2026-09-15',
    image: {
      uri: commonsImage('Causeway Coastal Route, Dunseverick - geograph.org.uk - 5572416.jpg'),
      alt: 'The Causeway Coastal Route at Dunseverick',
      author: 'David Dixon',
      licenseName: 'CC BY-SA 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Causeway_Coastal_Route,_Dunseverick_-_geograph.org.uk_-_5572416.jpg',
    },
  },
  {
    id: 'a466-wye-valley',
    name: 'Wye Valley Sweep',
    region: 'Monmouthshire',
    road: 'A466 · Monmouth to Chepstow',
    description: 'A compact riverside ride through wooded gorge scenery, Tintern and the lower Wye Valley.',
    riderNote: 'A shorter, lower-speed option that makes a strong first scenic ride for 125cc riders and scooters while remaining enjoyable on larger bikes.',
    vehicleSuitability: allRoadVehicles,
    roadType: 'rural',
    distanceMiles: 19,
    estimatedDurationMinutes: 40,
    difficulty: 'easy',
    highlights: ['Wye gorge', 'Tintern Abbey', 'Chepstow'],
    safetyNotices: ['Expect cyclists, pedestrians and slow traffic near Tintern.', 'Wooded bends can remain damp after rain.', 'Check conditions and local restrictions before departure.'],
    start: { lat: 51.8126, lon: -2.7158, label: 'Monmouth' },
    end: { lat: 51.6419, lon: -2.6756, label: 'Chepstow' },
    waypoints: [{ lat: 51.697, lon: -2.681, label: 'Tintern' }],
    routeSourceUrl: 'https://www.visitwales.com/destinations/south-wales/wye-valley-and-vale-usk/must-do-wye-valley-and-vale-usk',
    conditionsUrl: 'https://traffic.wales/',
    reviewedAt: '2026-09-15',
    image: {
      uri: commonsImage('A466 Wye valley road - geograph.org.uk - 1402565.jpg'),
      alt: 'The A466 following the Wye Valley towards Chepstow',
      author: 'Jonathan Billinger',
      licenseName: 'CC BY-SA 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:A466_Wye_valley_road_-_geograph.org.uk_-_1402565.jpg',
    },
  },
];

export function routeMatchesVehicle(route: CuratedRoute, vehicle: VehicleCategory | null): boolean {
  return vehicle === null || route.vehicleSuitability.includes(vehicle);
}

export function googleMapsDirectionsUrl(route: CuratedRoute): string {
  const params = new URLSearchParams({
    api: '1',
    origin: `${route.start.lat},${route.start.lon}`,
    destination: `${route.end.lat},${route.end.lon}`,
    travelmode: 'driving',
  });
  if (route.waypoints.length > 0) {
    params.set('waypoints', route.waypoints.map(({ lat, lon }) => `${lat},${lon}`).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
