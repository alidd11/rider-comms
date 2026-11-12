import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, s } from './styles';
import {
  MAX_CAPTION, moveMedia, parseTextDraft, validateDraft, validateMedia,
} from './upload';
import type { Audience, ComposerDraft, ComposerMedia, ComposerMode } from './upload';

type Step = 'choose' | 'edit' | 'review';
type Topic = ComposerDraft['category'];
const DRAFT_KEY = '@rider-comms/social/create-text-draft-v1';
const formats: ComposerMode[] = ['Post', 'Story', 'Reel'];
const topics: { value: Topic; label: string }[] = [
  {value:'cars',label:'Cars'}, {value:'motorcycles',label:'Motorcycles'}, {value:'cycling',label:'Cycling'}
];
const audiences: { value: Audience; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  {value:'private',label:'Only me',icon:'lock-closed-outline'},
  {value:'followers',label:'Followers',icon:'people-outline'},
  {value:'public',label:'Everyone',icon:'earth-outline'},
];

function MediaVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView style={{ width:'100%', height: 230, backgroundColor:'#020408', borderRadius:13 }}
    player={player} nativeControls contentFit="contain"/>;
}

function PreviewMedia({ item }: { item: ComposerMedia }) {
  if (item.kind === 'video') return <MediaVideo uri={item.uri}/>;
  return <Image source={{uri:item.uri}} resizeMode="contain"
    accessibilityLabel={'Selected photo: '+item.fileName}
    style={{width:'100%',height:230,backgroundColor:'#050A10',borderRadius:13}}/>;
}

function Choice({ title, selected, onPress }: {title:string;selected:boolean;onPress:()=>void}) {
  return <Pressable accessibilityRole="button" accessibilityState={{selected}}
    onPress={onPress} style={[s.pill,selected&&s.pillActive]}>
    <Text style={[s.pillText,selected&&s.pillTextActive]}>{title}</Text>
  </Pressable>;
}

