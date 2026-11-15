import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import { brandPosts, brandReels, brandStories } from './brandEditorial';
type Tab = 'Posts' | 'Reels' | 'Stories';
type EditorialPost = (typeof brandPosts)[number];

export function RiderBrandHome({ onOpen }: {onOpen:()=>void}) {
  return <Pressable testID="brand-home-feature" accessibilityRole="button"
    accessibilityLabel="Open Rider Comms editorial page" onPress={onOpen}
    style={{ marginHorizontal: 16, marginVertical: 8, paddingHorizontal: 12,
      minHeight: 62, borderRadius: 14, backgroundColor: C.panel,
      flexDirection: 'row', gap: 11, alignItems: 'center' }}>
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.accentDark,
      justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: C.accent, fontWeight: '900', fontSize: 11 }}>RC</Text>
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800' }}>Rider Comms</Text>
      <Text style={s.small}>Photos, Stories and Reels</Text>
    </View>
    <Ionicons name="chevron-forward" size={17} color={C.muted}/>
  </Pressable>;
}

const homeEditorial = [
  { post: brandPosts[0], source: require('../assets/editorial/coastal-motorcycle.jpg') },
  { post: brandPosts[1], source: require('../assets/editorial/city-sports-car.jpg') },
];

export function RiderBrandFeed({ onOpen }: { onOpen: () => void }) {
  return <View testID="home-starter-feed">
    {homeEditorial.map(({ post, source }) => <View key={post.id}
      style={{ borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 14 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={'Visit Rider Comms for ' + post.title}
        onPress={onOpen} style={{ minHeight: 54, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentDark,
          justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: C.accent, fontSize: 11, fontWeight: '900' }}>RC</Text>
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 14 }}>Rider Comms</Text>
          <Text style={s.small}>Editorial</Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={C.muted}/>
      </Pressable>
      <View style={{ width: '100%', aspectRatio: 1.15, overflow: 'hidden', backgroundColor: post.tone }}>
        <Image source={source} accessibilityLabel={post.alt} resizeMode="cover"
          style={{ width: '100%', height: '100%' }}/>
      </View>
      <View style={{ paddingHorizontal: 14, paddingTop: 11, gap: 5 }}>
        <Text style={{ color: C.ink, fontSize: 14, lineHeight: 20 }}>
          <Text style={{ fontWeight: '800' }}>Rider Comms</Text>{'  '}{post.caption}
        </Text>
        <Text style={s.small}>{post.credit}</Text>
      </View>
    </View>)}
  </View>;
}

