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

/**
 * Editorial UK motorcycle catalogue. Route timings are planning estimates,
 * not live navigation. Admission evidence and explicit deferrals live in
 * ROUTE_CATALOGUE_RESEARCH.md; image rights live in ROUTE_IMAGE_LICENSES.md.
 */
export const CURATED_ROUTES: readonly CuratedRoute[] = [
  {
    "id": "surrey-hills-circuit",
    "name": "Surrey Hills Circuit",
    "region": "Surrey Hills",
    "road": "A25 & Surrey lanes · Guildford circuit",
    "description": "A compact circuit through Newlands Corner, Shere, Box Hill and Leith Hill, linking some of the South East’s best-known viewpoints and villages.",
    "riderNote": "A useful ride-out from the London side of the country: varied enough to feel like a proper trip without needing a full day or a motorway-heavy approach.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "rural",
    "distanceMiles": 39,
    "estimatedDurationMinutes": 90,
    "difficulty": "moderate",
    "highlights": [
      "Newlands Corner",
      "Shere",
      "Box Hill",
      "Leith Hill"
    ],
    "safetyNotices": [
      "Expect cyclists, walkers and busy visitor traffic around Box Hill and the main viewpoints.",
      "Some linking lanes are narrow and shaded; allow for damp surfaces and limited sightlines.",
      "Ride time excludes stops and is a planning estimate."
    ],
    "start": {
      "lat": 51.2362,
      "lon": -0.5704,
      "label": "Guildford"
    },
    "end": {
      "lat": 51.2362,
      "lon": -0.5704,
      "label": "Guildford"
    },
    "waypoints": [
      {
        "lat": 51.2323,
        "lon": -0.5071,
        "label": "Newlands Corner"
      },
      {
        "lat": 51.2206,
        "lon": -0.4652,
        "label": "Shere"
      },
      {
        "lat": 51.2543,
        "lon": -0.3124,
        "label": "Box Hill"
      },
      {
        "lat": 51.1767,
        "lon": -0.3694,
        "label": "Leith Hill"
      }
    ],
    "routeSourceUrl": "https://www.visitsurrey.com/ideas-and-inspiration/itineraries/a-drive-through-the-surrey-hills/",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/2/27/A25_Shere_Road%2C_looking_towards_Sherbourne_Farm_-_geograph.org.uk_-_3794452.jpg",
      "alt": "The A25 Shere Road in the Surrey Hills",
      "author": "David Martin",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:A25_Shere_Road,_looking_towards_Sherbourne_Farm_-_geograph.org.uk_-_3794452.jpg"
    }
  },
  {
    "id": "a507-baldock-buntingford",
    "name": "A507 Hertfordshire Sweep",
    "region": "Hertfordshire",
    "road": "A507 · Baldock to Buntingford",
    "description": "A short South-East blast through open, undulating countryside, mixing long sweepers with tighter turns on the run towards Buntingford.",
    "riderNote": "Best treated as a compact road to enjoy smoothly rather than a destination epic. It is easy to pair with a longer Hertfordshire or Cambridgeshire ride.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "rural",
    "distanceMiles": 9,
    "estimatedDurationMinutes": 15,
    "difficulty": "easy",
    "highlights": [
      "Open sweepers",
      "Cottered countryside",
      "Easy London-side access"
    ],
    "safetyNotices": [
      "The route is popular with riders and can be actively policed; stay within posted limits.",
      "Watch for gravel and debris near junctions and field entrances.",
      "Traffic can interrupt the flow at busier times."
    ],
    "start": {
      "lat": 51.9896,
      "lon": -0.1887,
      "label": "Baldock"
    },
    "end": {
      "lat": 51.9444,
      "lon": -0.0162,
      "label": "Buntingford"
    },
    "waypoints": [
      {
        "lat": 51.9478,
        "lon": -0.044,
        "label": "A507 east of Cottered"
      }
    ],
    "routeSourceUrl": "https://www.bikestop.co.uk/blog/great-biking-roads-near-bike-stop",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/f/f5/A507_towards_Baldock_-_geograph.org.uk_-_3102113.jpg",
      "alt": "The A507 heading towards Baldock",
      "author": "JThomas",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:A507_towards_Baldock_-_geograph.org.uk_-_3102113.jpg"
    }
  },
  {
    "id": "b1145-norfolk",
    "name": "Norfolk B1145",
    "region": "Norfolk",
    "road": "B1145 · Bawdeswell to Gayton",
    "description": "Seventeen miles of flowing rural B-road through open Norfolk countryside, linking Bawdeswell, North Elmham, Litcham and Gayton.",
    "riderNote": "A rare East Anglia road that works for both bikes and nimble cars: less about elevation, more about rhythm, sightlines and linking bends while staying within the posted limits.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "rural",
    "distanceMiles": 17,
    "estimatedDurationMinutes": 35,
    "difficulty": "moderate",
    "highlights": [
      "Open Norfolk countryside",
      "North Elmham",
      "Litcham",
      "Flowing B-road bends"
    ],
    "safetyNotices": [
      "Agricultural traffic can leave mud or gravel on rural sections, particularly after wet weather.",
      "Expect village limits, side-road junctions and wildlife along the route; keep enough margin for hazards beyond open sightlines.",
      "Ride time is an editorial planning estimate and excludes stops."
    ],
    "start": {
      "lat": 52.7467,
      "lon": 1.0314,
      "label": "Bawdeswell"
    },
    "end": {
      "lat": 52.7441,
      "lon": 0.5571,
      "label": "Gayton"
    },
    "waypoints": [
      {
        "lat": 52.7485,
        "lon": 0.9393,
        "label": "North Elmham"
      },
      {
        "lat": 52.7258,
        "lon": 0.7876,
        "label": "Litcham"
      }
    ],
    "routeSourceUrl": "https://www.mslmagazine.co.uk/day-ride-norfolk-loop/",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/f/f3/Bend_on_the_B1145_west_of_Gayton%2C_Norfolk_-_geograph.org.uk_-_564445.jpg",
      "alt": "A bend on the B1145 west of Gayton in Norfolk",
      "author": "Robert Walden",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Bend_on_the_B1145_west_of_Gayton,_Norfolk_-_geograph.org.uk_-_564445.jpg"
    }
  },
  {
    "id": "a466-wye-valley",
    "name": "Wye Valley Sweep",
    "region": "Monmouthshire",
    "road": "A466 · Monmouth to Chepstow",
    "description": "A compact riverside ride through wooded gorge scenery, Tintern and the lower Wye Valley.",
    "riderNote": "A shorter, lower-speed option that makes a strong first scenic ride for 125cc riders and scooters while remaining enjoyable on larger bikes.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "rural",
    "distanceMiles": 19,
    "estimatedDurationMinutes": 40,
    "difficulty": "easy",
    "highlights": [
      "Wye gorge",
      "Tintern Abbey",
      "Chepstow"
    ],
    "safetyNotices": [
      "Expect cyclists, pedestrians and slow traffic near Tintern.",
      "Wooded bends can remain damp after rain.",
      "Check conditions and local restrictions before departure."
    ],
    "start": {
      "lat": 51.8126,
      "lon": -2.7158,
      "label": "Monmouth"
    },
    "end": {
      "lat": 51.6419,
      "lon": -2.6756,
      "label": "Chepstow"
    },
    "waypoints": [
      {
        "lat": 51.697,
        "lon": -2.681,
        "label": "Tintern"
      }
    ],
    "routeSourceUrl": "https://www.visitwales.com/destinations/south-wales/wye-valley-and-vale-usk/must-do-wye-valley-and-vale-usk",
    "conditionsUrl": "https://traffic.wales/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/9/9a/A466_Wye_valley_road_-_geograph.org.uk_-_1402565.jpg",
      "alt": "The A466 following the Wye Valley towards Chepstow",
      "author": "Jonathan Billinger",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:A466_Wye_valley_road_-_geograph.org.uk_-_1402565.jpg"
    }
  },
  {
    "id": "b3212-dartmoor",
    "name": "Dartmoor Crossing",
    "region": "Devon",
    "road": "B3212 · Exeter to Yelverton",
    "description": "Thirty-three miles from city edge to open moor, with long sweepers, big-sky views and the unmistakable high-Dartmoor section around Princetown.",
    "riderNote": "A strong half-day building block: the road is engaging without needing extreme gradients, and it can be linked naturally with a wider Devon ride.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "rural",
    "distanceMiles": 33,
    "estimatedDurationMinutes": 65,
    "difficulty": "moderate",
    "highlights": [
      "Open Dartmoor",
      "Moretonhampstead",
      "Princetown"
    ],
    "safetyNotices": [
      "The moor section carries a 40 mph limit in places because free-roaming animals can enter the road.",
      "Watch for ponies and sheep, especially around blind crests and verges.",
      "Fog, rain and exposure can change the character of the road quickly."
    ],
    "start": {
      "lat": 50.7256,
      "lon": -3.5269,
      "label": "Exeter"
    },
    "end": {
      "lat": 50.4923,
      "lon": -4.0832,
      "label": "Yelverton"
    },
    "waypoints": [
      {
        "lat": 50.6608,
        "lon": -3.765,
        "label": "Moretonhampstead"
      },
      {
        "lat": 50.5437,
        "lon": -3.9886,
        "label": "Princetown"
      }
    ],
    "routeSourceUrl": "https://www.adventurebikerider.com/article/uk-roads-to-ride-in-2021/",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/Princetown_%2C_Two_Bridges_Road_B3212_-_geograph.org.uk_-_5488011.jpg/1280px-Princetown_%2C_Two_Bridges_Road_B3212_-_geograph.org.uk_-_5488011.jpg",
      "alt": "The B3212 near Princetown on Dartmoor",
      "author": "Lewis Clarke",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Princetown_,_Two_Bridges_Road_B3212_-_geograph.org.uk_-_5488011.jpg"
    }
  },
  {
    "id": "b3306-west-cornwall",
    "name": "West Cornwall Coast Road",
    "region": "West Cornwall",
    "road": "B3306 · St Ives to St Just",
    "description": "A thirteen-mile coastal rollercoaster across exposed West Cornwall, passing moorland, sea views and the remains of the tin-mining landscape.",
    "riderNote": "Short enough to repeat, distinctive enough to travel for. The appeal is the rhythm and coastal setting rather than outright speed.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "coastal",
    "distanceMiles": 13,
    "estimatedDurationMinutes": 35,
    "difficulty": "moderate",
    "highlights": [
      "Zennor",
      "Atlantic views",
      "Tin-mining landscape"
    ],
    "safetyNotices": [
      "Peak-season traffic can be heavy around St Ives and the coast.",
      "The road is exposed to wind and weather.",
      "Allow for narrow sections, walkers and local traffic near settlements."
    ],
    "start": {
      "lat": 50.211,
      "lon": -5.4804,
      "label": "St Ives"
    },
    "end": {
      "lat": 50.1234,
      "lon": -5.6802,
      "label": "St Just"
    },
    "waypoints": [
      {
        "lat": 50.1919,
        "lon": -5.568,
        "label": "Zennor"
      }
    ],
    "routeSourceUrl": "https://www.visitcornwall.com/things-to-do/experiences/five-to-try-scenic-drives",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/07/B3306%2C_St_Ives_to_Zennor_road_-_geograph.org.uk_-_8249620.jpg/1280px-B3306%2C_St_Ives_to_Zennor_road_-_geograph.org.uk_-_8249620.jpg",
      "alt": "The B3306 between St Ives and Zennor",
      "author": "Richard Rogerson",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:B3306,_St_Ives_to_Zennor_road_-_geograph.org.uk_-_8249620.jpg"
    }
  },
  {
    "id": "a39-porlock-lynmouth",
    "name": "Exmoor Coast",
    "region": "Exmoor",
    "road": "A39 · Porlock to Lynmouth",
    "description": "A steep, dramatic Exmoor crossing that climbs hard out of Porlock before opening into faster coastal curves and the descent towards Lynmouth.",
    "riderNote": "This curated line stays on the public A39. It does not depend on the separate private Porlock Scenic Toll Road variant mentioned by some ride guides.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "car"
    ],
    "roadType": "coastal",
    "distanceMiles": 12,
    "estimatedDurationMinutes": 30,
    "difficulty": "challenging",
    "highlights": [
      "Porlock Hill",
      "Exmoor heights",
      "Countisbury Hill"
    ],
    "safetyNotices": [
      "Porlock Hill reaches very steep gradients with tight bends; use an appropriate gear and leave extra braking margin.",
      "The descent towards Lynmouth is also steep and demands concentration.",
      "Coastal weather, tourist traffic and slower vehicles can materially affect the ride."
    ],
    "start": {
      "lat": 51.2088,
      "lon": -3.595,
      "label": "Porlock"
    },
    "end": {
      "lat": 51.2295,
      "lon": -3.8311,
      "label": "Lynmouth"
    },
    "waypoints": [
      {
        "lat": 51.216,
        "lon": -3.796,
        "label": "Countisbury"
      }
    ],
    "routeSourceUrl": "https://www.adventurebikerider.com/8-roads-with-the-best-views-in-the-uk/",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d9/Porlock_%2C_Porlock_Hill_A39_-_geograph.org.uk_-_6258978.jpg/1280px-Porlock_%2C_Porlock_Hill_A39_-_geograph.org.uk_-_6258978.jpg",
      "alt": "The A39 climbing Porlock Hill",
      "author": "Lewis Clarke",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Porlock_,_Porlock_Hill_A39_-_geograph.org.uk_-_6258978.jpg"
    }
  },
  {
    "id": "glyndwrs-way",
    "name": "Glyndŵr’s Way",
    "region": "Mid Wales",
    "road": "Knighton to Welshpool · via Rhayader & Machynlleth",
    "description": "A deliberate 114-mile motorcycle route across Mid Wales, combining quiet border roads, the Llanidloes mountain road, Clywedog scenery and the A487 beneath Cadair Idris.",
    "riderNote": "A proper one-day ride rather than a single trunk-road corridor. Start early, treat the waypoints as part of the route, and allow much longer if you plan sightseeing stops.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "car"
    ],
    "roadType": "mixed",
    "distanceMiles": 114,
    "estimatedDurationMinutes": 240,
    "difficulty": "challenging",
    "highlights": [
      "Rhayader",
      "Clywedog Reservoir",
      "Machynlleth",
      "Cadair Idris",
      "Lake Vyrnwy"
    ],
    "safetyNotices": [
      "The route is long and includes exposed upland and narrow mountain-road sections.",
      "Weather and daylight matter; do not treat the planning time as a live ETA.",
      "Watch for livestock, damp surfaces and limited fuel/phone coverage on remote sections."
    ],
    "start": {
      "lat": 52.3438,
      "lon": -3.0507,
      "label": "Knighton"
    },
    "end": {
      "lat": 52.659,
      "lon": -3.147,
      "label": "Welshpool"
    },
    "waypoints": [
      {
        "lat": 52.3015,
        "lon": -3.511,
        "label": "Rhayader"
      },
      {
        "lat": 52.449,
        "lon": -3.54,
        "label": "Llanidloes"
      },
      {
        "lat": 52.3501,
        "lon": -3.7711,
        "label": "Cwmystwyth"
      },
      {
        "lat": 52.5903,
        "lon": -3.8535,
        "label": "Machynlleth"
      },
      {
        "lat": 52.72665,
        "lon": -3.82721,
        "label": "Cross Foxes"
      },
      {
        "lat": 52.759,
        "lon": -3.482,
        "label": "Lake Vyrnwy"
      }
    ],
    "routeSourceUrl": "https://www.adventurebikerider.com/article/great-britain-glyndwrs-way/",
    "conditionsUrl": "https://traffic.wales/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/8/80/The_road_down_into_Cwmystwyth_-_geograph.org.uk_-_6304586.jpg",
      "alt": "A mountain road descending into Cwmystwyth in Mid Wales",
      "author": "John Lucas",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:The_road_down_into_Cwmystwyth_-_geograph.org.uk_-_6304586.jpg"
    }
  },
  {
    "id": "b4391-ffestiniog-arenig",
    "name": "B4391 Ffestiniog–Arenig",
    "region": "Eryri / North Wales",
    "road": "B4391 · Llan Ffestiniog to A4212",
    "description": "Eight miles of high moorland road linking Llan Ffestiniog with the A4212, climbing past Cwm Cynfal before opening into exposed Eryri countryside.",
    "riderNote": "Short, exposed and memorable: a proper North Wales connector that suits bikes, scooters and nimble cars without turning the catalogue into another all-day mountain route.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 8,
    "estimatedDurationMinutes": 20,
    "difficulty": "moderate",
    "highlights": [
      "Cwm Cynfal",
      "Open Eryri moorland",
      "Arenig approach"
    ],
    "safetyNotices": [
      "The route includes blind, tightening corners; keep enough margin to stop within the distance you can see to be clear.",
      "The upland section is exposed to fast-changing rain, wind and low cloud, and includes cattle grids.",
      "Check Cyngor Gwynedd's current roadworks map before departure; the map is updated weekly but short-notice works may not appear immediately."
    ],
    "start": {
      "lat": 52.95789,
      "lon": -3.92927,
      "label": "Llan Ffestiniog (A470 junction)"
    },
    "end": {
      "lat": 52.9396,
      "lon": -3.76416,
      "label": "A4212 junction near Arenig"
    },
    "waypoints": [
      {
        "lat": 52.95814,
        "lon": -3.88551,
        "label": "Cwm Cynfal Viewpoint"
      },
      {
        "lat": 52.95949,
        "lon": -3.86889,
        "label": "B4407 junction"
      }
    ],
    "routeSourceUrl": "https://www.supercar-driver.com/blog/our-favourite-driving-roads-b4391-north-wales",
    "conditionsUrl": "https://www.gwynedd.llyw.cymru/en-gb/parking-roads-and-travel/traffic-road-improvements-and-roadworks/roadworks",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/d/d2/B4391_approx_3km_from_Llan_Ffestiniog_-_geograph.org.uk_-_101596.jpg",
      "alt": "The B4391 about 3 km east of Llan Ffestiniog",
      "author": "Ian Warburton",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:B4391_approx_3km_from_Llan_Ffestiniog_-_geograph.org.uk_-_101596.jpg"
    }
  },
  {
    "id": "b4560-llangynidr",
    "name": "Llangynidr Mountain Road",
    "region": "Bannau Brycheiniog",
    "road": "B4560 · Talgarth to Beaufort",
    "description": "A high Welsh road mixing tight climbing hairpins with open, sweeping upland curves and broad views across Bannau Brycheiniog.",
    "riderNote": "Short in mileage but not a casual shortcut. The appeal is the technical change of pace from hairpins to exposed, flowing hilltop road.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 17,
    "estimatedDurationMinutes": 40,
    "difficulty": "challenging",
    "highlights": [
      "Upland hairpins",
      "Open hilltops",
      "Bannau Brycheiniog views"
    ],
    "safetyNotices": [
      "A temporary B4560 closure at Llangynidr is scheduled for 5–13 October 2026 for ground-investigation works; check Traffic Wales before travelling.",
      "Sheep and wild ponies can be on or beside the carriageway.",
      "The exposed high ground can be windy, wet or low-visibility even when valleys are clearer.",
      "Keep extra margin through blind crests and tighter hairpins."
    ],
    "start": {
      "lat": 51.9954,
      "lon": -3.2322,
      "label": "Talgarth"
    },
    "end": {
      "lat": 51.795,
      "lon": -3.205,
      "label": "Beaufort"
    },
    "waypoints": [
      {
        "lat": 51.867,
        "lon": -3.228,
        "label": "Llangynidr"
      }
    ],
    "routeSourceUrl": "https://www.adventurebikerider.com/article/uk-roads-to-ride-in-2021/",
    "conditionsUrl": "https://traffic.wales/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/e/e1/B4560_Llangynidr_mountain_road_-_geograph.org.uk_-_4380999.jpg",
      "alt": "The B4560 Llangynidr mountain road",
      "author": "Jonathan Billinger",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:B4560_Llangynidr_mountain_road_-_geograph.org.uk_-_4380999.jpg"
    }
  },
  {
    "id": "a686-hartside",
    "name": "Hartside Pass",
    "region": "Cumbria & Northumberland",
    "road": "A686 · Penrith to Haydon Bridge",
    "description": "A high Pennine crossing with long sightlines, sweeping bends and a memorable descent into the South Tyne valley.",
    "riderNote": "A motorbike-first day ride on public A-roads. Smaller bikes and scooters can use the route without a motorway, but should allow extra climbing time.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 37,
    "estimatedDurationMinutes": 70,
    "difficulty": "challenging",
    "highlights": [
      "Hartside summit",
      "South Tyne valley",
      "Alston stop"
    ],
    "safetyNotices": [
      "Exposed summit weather can change quickly.",
      "Ice and winter gritting limitations can affect the Alston section.",
      "Check closures and conditions before setting off."
    ],
    "start": {
      "lat": 54.6641,
      "lon": -2.7527,
      "label": "Penrith"
    },
    "end": {
      "lat": 54.974,
      "lon": -2.2472,
      "label": "Haydon Bridge"
    },
    "waypoints": [
      {
        "lat": 54.8128,
        "lon": -2.4393,
        "label": "Alston"
      }
    ],
    "routeSourceUrl": "https://www.adventurebikerider.com/abrs-weekend-ride-crossing-the-pennines-on-the-a686/",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/5/5c/The_A686_below_Hartside_-_geograph.org.uk_-_1073084.jpg",
      "alt": "The A686 descending below Hartside summit",
      "author": "Andrew Smith",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:The_A686_below_Hartside_-_geograph.org.uk_-_1073084.jpg"
    }
  },
  {
    "id": "b6277-north-pennines",
    "name": "North Pennines B6277",
    "region": "County Durham & Cumbria",
    "road": "B6277 · Barnard Castle to Alston",
    "description": "A remote 31-mile Pennine road with a rewarding mix of flowing bends and short straights as it climbs from Teesdale towards Alston.",
    "riderNote": "A strong alternative to simply repeating the A686. It delivers the same broad high-country feeling with its own quieter, undulating rhythm.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 31,
    "estimatedDurationMinutes": 60,
    "difficulty": "moderate",
    "highlights": [
      "Teesdale",
      "Middleton-in-Teesdale",
      "High Pennine moorland"
    ],
    "safetyNotices": [
      "The road reaches remote, exposed upland terrain close to 600m.",
      "Weather can deteriorate quickly and winter conditions can be severe.",
      "Fuel and services thin out towards the higher sections; plan range before setting off."
    ],
    "start": {
      "lat": 54.5444,
      "lon": -1.927,
      "label": "Barnard Castle"
    },
    "end": {
      "lat": 54.8128,
      "lon": -2.4393,
      "label": "Alston"
    },
    "waypoints": [
      {
        "lat": 54.6254,
        "lon": -2.082,
        "label": "Middleton-in-Teesdale"
      }
    ],
    "routeSourceUrl": "https://www.adventurebikerider.com/article/uk-roads-to-ride-in-2021/",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0b/Middleton-in-Teesdale_%2C_Alston_Road_B6277_-_geograph.org.uk_-_6687638.jpg/1280px-Middleton-in-Teesdale_%2C_Alston_Road_B6277_-_geograph.org.uk_-_6687638.jpg",
      "alt": "The B6277 Alston road near Middleton-in-Teesdale",
      "author": "Lewis Clarke",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Middleton-in-Teesdale_,_Alston_Road_B6277_-_geograph.org.uk_-_6687638.jpg"
    }
  },
  {
    "id": "honister-newlands-loop",
    "name": "Honister & Newlands Circuit",
    "region": "Lake District",
    "road": "Keswick · Honister Pass · Buttermere · Newlands Pass",
    "description": "A compact Lake District circuit pairing the steep Honister crossing with Buttermere and the narrow, dramatic Newlands Pass before returning to Keswick.",
    "riderNote": "This is intentionally labelled challenging. It is scenic and memorable, but the gradients, narrow carriageway and tourist traffic make it a route to ride patiently.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 25,
    "estimatedDurationMinutes": 75,
    "difficulty": "challenging",
    "highlights": [
      "Borrowdale",
      "Honister Pass",
      "Buttermere",
      "Newlands Pass"
    ],
    "safetyNotices": [
      "Honister is one of the steepest roads in the country, reaching roughly 1-in-4 gradients.",
      "Newlands and Honister include narrow sections, tight bends and limited passing room.",
      "Do not rely on ordinary sat-nav journey times; slow traffic, livestock and visitors can add substantial time."
    ],
    "start": {
      "lat": 54.6013,
      "lon": -3.1347,
      "label": "Keswick"
    },
    "end": {
      "lat": 54.6013,
      "lon": -3.1347,
      "label": "Keswick"
    },
    "waypoints": [
      {
        "lat": 54.5129,
        "lon": -3.1664,
        "label": "Seatoller"
      },
      {
        "lat": 54.5117,
        "lon": -3.1993,
        "label": "Honister Pass"
      },
      {
        "lat": 54.5413,
        "lon": -3.276,
        "label": "Buttermere"
      },
      {
        "lat": 54.5765,
        "lon": -3.229,
        "label": "Newlands Pass"
      },
      {
        "lat": 54.614,
        "lon": -3.191,
        "label": "Braithwaite"
      }
    ],
    "routeSourceUrl": "https://lakedistrict.gov.uk/blog/top-10-locations-to-visit-in-the-lake-district/",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/17/Honister_pass_near_the_slate_mine_-_geograph.org.uk_-_6186484.jpg/1280px-Honister_pass_near_the_slate_mine_-_geograph.org.uk_-_6186484.jpg",
      "alt": "Honister Pass near the slate mine",
      "author": "Richard Humphrey",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Honister_pass_near_the_slate_mine_-_geograph.org.uk_-_6186484.jpg"
    }
  },
  {
    "id": "yorkshire-ribblehead-buttertubs",
    "name": "Ribblehead & Buttertubs",
    "region": "Yorkshire Dales",
    "road": "B6255 & Buttertubs Pass · Ingleton to Muker",
    "description": "A compact Dales route that pairs the flowing B6255 past Ribblehead with the steep, exposed Buttertubs crossing from Hawes into Swaledale.",
    "riderNote": "This combines two roads that are stronger together than as separate novelty cards: the B6255 provides the flowing approach and Buttertubs adds the technical high-moor finish.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 23,
    "estimatedDurationMinutes": 50,
    "difficulty": "challenging",
    "highlights": [
      "Ribblehead",
      "Wensleydale",
      "Buttertubs Pass",
      "Swaledale"
    ],
    "safetyNotices": [
      "Buttertubs is narrow and exposed, with livestock, cattle grids and steep pitches.",
      "The high pass is weather-sensitive and can become unreliable in severe conditions; check current road status before setting off.",
      "Drystone walls leave little verge or run-off on parts of the Dales road network.",
      "Summer weekends can be busy around Hawes and Ribblehead; allow substantially longer if stopping."
    ],
    "start": {
      "lat": 54.1535,
      "lon": -2.468,
      "label": "Ingleton"
    },
    "end": {
      "lat": 54.3839,
      "lon": -2.1469,
      "label": "Muker"
    },
    "waypoints": [
      {
        "lat": 54.2068,
        "lon": -2.3638,
        "label": "Ribblehead"
      },
      {
        "lat": 54.3042,
        "lon": -2.1964,
        "label": "Hawes"
      },
      {
        "lat": 54.3602,
        "lon": -2.1961,
        "label": "Buttertubs Pass"
      }
    ],
    "routeSourceUrl": "https://www.rapidtraining.co.uk/blog/2023/02/21/2023-2-21-rapid-roads-b6255",
    "conditionsUrl": "https://one.network/uk",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/8/8c/The_B6255_road_near_Ribblehead_-_geograph.org.uk_-_8295984.jpg",
      "alt": "The B6255 road running across open moorland near Ribblehead",
      "author": "Thomas Nugent",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:The_B6255_road_near_Ribblehead_-_geograph.org.uk_-_8295984.jpg"
    }
  },
  {
    "id": "a708-three-lochs",
    "name": "Three Lochs Run",
    "region": "Scottish Borders",
    "road": "A708 & reservoir roads · Moffat loop",
    "description": "A forty-three-mile Borders loop from Moffat along the A708 beside St Mary's Loch, then back through the Talla and Megget reservoir country and the Devil's Beef Tub.",
    "riderNote": "A strong crossover route for bikes and cars: the A708 provides flowing road and scenery, while the reservoir leg slows the pace and gives the loop a distinct touring character.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "mixed",
    "distanceMiles": 43,
    "estimatedDurationMinutes": 75,
    "difficulty": "moderate",
    "highlights": [
      "Grey Mare's Tail",
      "St Mary's Loch",
      "Talla Reservoir",
      "Devil's Beef Tub"
    ],
    "safetyNotices": [
      "The Megget and Talla reservoir leg is narrow, uses passing places and has some uneven sections, so it needs a lower pace than the A708.",
      "There are no fuel stations on the 43-mile loop; fill up in Moffat before leaving.",
      "Weather changes quickly on the exposed Borders uplands.",
      "Ride time is a route-only planning estimate and excludes scenic or café stops."
    ],
    "start": {
      "lat": 55.3333,
      "lon": -3.4443,
      "label": "Moffat"
    },
    "end": {
      "lat": 55.3333,
      "lon": -3.4443,
      "label": "Moffat"
    },
    "waypoints": [
      {
        "lat": 55.4923,
        "lon": -3.1914,
        "label": "St Mary's Loch"
      },
      {
        "lat": 55.4935,
        "lon": -3.4158,
        "label": "Talla Reservoir"
      },
      {
        "lat": 55.5042,
        "lon": -3.4291,
        "label": "Tweedsmuir"
      },
      {
        "lat": 55.4015,
        "lon": -3.4862,
        "label": "Devil's Beef Tub"
      }
    ],
    "routeSourceUrl": "https://www.motorcyclescotland.com/routes/three-lochs-run/",
    "conditionsUrl": "https://www.traffic.gov.scot/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/4/45/A708_beside_St_Mary%27s_Loch_-_geograph.org.uk_-_7249278.jpg",
      "alt": "The A708 beside St Mary's Loch in the Scottish Borders",
      "author": "Sandy Gerrard",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:A708_beside_St_Mary's_Loch_-_geograph.org.uk_-_7249278.jpg"
    }
  },
  {
    "id": "a821-dukes-pass",
    "name": "Duke’s Pass",
    "region": "Loch Lomond & The Trossachs",
    "road": "A821 · Aberfoyle to Kilmahog",
    "description": "Fourteen miles of near-continuous corners through wooded Trossachs hills, climbing quickly out of Aberfoyle before running past lochs towards Kilmahog.",
    "riderNote": "A compact technical road rather than a sightseeing cruise. Ride it for the corner sequence, then stop for the scenery rather than trying to do both at once.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 14,
    "estimatedDurationMinutes": 35,
    "difficulty": "challenging",
    "highlights": [
      "Trossachs forest",
      "Brig o’ Turk",
      "Loch Achray"
    ],
    "safetyNotices": [
      "Corners come in quick succession and demand sustained attention.",
      "Tourist coaches can take wide lines through sharper bends.",
      "Forested sections can stay damp and visibility changes quickly with weather."
    ],
    "start": {
      "lat": 56.1785,
      "lon": -4.3848,
      "label": "Aberfoyle"
    },
    "end": {
      "lat": 56.2494,
      "lon": -4.2479,
      "label": "Kilmahog"
    },
    "waypoints": [
      {
        "lat": 56.2301,
        "lon": -4.3639,
        "label": "Brig o’ Turk"
      }
    ],
    "routeSourceUrl": "https://www.adventurebikerider.com/article/uk-roads-to-ride-in-2021/",
    "conditionsUrl": "https://www.traffic.gov.scot/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Duke%27s_Pass_-_geograph.org.uk_-_4767591.jpg/1280px-Duke%27s_Pass_-_geograph.org.uk_-_4767591.jpg",
      "alt": "Duke’s Pass in the Trossachs",
      "author": "James Allan",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Duke's_Pass_-_geograph.org.uk_-_4767591.jpg"
    }
  },
  {
    "id": "a82-glencoe",
    "name": "Glencoe Run",
    "region": "Scottish Highlands",
    "road": "A82 · Tyndrum to Glencoe",
    "description": "A dramatic Highland run past Rannoch Moor and the mountains guarding Glencoe.",
    "riderNote": "Wide, surfaced A-road riding with no motorway required. It is approachable on smaller road bikes, while exposed weather and tourist traffic still demand care.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 35,
    "estimatedDurationMinutes": 55,
    "difficulty": "moderate",
    "highlights": [
      "Rannoch Moor",
      "Buachaille Etive Mòr",
      "Glencoe"
    ],
    "safetyNotices": [
      "Expect fast weather changes and strong crosswinds.",
      "Traffic can be heavy at viewpoints and in peak season.",
      "Check Traffic Scotland before departure."
    ],
    "start": {
      "lat": 56.4343,
      "lon": -4.7148,
      "label": "Tyndrum"
    },
    "end": {
      "lat": 56.6826,
      "lon": -5.1023,
      "label": "Glencoe"
    },
    "waypoints": [
      {
        "lat": 56.6466,
        "lon": -4.8378,
        "label": "Rannoch Moor"
      }
    ],
    "routeSourceUrl": "https://www.seelochlomond.co.uk/discover/a82-loch-lomond-road-trip",
    "conditionsUrl": "https://www.traffic.gov.scot/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/0/0d/A82_towards_Glencoe_-_geograph.org.uk_-_3149881.jpg",
      "alt": "The A82 heading towards Glencoe",
      "author": "N Chadwick",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:A82_towards_Glencoe_-_geograph.org.uk_-_3149881.jpg"
    }
  },
  {
    "id": "snowroads",
    "name": "SnowRoads",
    "region": "Cairngorms National Park",
    "road": "A93, A939 & A940 · Blairgowrie to Grantown-on-Spey",
    "description": "Ninety miles across Britain’s highest public roads, linking Glenshee, Braemar, Ballater and Tomintoul.",
    "riderNote": "Built for an unhurried motorcycle day. The route avoids motorways and is viable on smaller-capacity road bikes when weather, range and daylight are planned carefully.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "mountain",
    "distanceMiles": 90,
    "estimatedDurationMinutes": 180,
    "difficulty": "challenging",
    "highlights": [
      "Glenshee",
      "Braemar",
      "Lecht Road",
      "Tomintoul"
    ],
    "safetyNotices": [
      "Snow gates and winter closures are possible.",
      "Fuel stops are widely spaced; plan range before riding.",
      "Allow a full day and check Highland conditions."
    ],
    "start": {
      "lat": 56.5916,
      "lon": -3.34,
      "label": "Blairgowrie"
    },
    "end": {
      "lat": 57.3297,
      "lon": -3.608,
      "label": "Grantown-on-Spey"
    },
    "waypoints": [
      {
        "lat": 57.0065,
        "lon": -3.3962,
        "label": "Braemar"
      },
      {
        "lat": 57.0491,
        "lon": -3.04,
        "label": "Ballater"
      },
      {
        "lat": 57.252,
        "lon": -3.377,
        "label": "Tomintoul"
      }
    ],
    "routeSourceUrl": "https://www.visitcairngorms.com/inspire-me/snowroads/",
    "conditionsUrl": "https://www.traffic.gov.scot/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/32/Cairngorms_National_Park_road_%28Unsplash%29.jpg/1280px-Cairngorms_National_Park_road_%28Unsplash%29.jpg",
      "alt": "A mountain road through Cairngorms National Park",
      "author": "Milada Vigerova",
      "licenseName": "CC0 1.0",
      "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Cairngorms_National_Park_road_(Unsplash).jpg"
    }
  },
  {
    "id": "a838-durness-tongue",
    "name": "North Coast A838",
    "region": "Sutherland",
    "road": "A838 · Durness to Tongue",
    "description": "A remote north-coast run around Loch Eriboll and across open moorland, combining low-speed bends with wider flowing sections and constant Atlantic-scale scenery.",
    "riderNote": "This is the kind of NC500 section that works well on its own. It gives riders the character of the far north without pretending a 500-mile itinerary is one ordinary ride.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "coastal",
    "distanceMiles": 29,
    "estimatedDurationMinutes": 55,
    "difficulty": "moderate",
    "highlights": [
      "Loch Eriboll",
      "North-coast beaches",
      "Open Sutherland moorland"
    ],
    "safetyNotices": [
      "The route is remote; fuel, food and phone coverage can be sparse.",
      "Summer traffic can be heavy relative to the road width.",
      "Allow for single-track etiquette, changing weather and slow vehicles."
    ],
    "start": {
      "lat": 58.568,
      "lon": -4.745,
      "label": "Durness"
    },
    "end": {
      "lat": 58.477,
      "lon": -4.417,
      "label": "Tongue"
    },
    "waypoints": [
      {
        "lat": 58.465,
        "lon": -4.748,
        "label": "Loch Eriboll"
      }
    ],
    "routeSourceUrl": "https://www.adventurebikerider.com/article/8-of-britains-most-scenic-rides/",
    "conditionsUrl": "https://www.traffic.gov.scot/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d0/A838_towards_Durness_-_geograph.org.uk_-_8260507.jpg/1280px-A838_towards_Durness_-_geograph.org.uk_-_8260507.jpg",
      "alt": "The A838 in Sutherland near Durness",
      "author": "Steven Brown",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:A838_towards_Durness_-_geograph.org.uk_-_8260507.jpg"
    }
  },
  {
    "id": "causeway-coast",
    "name": "Causeway Coast",
    "region": "County Antrim, Northern Ireland",
    "road": "A2 · Belfast to Derry/Londonderry",
    "description": "A full coastal journey through glens, cliff-backed beaches and the basalt landscape around the Giant’s Causeway.",
    "riderNote": "The main signed coastal corridor suits road motorcycles and scooters. The official route varies with optional loops; this curated line intentionally excludes the tighter Torr Head detour and keeps the principal coast road.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "coastal",
    "distanceMiles": 115,
    "estimatedDurationMinutes": 210,
    "difficulty": "moderate",
    "highlights": [
      "Glens of Antrim",
      "Ballycastle",
      "Giant’s Causeway"
    ],
    "safetyNotices": [
      "Coastal winds, spray and tourist traffic can slow progress.",
      "Treat the route as a full-day ride with planned stops.",
      "Check Trafficwatch NI before leaving."
    ],
    "start": {
      "lat": 54.5973,
      "lon": -5.9301,
      "label": "Belfast"
    },
    "end": {
      "lat": 54.9966,
      "lon": -7.3086,
      "label": "Derry/Londonderry"
    },
    "waypoints": [
      {
        "lat": 54.857,
        "lon": -5.811,
        "label": "Larne"
      },
      {
        "lat": 55.205,
        "lon": -6.249,
        "label": "Ballycastle"
      },
      {
        "lat": 55.204,
        "lon": -6.523,
        "label": "Bushmills"
      },
      {
        "lat": 55.2045,
        "lon": -6.6529,
        "label": "Portrush"
      },
      {
        "lat": 55.1656,
        "lon": -6.7868,
        "label": "Castlerock"
      }
    ],
    "routeSourceUrl": "https://discovernorthernireland.com/destinations/causeway-coastal-route/getting-here/",
    "conditionsUrl": "https://www.trafficwatchni.com/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://upload.wikimedia.org/wikipedia/commons/e/e1/Causeway_Coastal_Route%2C_Dunseverick_-_geograph.org.uk_-_5572416.jpg",
      "alt": "The Causeway Coastal Route at Dunseverick",
      "author": "David Dixon",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Causeway_Coastal_Route,_Dunseverick_-_geograph.org.uk_-_5572416.jpg"
    }
  },
  {
    "id": "mourne-coast-a2",
    "name": "Mourne Coast",
    "region": "County Down, Northern Ireland",
    "road": "A2 · Newry to Newcastle via the coast",
    "description": "A signed coastal run from Newry through Warrenpoint, Rostrevor, Kilkeel and Annalong, with Carlingford Lough and the Mournes trading places beside the road.",
    "riderNote": "Use this as the concentrated coastal section rather than trying to compress the much longer Belfast-to-Newry tourism route into one ordinary ride.",
    "vehicleSuitability": [
      "motorcycle_small",
      "motorcycle_large",
      "scooter",
      "car"
    ],
    "roadType": "coastal",
    "distanceMiles": 35,
    "estimatedDurationMinutes": 70,
    "difficulty": "moderate",
    "highlights": [
      "Carlingford Lough",
      "Rostrevor",
      "Kilkeel",
      "Annalong",
      "Slieve Donard"
    ],
    "safetyNotices": [
      "Coastal weather can bring strong wind, spray and rapidly changing visibility.",
      "Expect village traffic, walkers and visitors around seaside stops.",
      "Official tourism guidance encourages taking substantially longer when stopping to explore; the ride time here excludes stops."
    ],
    "start": {
      "lat": 54.1751,
      "lon": -6.3402,
      "label": "Newry"
    },
    "end": {
      "lat": 54.211,
      "lon": -5.891,
      "label": "Newcastle"
    },
    "waypoints": [
      {
        "lat": 54.100079,
        "lon": -6.25128,
        "label": "Warrenpoint"
      },
      {
        "lat": 54.1,
        "lon": -6.202,
        "label": "Rostrevor"
      },
      {
        "lat": 54.063,
        "lon": -5.993,
        "label": "Kilkeel"
      },
      {
        "lat": 54.1082,
        "lon": -5.8997,
        "label": "Annalong"
      }
    ],
    "routeSourceUrl": "https://www.visitmournegullionstrangford.com/things-to-do/mourne-coastal-route-from-newcastle-p847801",
    "conditionsUrl": "https://www.trafficwatchni.com/",
    "reviewedAt": "2026-09-19",
    "image": {
      "uri": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/The_cliff_top_Annalong_Road_on_the_north-eastern_outskirts_of_Ballymartin_-_geograph.org.uk_-_5927104.jpg/1280px-The_cliff_top_Annalong_Road_on_the_north-eastern_outskirts_of_Ballymartin_-_geograph.org.uk_-_5927104.jpg",
      "alt": "The Annalong Road on the Mourne coast",
      "author": "Eric Jones",
      "licenseName": "CC BY-SA 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0/",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:The_cliff_top_Annalong_Road_on_the_north-eastern_outskirts_of_Ballymartin_-_geograph.org.uk_-_5927104.jpg"
    }
  }
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