export function CreateComposer({ initialMode = 'Post' }: { initialMode?: ComposerMode }) {
  const [mode,setMode]=useState<ComposerMode>(initialMode);
  const [step,setStep]=useState<Step>('choose');
  const [media,setMedia]=useState<ComposerMedia[]>([]);
  const [caption,setCaption]=useState('');
  const [category,setCategory]=useState<Topic>('motorcycles');
  const [audience,setAudience]=useState<Audience>('private');
  const [status,setStatus]=useState<string | null>(null);
  const [selecting,setSelecting]=useState(false);
  const [draftLoaded,setDraftLoaded]=useState(false);

  useEffect(()=>{
    let active=true;
    AsyncStorage.getItem(DRAFT_KEY).then(raw=>{
      if(!active||!raw)return;
      const restored=parseTextDraft(JSON.parse(raw) as unknown);
      if(restored) {
        setCaption(restored.caption);
        setCategory(restored.category);
        setAudience(restored.audience);
        setStatus('Text draft restored. Select media again.');
      }
    }).catch(()=>{}).finally(()=>{if(active)setDraftLoaded(true);});
    return ()=>{active=false;};
  },[]);

  function changeMode(next:ComposerMode) {
    if(mode===next)return;
    setMode(next);
    setMedia([]);
    setStep('choose');
    setStatus(null);
  }

  async function openPicker(camera=false) {
    if(selecting)return;
    setSelecting(true);
    setStatus(null);
    try {
      const pickOptions: ImagePicker.ImagePickerOptions = {
        mediaTypes: mode==='Reel' ? ['videos'] : ['images','videos'],
        allowsMultipleSelection: !camera && mode==='Post',
        selectionLimit: mode==='Post' ? 6 : 1,
        quality: 0.85,
      };
      // Call directly inside the button interaction (required on Safari Web).
      const result = camera
        ? await ImagePicker.launchCameraAsync({mediaTypes:pickOptions.mediaTypes,quality:0.85})
        : await ImagePicker.launchImageLibraryAsync(pickOptions);
      if(result.canceled||!result.assets?.length)return;
      const selection:ComposerMedia[]=result.assets.map((asset,i)=>({
        id: String(Date.now())+'-'+String(i),
        uri: asset.uri,
        kind: asset.type==='video' ? 'video' : 'image',
        fileName: asset.fileName || 'Selected '+(asset.type==='video'?'video':'image'),
        ...(asset.mimeType ? {mimeType:asset.mimeType} : {}),
        ...(typeof asset.fileSize==='number' ? {fileSize:asset.fileSize} : {}),
        width:asset.width,height:asset.height,
      }));
      const next = mode==='Post' ? [...media,...selection] : selection;
      const resultCheck=validateMedia(mode,next);
      if(!resultCheck.ok){setStatus(resultCheck.error);return;}
      setMedia(resultCheck.value);
      setStep('edit');
    } catch {
      setStatus('Could not access media. Check permissions and try again.');
    } finally {
      setSelecting(false);
    }
  }

  function nextStep(){
    const valid=validateDraft({mode,caption,audience,category,media});
    if(!valid.ok){setStatus(valid.error);return;}
    setStatus(null);
    setStep('review');
  }

  async function saveTextDraft() {
    const text={mode,caption,audience,category};
    try {
      await AsyncStorage.setItem(DRAFT_KEY,JSON.stringify(text));
      setStatus('Text draft saved on this device. Media is not saved; select it again next time.');
    } catch {
      setStatus('Unable to save the draft on this device.');
    }
  }

  function clearDraft() {
    setMedia([]);
    setCaption('');
    setAudience('private');
    setStep('choose');
    setStatus('Cleared from this editing session.');
  }

  return <View style={{flex:1,backgroundColor:C.bg}}>
    <View style={{paddingHorizontal:18,paddingVertical:12,borderBottomWidth:1,borderColor:C.border,gap:9}}>
      <View style={s.rowBetween}>
        <Text style={s.sectionTitle}>Create</Text>
        <View style={s.row}><Ionicons name="lock-closed-outline" color={C.accent} size={15}/><Text style={[s.small,{color:C.accent}]}>Private preview</Text></View>
      </View>
      <View style={[s.row,{flexWrap:'wrap'}]}>
        {formats.map(type=><Choice key={type} title={type} selected={mode===type} onPress={()=>changeMode(type)}/>)}
      </View>
      <View style={[s.row,{gap:6}]}>
        {(['choose','edit','review'] as const).map((name,i)=><View key={name}
          style={{flex:1,height:3,borderRadius:3,backgroundColor:step===name||(['choose','edit','review'].indexOf(step)>i)?C.accent:C.border}}/>)}
      </View>
    </View>
    <ScrollView testID="composer-scroll" nativeID="composer-scroll" style={{flex:1}} contentContainerStyle={{paddingHorizontal:18,paddingVertical:17,paddingBottom:28,gap:17}}
      keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {status ? <View style={{padding:12,backgroundColor:C.accentDark,borderRadius:12}}>
        <Text accessibilityRole="alert" style={{color:'#CBF4E7',fontSize:13,lineHeight:19}}>{status}</Text>
      </View> : null}

      {step==='choose' ? <>
        <View style={{gap:6}}>
          <Text style={s.title}>{mode==='Post'?'New post':mode==='Story'?'New story':'New Reel'}</Text>
          <Text style={s.muted}>{mode==='Reel'?'Choose a video':mode==='Story'?'Choose a photo or video':'Choose up to six photos or videos'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose from library" disabled={selecting}
          onPress={()=>void openPicker()} style={{minHeight:190,backgroundColor:C.panel,borderWidth:1,borderStyle:'dashed',borderColor:C.accent,borderRadius:20,justifyContent:'center',alignItems:'center',gap:12,padding:20}}>
          <Ionicons name="images-outline" color={C.accent} size={38}/>
          <Text style={s.cardHeading}>{selecting?'Opening library…':'Choose from library'}</Text>
          <Text style={[s.small,{textAlign:'center'}]}>Photos and videos stay on your device until you choose to publish.</Text>
        </Pressable>
        {Platform.OS!=='web' ? <Pressable accessibilityRole="button" accessibilityLabel="Use camera"
          onPress={()=>void openPicker(true)} style={s.ghost}>
          <View style={s.row}><Ionicons name="camera-outline" color={C.ink} size={21}/><Text style={s.ghostText}>Camera</Text></View>
        </Pressable> : null}
        {media.length ? <Pressable accessibilityRole="button" style={s.cta} onPress={()=>setStep('edit')}>
          <Text style={s.ctaText}>Continue with {media.length} file{media.length===1?'':'s'}</Text>
        </Pressable> : null}
      </> : null}

      {step==='edit' ? <>
        <View style={s.rowBetween}>
          <Text style={s.cardHeading}>Edit {mode.toLowerCase()}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to media selection" onPress={()=>setStep('choose')}>
            <Text style={{color:C.accent,fontWeight:'800'}}>Change media</Text>
          </Pressable>
        </View>
        {media.map((item,index)=><View key={item.id} style={[s.card,{padding:10,gap:10}]}>
          <PreviewMedia item={item}/>
          <View style={s.rowBetween}>
            <View style={{flex:1}}><Text numberOfLines={1} style={s.cardHeading}>{item.fileName}</Text>
              <Text style={s.small}>{item.kind==='video'?'Video':'Photo'} {item.fileSize ? '· '+Math.ceil(item.fileSize/1024/1024)+' MB' : ''}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={'Remove media '+String(index+1)}
              onPress={()=>{setMedia(list=>{const updated=list.filter(x=>x.id!==item.id);if(!updated.length)setStep('choose');return updated;});}}>
              <Ionicons name="trash-outline" size={21} color="#E39F9F"/>
            </Pressable>
          </View>
          {media.length>1 ? <View style={s.row}>
            <Pressable accessibilityRole="button" accessibilityLabel={'Move media '+String(index+1)+' earlier'} disabled={index===0}
              onPress={()=>setMedia(list=>moveMedia(list,item.id,-1))} style={[s.ghost,index===0&&{opacity:0.35}]}>
              <Ionicons name="arrow-back" color={C.ink} size={16}/>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={'Move media '+String(index+1)+' later'} disabled={index===media.length-1}
              onPress={()=>setMedia(list=>moveMedia(list,item.id,1))} style={[s.ghost,index===media.length-1&&{opacity:0.35}]}>
              <Ionicons name="arrow-forward" color={C.ink} size={16}/>
            </Pressable>
          </View> : null}
        </View>)}
        <View style={{gap:7}}>
          <Text style={s.cardHeading}>Caption</Text>
          <TextInput accessibilityLabel="Create caption" value={caption} onChangeText={setCaption} multiline
            maxLength={MAX_CAPTION} placeholder="Tell the story behind it…" placeholderTextColor={C.muted}
            style={[s.input,{minHeight:92,textAlignVertical:'top'}]}/>
          <Text style={[s.small,{alignSelf:'flex-end'}]}>{caption.length} / {MAX_CAPTION}</Text>
        </View>
        <View style={{gap:9}}>
          <Text style={s.cardHeading}>Community</Text>
          <View style={[s.row,{flexWrap:'wrap'}]}>{topics.map(({value,label})=>
            <Choice key={value} title={label} selected={category===value} onPress={()=>setCategory(value)}/>)}</View>
        </View>
        <View style={{gap:9}}>
          <Text style={s.cardHeading}>Who can see it?</Text>
          <View style={[s.row,{flexWrap:'wrap'}]}>
            {audiences.map(item=><Choice key={item.value} title={item.label} selected={audience===item.value} onPress={()=>setAudience(item.value)}/>)}
          </View>
          <Text style={s.small}>Visibility is a preview setting until account access is connected.</Text>
        </View>
        <View style={s.rowBetween}>
          <Pressable accessibilityRole="button" accessibilityLabel="Save text draft" onPress={()=>void saveTextDraft()} style={s.ghost}>
            <Text style={s.ghostText}>Save text draft</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Review post" onPress={nextStep} style={s.cta}>
            <Text style={s.ctaText}>Review</Text>
          </Pressable>
        </View>
      </> : null}

      {step==='review' ? <>
        <View style={s.rowBetween}><Text style={s.title}>Review</Text><Text style={[s.small,{color:C.accent}]}>Not published</Text></View>
        {media.map(item=><PreviewMedia key={item.id} item={item}/>)}
        <Text style={s.body}>{caption.trim()||'No caption'}</Text>
        <View style={[s.card,s.pad]}>
          <Text style={s.small}>FORMAT · {mode.toUpperCase()}</Text>
          <Text style={s.small}>COMMUNITY · {category.toUpperCase()}</Text>
          <Text style={s.small}>VISIBILITY · {audiences.find(a=>a.value===audience)?.label}</Text>
        </View>
        <View style={[s.card,s.pad,{backgroundColor:C.accentDark}]}>
          <View style={s.row}><Ionicons name="shield-checkmark-outline" color={C.accent} size={21}/><Text style={s.cardHeading}>Ready for backend integration</Text></View>
          <Text style={s.muted}>Your selected media is local. Publishing will open only after login, upload security and moderation are implemented.</Text>
        </View>
        <View style={s.rowBetween}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to edit" onPress={()=>setStep('edit')} style={s.ghost}><Text style={s.ghostText}>Back to edit</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save text draft" onPress={()=>void saveTextDraft()} style={s.cta}><Text style={s.ctaText}>Save text draft</Text></Pressable>
        </View>
      </> : null}
      {step!=='review' && (caption.trim()||media.length>0) ? <Pressable accessibilityRole="button" accessibilityLabel="Clear composer"
        onPress={clearDraft}><Text style={[s.small,{textAlign:'center',color:C.muted}]}>Clear selection</Text></Pressable> : null}
      {draftLoaded ? null : <Text style={s.small}>Loading local draft…</Text>}
    </ScrollView>
  </View>;
}
