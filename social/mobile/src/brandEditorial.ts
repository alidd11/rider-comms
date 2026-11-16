/**
 * First-party editorial starter catalogue. Not user-published posts, actual
 * events, engagement figures or a registered Rider Comms account.
 * Licensed imagery/footage is credited to Pexels creators, not owned riders.
 * Replace URLs with owner-hosted, reviewed derivatives before public UGC.
 */
export const RIDER_BRAND_ID = 'rider-comms-editorial';
export const brandPosts = [
  { id:'brand-coast', title:'For the road ahead', category:'Motorcycles',
    caption:'Quiet roads, remarkable views, and the places we discover along the way.',
    imageUrl:'https://images.pexels.com/photos/31636520/pexels-photo-31636520.jpeg?auto=compress&cs=tinysrgb&w=1100',
    alt:'Classic motorcycle near a coastal road at sunset',tone:'#2B4648',
    credit:'lhoang / Pexels',source:'https://www.pexels.com/photo/vintage-motorcycle-by-coastal-road-at-sunset-31636520/' },
  { id:'brand-cars', title:'After dark', category:'Cars',
    caption:'The detail, design and atmosphere that bring car communities together.',
    imageUrl:'https://images.pexels.com/photos/39779189/pexels-photo-39779189.jpeg?auto=compress&cs=tinysrgb&w=1100',
    alt:'Red sports car parked in a city at twilight',tone:'#44332F',
    credit:'Erik Mclean / Pexels',source:'https://www.pexels.com/photo/red-sports-car-in-urban-setting-during-twilight-39779189/' },
  { id:'brand-cycle', title:'Early starts', category:'Cycling',
    caption:'Two wheels, open routes and the best part of the morning.',
    imageUrl:'https://images.pexels.com/photos/22765380/pexels-photo-22765380.jpeg?auto=compress&cs=tinysrgb&w=1100',
    alt:'Cyclist on a lakeside road at sunrise',tone:'#304A3F',
    credit:'Long Nguyen / Pexels',source:'https://www.pexels.com/photo/people-cycling-at-sunrise-on-road-near-lake-22765380/' },
  { id:'brand-gear', title:'The details matter', category:'Motorcycles',
    caption:'A closer look at the equipment that joins us for every journey.',
    imageUrl:'https://images.pexels.com/photos/37335557/pexels-photo-37335557.jpeg?auto=compress&cs=tinysrgb&w=1100',
    alt:'Black motorcycle helmet on a motorcycle',tone:'#273F4A',
    credit:'Marius Gabriel / Pexels',source:'https://www.pexels.com/photo/close-up-of-a-motorcycle-helmet-on-a-motorcycle-37335557/' },
] as const;
export const brandStories = brandPosts.slice(0,3).map((post,index)=>({
  id:'brand-story-'+index,name:'Rider Comms',color:post.tone,
  imageUrl:post.imageUrl,category:post.category,
}));
export const brandReels = [
  {id:'brand-mountain-reel',title:'Roads worth remembering',category:'MOTORCYCLES' as const,
    imageUrl:brandPosts[0].imageUrl,theme:'#263D47',
    hasAudio:false, videoUrl:'https://videos.pexels.com/video-files/37451401/15861941_540_960_60fps.mp4',
    sourceUrl:'https://www.pexels.com/video/scenic-mountain-road-motorcycle-journey-37451401/',
    credit:'Ahmet Mert / Pexels'},
  {id:'brand-cycling-reel',title:'The journey, not the destination',category:'CYCLING' as const,
    imageUrl:brandPosts[2].imageUrl,theme:'#2C423D',
    hasAudio:false, videoUrl:'https://videos.pexels.com/video-files/37445718/15859458_540_960_30fps.mp4',
    sourceUrl:'https://www.pexels.com/video/scenic-mountain-road-cycling-adventure-37445718/',
    credit:'Yussuf Muradov / Pexels'},
] as const;
