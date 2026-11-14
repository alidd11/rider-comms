import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import type { SocialProfileDraft } from './garage';
import type { ConnectionKind } from './ProfileConnectionsSheet';
import type { RiderProfile } from './authClient';
import { handleWithAt } from './identityDisplay';
import { IdentityAvatar } from './IdentityAvatar';

export type ProfileContentTab = 'Posts' | 'Reels' | 'Garage';

export function ProfileSummary({
  profile, accountProfile, username, tab, friendCount, followingCount, onTab, onConnections, onEdit, onSettings,
}: {
  profile: SocialProfileDraft;
  accountProfile: RiderProfile | null;
  username: string;
  friendCount: number;
  tab: ProfileContentTab;
  followingCount: number;
  onTab: (next: ProfileContentTab) => void;
  onConnections: (kind: ConnectionKind) => void;
  onEdit: () => void;
  onSettings: () => void;
}) {
  const stats: { name: string; value: string; label: string; action: () => void }[] = [
    {name:'View posts',value:'0',label:'Posts',action:()=>onTab('Posts')},
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
      <Text style={[s.sectionTitle,{fontSize:19}]}>{handleWithAt(accountProfile?.handle || username)}</Text>
      <View style={[s.row,{gap:5,backgroundColor:C.panel,borderRadius:999,
        paddingHorizontal:11,paddingVertical:7}]}>
        <Ionicons name="lock-closed-outline" color={C.muted} size={14}/>
        <Text style={[s.small,{fontSize:11,fontWeight:'700'}]}>Private preview</Text>
      </View>
    </View>
    <View style={{paddingHorizontal:2,gap:16}}>
      <View style={[s.rowBetween,{gap:13}]}>
        <View style={{borderWidth:2,borderColor:'#396B5F',borderRadius:48,padding:3}}>
          <IdentityAvatar name={accountProfile?.displayName || username} size={78}/>
        </View>
        <View style={[s.row,{flex:1,justifyContent:'space-between',gap:3}]}>
          {stats.map(stat=><Pressable key={stat.name} accessibilityRole="button"
            accessibilityLabel={stat.name} onPress={stat.action}
            style={{flex:1,alignItems:'center',gap:4,minHeight:58,justifyContent:'center'}}>
            <Text style={{color:C.ink,fontWeight:'900',fontSize:20,letterSpacing:-0.5}}>{stat.value}</Text>
            <Text style={{color:C.muted,fontWeight:'600',fontSize:11}}>{stat.label}</Text>
          </Pressable>)}
        </View>
      </View>
      <View style={{gap:4}}>
        <Text style={{color:C.ink,fontWeight:'900',fontSize:18,letterSpacing:-0.3}}>{accountProfile?.displayName || username}</Text>
        {profile.bio ? <Text style={s.body}>{profile.bio}</Text> : null}
      </View>
      <View style={[s.row,{gap:10}]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit social profile"
          onPress={onEdit} style={[s.ghost,{flex:1,minHeight:46,paddingVertical:9,backgroundColor:'#252B33'}]}>
          <Text style={s.ghostText}>Edit profile</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open settings and privacy"
          onPress={onSettings} style={[s.ghost,{minHeight:46,minWidth:49,paddingVertical:9,backgroundColor:'#252B33'}]}>
          <Ionicons name="settings-outline" color={C.ink} size={20}/>
        </Pressable>
      </View>
    </View>
    <View style={{
      flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderColor:C.border,
      borderTopWidth:1,paddingTop:3,
    }}>
      {tabs.map(item=><Pressable key={item.name} accessibilityRole="tab"
        accessibilityLabel={item.name+' profile tab'}
        accessibilityState={{selected:tab===item.name}} onPress={()=>onTab(item.name)}
        style={{
          flex:1,minHeight:56,justifyContent:'center',alignItems:'center',
          gap:3,borderBottomWidth:2,borderBottomColor:tab===item.name?C.ink:'transparent',
        }}>
        <Ionicons name={item.icon} color={tab===item.name?C.ink:C.muted} size={22}/>
        <Text style={{color:tab===item.name?C.ink:C.muted,
          fontSize:12,fontWeight:tab===item.name?'800':'600'}}>{item.name}</Text>
      </Pressable>)}
    </View>
  </View>;
}
