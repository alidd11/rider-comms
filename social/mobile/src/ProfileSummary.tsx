import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import type { SocialProfileDraft } from './garage';
import type { ConnectionKind } from './ProfileConnectionsSheet';

export type ProfileContentTab = 'Posts' | 'Reels' | 'Garage';

export function ProfileSummary({
  profile, tab, username, friendCount, followingCount, onTab, onConnections, onEdit,
}: {
  profile: SocialProfileDraft;
  username: string;
  friendCount: number;
  tab: ProfileContentTab;
  followingCount: number;
  onTab: (next: ProfileContentTab) => void;
  onConnections: (kind: ConnectionKind) => void;
  onEdit: () => void;
}) {
  const stats: { name: string; value: string; label: string; action: () => void }[] = [
    {name:'View posts',value:'0',label:'Posts',action:()=>onTab('Posts')},
    {name:'View followers',value:'—',label:'Followers',action:()=>onConnections('Followers')},
    {name:'View following',value:String(followingCount),label:'Following',action:()=>onConnections('Following')},
    {name:'View friends',value:String(friendCount),label:'Friends',action:()=>onConnections('Friends')},
  ];
  const tabs: { name: ProfileContentTab; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    {name:'Posts',icon:'grid-outline'},
    {name:'Reels',icon:'play-outline'},
    {name:'Garage',icon:'car-sport-outline'},
  ];
  return <View testID="social-profile-summary" style={{ gap: 15 }}>
    <View style={s.rowBetween}>
      <Text style={s.sectionTitle}>Profile</Text>
      <View style={[s.row,{gap:5}]}>
        <Ionicons name={profile.visibility==='private'?'lock-closed-outline':'earth-outline'}
          color={C.accent} size={16}/>
        <Text style={[s.small,{color:C.accent}]}>
          {profile.visibility==='private'?'Private':'Public · preview'}
        </Text>
      </View>
    </View>
    <View style={{paddingHorizontal:2,gap:15}}>
      <View style={[s.rowBetween,{gap:11}]}>
        <View style={{
          width:77,height:77,borderRadius:39,borderWidth:2,borderColor:C.border,
          backgroundColor:C.accentDark,alignItems:'center',justifyContent:'center',
        }}><Ionicons name="person-outline" color={C.accent} size={35}/></View>
        <View style={[s.row,{flex:1,justifyContent:'space-between',gap:3}]}>
          {stats.map(stat=><Pressable key={stat.name} accessibilityRole="button"
            accessibilityLabel={stat.name} onPress={stat.action}
            style={{flex:1,alignItems:'center',gap:5,minHeight:48,justifyContent:'center'}}>
            <Text style={{color:C.ink,fontWeight:'900',fontSize:17}}>{stat.value}</Text>
            <Text style={{color:C.muted,fontWeight:'700',fontSize:11}}>{stat.label}</Text>
          </Pressable>)}
        </View>
      </View>
      <View style={{gap:4}}>
        <Text style={{color:C.ink,fontWeight:'900',fontSize:17}}>{profile.displayName}</Text>
        <Text style={s.small}>@{username.replace(/^@/, '')} · Rider Comms account</Text>
        {profile.bio ? <Text style={s.body}>{profile.bio}</Text> : null}
      </View>
      <View style={[s.row,{gap:10}]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit social profile"
          onPress={onEdit} style={[s.ghost,{flex:1,minHeight:42,paddingVertical:9}]}>
          <Text style={s.ghostText}>Edit profile</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Profile privacy settings"
          onPress={onEdit} style={[s.ghost,{minHeight:42,minWidth:49,paddingVertical:9}]}>
          <Ionicons name="settings-outline" color={C.ink} size={20}/>
        </Pressable>
      </View>
    </View>
    <View style={{
      flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderColor:C.border,
    }}>
      {tabs.map(item=><Pressable key={item.name} accessibilityRole="tab"
        accessibilityLabel={item.name+' profile tab'}
        accessibilityState={{selected:tab===item.name}} onPress={()=>onTab(item.name)}
        style={{
          flex:1,minHeight:49,justifyContent:'center',alignItems:'center',
          borderBottomWidth:2,borderBottomColor:tab===item.name?C.accent:'transparent',
        }}>
        <Ionicons name={item.icon} color={tab===item.name?C.accent:C.muted} size={23}/>
      </Pressable>)}
    </View>
  </View>;
}
