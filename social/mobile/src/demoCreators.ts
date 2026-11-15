import { canEnterPublicDiscovery } from './domain.ts';
import type { SocialPost, GalleryItem } from './domain';

/** Fictional preview profiles; never infer these from Rider Comms accounts. */
export const demoCreators: Record<string, {
  id: string; displayName: string; handle: string; vehicle: string;
  kind: 'Car' | 'Motorcycle' | 'Bicycle';
  about: string; clubId: string; modifications: string[];
  gallery: readonly GalleryItem[];
}> = {
  alex: {
    id:'alex', displayName:'Alex Morgan', handle:'@alex',
    vehicle:'Motorcycle build', kind:'Motorcycle',
    about:'Weekend roads and scenic routes', clubId:'c1',
    modifications:['Touring setup','Road trip accessories'],
    gallery:[
      {uri:'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1100&q=82',alt:'Motorcycle on an open road'},
      {uri:'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=1100&q=82',alt:'Sample travel photography'},
    ],
  },
  nina: {
    id:'nina',displayName:'Nina Cole',handle:'@nina',vehicle:'Project car',
    kind:'Car',about:'Build progress and car photography',clubId:'c2',
    modifications:['Exterior detailing','Weekend project'],
    gallery:[
      {uri:'https://images.unsplash.com/photo-1625932197913-68755c94c51f?auto=format&fit=crop&w=1100&q=82',alt:'Sample sports car photography'},
      {uri:'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1100&q=82',alt:'Sample sports car'},
    ],
  },
  jules: {
    id:'jules', displayName:'Jules Reed',handle:'@jules',vehicle:'Road bicycle',
    kind:'Bicycle',about:'Group rides and scenic routes',clubId:'c3',
    modifications:['Road tyres','Long-distance setup'],
    gallery:[
      {uri:'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1100&q=82',alt:'Sample cycling photo'},
      {uri:'https://images.unsplash.com/photo-1541625602330-2277b4c461de?auto=format&fit=crop&w=1100&q=82',alt:'Sample road cycling'},
    ],
  },
};

export function publicGallery(post: SocialPost): GalleryItem[] {
  if (!canEnterPublicDiscovery(post)) return [];
  const primary: GalleryItem = { uri: post.imageUrl, alt: post.imageAlt };
  const images = [primary, ...(post.gallery ?? [])];
  return images.filter((item,index) => Boolean(item.uri) && images.findIndex(other => other.uri === item.uri) === index).slice(0,6);
}
