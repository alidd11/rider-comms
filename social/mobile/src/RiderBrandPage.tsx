import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import { brandPosts, brandReels, brandStories } from './brandEditorial';
type Tab = 'Posts' | 'Reels' | 'Stories';
type EditorialPost = (typeof brandPosts)[number];

export function RiderBrandHome({ onOpen }: {onOpen:()=>void}) {
  const first=brandPosts[0];
  return <Pressable testID="brand-home-feature" accessibilityRole="button"
    accessibilityLabel="Open Rider Comms editorial page" onPress={onOpen}
    style={{marginHorizontal:15,marginTop:11,marginBottom:10,borderRadius:16,
      overflow:'hidden',backgroundColor:C.panel}}>
    <View style={{flexDirection:'row',gap:9,alignItems:'center',paddingHorizontal:13,paddingVertical:11}}>
      <View style={{width:30,height:30,borderRadius:15,backgroundColor:C.accentDark,
        justifyContent:'center',alignItems:'center'}}>
        <Text style={{color:C.accent,fontWeight:'900',fontSize:10}}>RC</Text>
      </View>
      <Text style={{flex:1,color:C.ink,fontSize:14,fontWeight:'800'}}>Rider Comms</Text>
      <Text style={[s.small,{fontSize:11}]}>Featured</Text>
      <Ionicons name="chevron-forward" size={17} color={C.muted}/>
    </View>
    <Image source={{uri:first.imageUrl}} resizeMode="cover" accessibilityLabel={first.alt}
      style={{width:'100%',height:245,backgroundColor:first.tone}}/>
    <View style={{padding:13,gap:5}}>
      <Text style={{color:C.ink,fontWeight:'900',fontSize:16}}>{first.title}</Text>
      <Text style={[s.small,{lineHeight:17}]}>Photos, Stories and Reels</Text>
    </View>
  </Pressable>;
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
    <View style={{flexDirection:'row',borderBottomWidth:1,borderColor:C.border}}>
      {tabs.map(item=><Pressable key={item.name} accessibilityRole="tab"
        accessibilityLabel={'Rider Comms '+item.name}
        accessibilityState={{selected:tab===item.name}} onPress={()=>setTab(item.name)}
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
      First-party showcase using licensed stock imagery and source clip previews.
      These aren't live user posts, genuine events or published Reels.
    </Text>
  </View>;
}