export function RiderBrandPage({onBack,onStory,onReel}:{
  onBack:()=>void;onStory:()=>void;onReel:(id:string)=>void;
}) {
  const [tab,setTab]=useState<Tab>('Posts');
  const [detail,setDetail]=useState<EditorialPost|null>(null);
  const back=<Pressable accessibilityRole="button" accessibilityLabel={detail?'Back to Rider Comms page':'Close Rider Comms page'}
    onPress={detail?()=>setDetail(null):onBack} style={{flexDirection:'row',alignItems:'center',
      gap:9,minHeight:44}}>
    <Ionicons name="arrow-back" size={23} color={C.ink}/>
    <Text style={{color:C.ink,fontWeight:'800'}}>Rider Comms</Text>
  </Pressable>;
  if(detail) return <View testID="brand-post-detail" style={{gap:12,paddingBottom:35}}>
    {back}
    <Image accessibilityLabel={detail.alt} source={{uri:detail.imageUrl}}
      resizeMode="cover" style={{width:'100%',aspectRatio:4/5,borderRadius:12,
        backgroundColor:detail.tone}}/>
    <Text style={{color:C.ink,fontSize:19,fontWeight:'900'}}>{detail.title}</Text>
    <Text style={[s.body,{lineHeight:21}]}>{detail.caption}</Text>
    <Text style={[s.small,{lineHeight:17}]}>Photo: {detail.credit}</Text>
  </View>;
  const tabs:{name:Tab;icon:React.ComponentProps<typeof Ionicons>['name']}[]=[
    {name:'Posts',icon:'grid-outline'},{name:'Reels',icon:'play-outline'},
    {name:'Stories',icon:'ellipse-outline'}];
  return <View testID="rider-comms-brand-page" style={{gap:15,paddingBottom:25}}>
    {back}
    <View style={{flexDirection:'row',alignItems:'center',gap:15}}>
      <View style={{width:82,height:82,borderRadius:41,backgroundColor:'#193B34',
        borderWidth:2,borderColor:C.accent,alignItems:'center',justifyContent:'center'}}>
        <Text style={{fontSize:24,color:C.accent,fontWeight:'900'}}>RC</Text>
      </View>
      <View style={{flex:1,gap:5}}>
        <Text style={{color:C.ink,fontSize:23,fontWeight:'900',letterSpacing:-0.5}}>Rider Comms</Text>
        <Text style={[s.small,{fontSize:12}]}>@ridercomms</Text>
      </View>
    </View>
    <Text style={[s.body,{lineHeight:21}]}>For the ride. Cars, motorcycles and cycling in one place.</Text>
    <View style={{flexDirection:'row',gap:10}}>
      <Pressable accessibilityRole="button" accessibilityLabel="View Rider Comms stories"
        onPress={onStory} style={[s.cta,{flex:1,minHeight:46,borderRadius:12}]}>
        <Text style={s.ctaText}>Stories</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="View Rider Comms Reels"
        onPress={()=>onReel(brandReels[0].id)}
        style={[s.ghost,{flex:1,minHeight:46,borderRadius:12}]}>
        <Text style={s.ghostText}>Reels</Text>
      </Pressable>
    </View>
    <View accessibilityRole="tablist" accessibilityLabel="Rider Comms content" style={{flexDirection:'row',borderBottomWidth:1,borderColor:C.border}}>
      {tabs.map(item=><Pressable key={item.name} accessibilityRole="tab"
        accessibilityLabel={'Rider Comms '+item.name}
        aria-selected={tab===item.name} onPress={()=>setTab(item.name)}
        style={{flex:1,height:51,alignItems:'center',justifyContent:'center',
          borderBottomWidth:2,borderBottomColor:tab===item.name?C.ink:'transparent'}}>
        <Ionicons name={item.icon} size={24} color={tab===item.name?C.ink:C.muted}/>
      </Pressable>)}
    </View>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:3}}>
      {tab==='Posts'&&brandPosts.map(item=><Pressable key={item.id}
        accessibilityRole="button" accessibilityLabel={'View editorial photo '+item.title}
        onPress={()=>setDetail(item)} style={{width:'32.7%',aspectRatio:3/4,
          backgroundColor:item.tone}}>
        <Image source={{uri:item.imageUrl}} resizeMode="cover" accessibilityLabel={item.alt}
          style={{width:'100%',height:'100%'}}/>
      </Pressable>)}
      {tab==='Reels'&&brandReels.map(item=><Pressable key={item.id}
        accessibilityRole="button" accessibilityLabel={'View editorial Reel '+item.title}
        onPress={()=>onReel(item.id)} style={{width:'49%',aspectRatio:3/4,
          backgroundColor:item.theme}}>
        <Image source={{uri:item.imageUrl}} accessibilityLabel={item.title}
          resizeMode="cover" style={{width:'100%',height:'100%'}}/>
        <View style={{position:'absolute',bottom:0,left:0,right:0,
          backgroundColor:'#000000AA',padding:8,flexDirection:'row',gap:6}}>
          <Ionicons name="play-outline" size={18} color="#FFFFFF"/>
          <Text style={{color:'#FFFFFF',fontSize:11,flex:1}}>{item.title}</Text>
        </View>
      </Pressable>)}
      {tab==='Stories'&&brandStories.map(item=><Pressable key={item.id}
        accessibilityRole="button" accessibilityLabel={'View editorial story '+item.category}
        onPress={onStory} style={{width:'32.7%',aspectRatio:3/4,backgroundColor:item.color}}>
        <Image source={{uri:item.imageUrl}} accessibilityLabel={item.category}
          resizeMode="cover" style={{width:'100%',height:'100%'}}/>
      </Pressable>)}
    </View>
    <Text style={[s.small,{fontSize:11,lineHeight:17}]}>
      First-party showcase using licensed photos and videos.
      These aren't live user posts, genuine events or published Reels.
    </Text>
  </View>;
}
