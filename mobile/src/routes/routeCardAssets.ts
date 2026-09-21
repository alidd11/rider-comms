import type { ImageSourcePropType } from 'react-native';

/**
 * Static local route-card photography. The larger route overview image stays
 * provider-hosted and is loaded only after a rider opens a route.
 *
 * Keep this list in sync with ROUTE_CARD_ASSETS.json. The client test verifies
 * that every curated route has matching native + PWA bytes and provenance.
 */
const ROUTE_CARD_IMAGES: Readonly<Record<string, ImageSourcePropType>> = {
  "surrey-hills-circuit": require('../../assets/routes/cards/surrey-hills-circuit.jpg'),
  "a507-baldock-buntingford": require('../../assets/routes/cards/a507-baldock-buntingford.jpg'),
  "b1145-norfolk": require('../../assets/routes/cards/b1145-norfolk.jpg'),
  "a466-wye-valley": require('../../assets/routes/cards/a466-wye-valley.jpg'),
  "b3212-dartmoor": require('../../assets/routes/cards/b3212-dartmoor.jpg'),
  "b3306-west-cornwall": require('../../assets/routes/cards/b3306-west-cornwall.jpg'),
  "a39-porlock-lynmouth": require('../../assets/routes/cards/a39-porlock-lynmouth.jpg'),
  "glyndwrs-way": require('../../assets/routes/cards/glyndwrs-way.jpg'),
  "b4391-ffestiniog-arenig": require('../../assets/routes/cards/b4391-ffestiniog-arenig.jpg'),
  "b4560-llangynidr": require('../../assets/routes/cards/b4560-llangynidr.jpg'),
  "a686-hartside": require('../../assets/routes/cards/a686-hartside.jpg'),
  "b6277-north-pennines": require('../../assets/routes/cards/b6277-north-pennines.jpg'),
  "honister-newlands-loop": require('../../assets/routes/cards/honister-newlands-loop.jpg'),
  "yorkshire-ribblehead-buttertubs": require('../../assets/routes/cards/yorkshire-ribblehead-buttertubs.jpg'),
  "a708-three-lochs": require('../../assets/routes/cards/a708-three-lochs.jpg'),
  "a821-dukes-pass": require('../../assets/routes/cards/a821-dukes-pass.jpg'),
  "a82-glencoe": require('../../assets/routes/cards/a82-glencoe.jpg'),
  "snowroads": require('../../assets/routes/cards/snowroads.jpg'),
  "a838-durness-tongue": require('../../assets/routes/cards/a838-durness-tongue.jpg'),
  "causeway-coast": require('../../assets/routes/cards/causeway-coast.jpg'),
  "mourne-coast-a2": require('../../assets/routes/cards/mourne-coast-a2.jpg'),
};

export function routeCardImageSource(routeId: string): ImageSourcePropType {
  const source = ROUTE_CARD_IMAGES[routeId];
  if (!source) throw new Error(`Missing bundled route card image for ${routeId}`);
  return source;
}
