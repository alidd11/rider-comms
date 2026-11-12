import type { SocialPost } from './domain';

export const followingIds = new Set(['alex', 'jules']);

export const demoPosts: SocialPost[] = [
  { id: 'p1', authorId: 'alex', author: 'Alex Morgan', handle: '@alex', heading: 'Sunday roads, no rush.', body: 'A quiet route, good company and one incredible viewpoint. Where did you ride this weekend?', category: 'MOTORCYCLES', icon: 'speedometer', accent: '#1B5368', imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1100&q=82', imageAlt: 'Motorcycle on an open road', publishedAt: 1762950000, discoveryScore: 95, audience: 'public' },
  { id: 'p2', authorId: 'nina', author: 'Nina Cole', handle: '@nina', heading: 'The project is finally taking shape.', body: 'A few details left on the build. Sharing the complete setup from the garage soon.', category: 'CARS', icon: 'car-sport', accent: '#6E453B', imageUrl: 'https://images.unsplash.com/photo-1625932197913-68755c94c51f?auto=format&fit=crop&w=1100&q=82', imageAlt: 'Red sports car parked along a night-time city street', publishedAt: 1762920000, discoveryScore: 99, audience: 'public' },
  { id: 'p3', authorId: 'jules', author: 'Jules Reed', handle: '@jules', heading: 'The early start was worth it.', body: 'Coffee stop after the group ride. Looking for recommendations for our next cycling route.', category: 'CYCLING', icon: 'bicycle', accent: '#44624A', imageUrl: 'https://images.unsplash.com/photo-1541625602330-2277b4c461de?auto=format&fit=crop&w=1100&q=82', imageAlt: 'Cycling along a scenic road', publishedAt: 1762953000, discoveryScore: 82, audience: 'public' },
  { id: 'p4', authorId: 'clubprivate', author: 'Private Club', handle: '@private', heading: 'Members-only event details', body: 'This must never appear in public discovery.', category: 'CLUB', icon: 'images', accent: '#444', imageUrl: 'https://images.unsplash.com/photo-1511994298241-608e28f14fde?auto=format&fit=crop&w=1100&q=82', imageAlt: 'A vehicle build in a garage', publishedAt: 1762959000, discoveryScore: 200, audience: 'members', clubAccess: 'private' }
];

export const demoStories = [
  { id: 's1', name: 'Alex', initials: 'AM', color: '#285C70', imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1100&q=82', category: 'Motorcycles' },
  { id: 's2', name: 'Nina', initials: 'NC', color: '#6E453B', imageUrl: 'https://images.unsplash.com/photo-1625932197913-68755c94c51f?auto=format&fit=crop&w=1100&q=82', category: 'Cars' },
  { id: 's3', name: 'Jules', initials: 'JR', color: '#43674A', imageUrl: 'https://images.unsplash.com/photo-1541625602330-2277b4c461de?auto=format&fit=crop&w=1100&q=82', category: 'Cycling' },
  { id: 's4', name: 'Events', initials: 'EV', color: '#655478', imageUrl: 'https://images.unsplash.com/photo-1511994298241-608e28f14fde?auto=format&fit=crop&w=1100&q=82', category: 'Community' }
];

export const demoClubs = [
  { id: 'c1', name: 'South Coast Riders', category: 'Motorcycles', members: 1248, city: 'South England', description: 'Weekend rides, scenic routes and friendly meetups.', privacy: 'Public', accent: '#265665' },
  { id: 'c2', name: 'The Build Collective', category: 'Cars', members: 813, city: 'London', description: 'Build diaries, automotive photography and local meets.', privacy: 'Approval', accent: '#6D493E' },
  { id: 'c3', name: 'Sunday Cycle Club', category: 'Cycling', members: 542, city: 'Surrey', description: 'No-drop group rides, coffee stops and shared routes.', privacy: 'Public', accent: '#45644A' }
];

export const demoEvents = [
  { id: 'e1', title: 'Coffee & Cars', category: 'Car meet', date: 'SUN · 22 NOV', place: 'London · Example venue', organiser: 'The Build Collective', accent: '#6D493E' },
  { id: 'e2', title: 'Weekend Group Ride', category: 'Motorcycle ride', date: 'SAT · 28 NOV', place: 'Sussex · Example route', organiser: 'South Coast Riders', accent: '#265665' }
];

export const demoListings = [
  { id: 'l1', name: 'Touring gloves', price: '£49', category: 'Accessories', merchant: 'Demo Rider Supply', type: 'Product', icon: 'hand-left' as const, accent: '#294C60' },
  { id: 'l2', name: 'Road bicycle helmet', price: '£89', category: 'Accessories', merchant: 'Demo Cycle Studio', type: 'Product', icon: 'bicycle' as const, accent: '#3D614C' },
  { id: 'l3', name: '125cc scooter — enquiry', price: 'Request quote', category: 'Vehicles', merchant: 'Demo Scooter Dealer', type: 'Vehicle', icon: 'speedometer' as const, accent: '#5C4B6F' },
  { id: 'l4', name: 'Scooter rental — request', price: 'Check dates', category: 'Rentals', merchant: 'Demo Scooter Rental', type: 'Rental', icon: 'calendar' as const, accent: '#66523F' }
];
