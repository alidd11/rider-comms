import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { VideoView, useVideoPlayer } from 'expo-video';
import { CameraCapture } from './CameraCapture';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, s } from './styles';
import { cropRect } from './imageEdit';
import type { AspectPreset } from './imageEdit';
import { MAX_CAPTION, moveMedia, parseTextDraft, validateDraft, validateMedia } from './upload';
import type { Audience, ComposerDraft, ComposerMedia, ComposerMode } from './upload';

type Stage = 'select' | 'edit' | 'share';
type Topic = ComposerDraft['category'];
const DRAFT_KEY = '@rider-comms/social/create-text-draft-v1';
const formats: ComposerMode[] = ['Post', 'Story', 'Reel'];
const topics: { value: Topic; label: string }[] = [
  { value: 'cars', label: 'Cars' },
  { value: 'motorcycles', label: 'Motorcycles' },
  { value: 'cycling', label: 'Cycling' },
];
const audiences: { value: Audience; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { value: 'private', label: 'Only me', icon: 'lock-closed-outline' },
  { value: 'followers', label: 'Followers', icon: 'people-outline' },
  { value: 'public', label: 'Everyone', icon: 'earth-outline' },
];
const ratios: { value: AspectPreset; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'square', label: '1:1' },
  { value: 'portrait', label: '4:5' },
  { value: 'vertical', label: '9:16' },
];

function VideoCanvas({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls contentFit="contain"
    style={{ flex: 1, width: '100%', backgroundColor: '#020408' }} />;
}

function MediaCanvas({ item }: { item: ComposerMedia }) {
  if (item.kind === 'video') return <VideoCanvas uri={item.uri}/>;
  return <Image source={{ uri: item.uri }} resizeMode="contain"
    accessibilityLabel={'Selected photo: ' + item.fileName}
    style={{ flex: 1, width: '100%', backgroundColor: '#020408' }} />;
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
    onPress={onPress} style={[s.pill, selected && s.pillActive, { paddingVertical: 8, paddingHorizontal: 13 }]}>
    <Text style={[s.pillText, selected && s.pillTextActive]}>{label}</Text>
  </Pressable>;
}

function Tool({ icon, label, onPress, disabled = false }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={{ minWidth: 54, minHeight: 46, opacity: disabled ? 0.3 : 1, gap: 3,
      alignItems: 'center', justifyContent: 'center' }}>
    <Ionicons name={icon} size={22} color={C.ink}/>
    <Text style={{ color: C.muted, fontSize: 10, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
}

export function CreateComposer({ initialMode = 'Post' }: { initialMode?: ComposerMode }) {
  const [mode, setMode] = useState<ComposerMode>(initialMode);
  const [stage, setStage] = useState<Stage>('select');
  const [media, setMedia] = useState<ComposerMedia[]>([]);
  const [active, setActive] = useState(0);
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState<Topic>('motorcycles');
  const [audience, setAudience] = useState<Audience>('private');
  const [status, setStatus] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ratio, setRatio] = useState<AspectPreset>('original');
  const originals = useRef<Record<string, ComposerMedia>>({});

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(DRAFT_KEY).then(raw => {
      if (!mounted || !raw) return;
      const restored = parseTextDraft(JSON.parse(raw) as unknown);
      if (restored) {
        setCaption(restored.caption);
        setCategory(restored.category);
        setAudience(restored.audience);
        setStatus('Text draft restored. Select media again.');
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const selected = media[active] ?? null;
  const isVideo = selected?.kind === 'video';
  const allowedMore = mode === 'Post' && media.length < 6;

  function changeMode(next: ComposerMode) {
    if (mode === next) return;
    setMode(next);
    setStage('select');
    setMedia([]);
    setActive(0);
    setRatio('original');
    originals.current = {};
    setStatus(null);
  }

  // Safari requires the picker to open immediately after a direct user tap.
  async function chooseMedia(camera = false) {
    if (selecting || processing) return;
    setSelecting(true);
    setStatus(null);
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: mode === 'Reel' ? ['videos'] : ['images', 'videos'],
        allowsMultipleSelection: !camera && mode === 'Post',
        selectionLimit: mode === 'Post' ? Math.max(1, 6 - media.length) : 1,
        quality: 0.9,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: options.mediaTypes, quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.length) return;
      const stamp = Date.now();
      const incoming: ComposerMedia[] = result.assets.map((asset, i) => ({
        id: String(stamp) + '-' + String(i),
        uri: asset.uri,
        kind: asset.type === 'video' ? 'video' : 'image',
        fileName: asset.fileName || (asset.type === 'video' ? 'Video' : 'Photo'),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
        ...(typeof asset.fileSize === 'number' ? { fileSize: asset.fileSize } : {}),
        width: asset.width,
        height: asset.height,
      }));
      const next = mode === 'Post' ? [...media, ...incoming] : incoming;
      const validation = validateMedia(mode, next);
      if (!validation.ok) { setStatus(validation.error); return; }
      for (const item of incoming) originals.current[item.id] = item;
      setMedia(validation.value);
      setActive(mode === 'Post' ? Math.max(0, media.length) : 0);
      setRatio('original');
      setStage('edit');
    } catch {
      setStatus('Could not open your media library. Check permissions and try again.');
    } finally {
      setSelecting(false);
    }
  }

  function captureFromCamera(item: Omit<ComposerMedia, 'id'>) {
    const now = Date.now();
    const added: ComposerMedia = { ...item, id: 'camera-' + String(now) };
    const next = mode === 'Post' ? [...media, added] : [added];
    const validated = validateMedia(mode, next);
    if (!validated.ok) { setStatus(validated.error); return; }
    originals.current[added.id] = added;
    setMedia(validated.value);
    setActive(next.length - 1);
    setRatio('original');
    setStatus(null);
    setStage('edit');
  }

  function removeSelected() {
    if (!selected) return;
    delete originals.current[selected.id];
    const next = media.filter(item => item.id !== selected.id);
    setMedia(next);
    setActive(current => Math.max(0, Math.min(current, next.length - 1)));
    setRatio('original');
    if (!next.length) setStage('select');
  }

  async function editImage(operation: { ratio: AspectPreset } | { rotate: true }) {
    if (!selected || selected.kind !== 'image' || processing) return;
    const currentId = selected.id;
    const base = originals.current[currentId] ?? selected;
    setProcessing(true);
    setStatus(null);
    try {
      if ('ratio' in operation && operation.ratio === 'original') {
        setMedia(list => list.map(item => item.id === currentId ? base : item));
        setRatio('original');
        return;
      }
      const actions: ImageManipulator.Action[] = [];
      if ('rotate' in operation) {
        actions.push({ rotate: 90 });
      } else {
        const rect = cropRect(base.width ?? 0, base.height ?? 0, operation.ratio);
        if (!rect) { setStatus('Image dimensions are unavailable for cropping.'); return; }
        actions.push({ crop: rect });
      }
      const updated = await ImageManipulator.manipulateAsync(base.uri, actions, {
        compress: 0.92, format: ImageManipulator.SaveFormat.JPEG,
      });
      const newItem: ComposerMedia = {
        ...selected, uri: updated.uri,
        mimeType: 'image/jpeg', fileName: selected.fileName.replace(/\.[^.]+$/, '') + '-edit.jpg',
        width: updated.width, height: updated.height, fileSize: undefined,
      };
      setMedia(list => list.map(item => item.id === currentId ? newItem : item));
      if ('rotate' in operation) {
        originals.current[currentId] = newItem;
        setRatio('original');
        setStatus('Photo rotated.');
      } else {
        setRatio(operation.ratio);
        setStatus('Photo cropped to ' + operation.ratio + '.');
      }
    } catch {
      setStatus('Photo editing failed. Your original image is unchanged.');
    } finally {
      setProcessing(false);
    }
  }

  function continueToShare() {
    const result = validateDraft({ mode, caption, audience, category, media });
    if (!result.ok) { setStatus(result.error); return; }
    setStatus(null);
    setStage('share');
  }

  async function saveTextDraft() {
    try {
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ mode, caption, category, audience }));
      setStatus('Text draft saved. Photos and videos are not saved; select them again next time.');
    } catch {
      setStatus('Text draft could not be saved on this device.');
    }
  }

  function back() {
    setStatus(null);
    if (stage === 'share') setStage('edit');
    else if (stage === 'edit') setStage('select');
    else if (media.length || caption) setStatus('Use Clear to discard this draft.');
  }

  const composerTitle = stage === 'share' ? 'New ' + mode.toLowerCase() :
    stage === 'edit' ? 'Edit ' + mode.toLowerCase() : 'New ' + mode.toLowerCase();

  return <View testID="create-studio" style={{ flex: 1, minHeight: 0, backgroundColor: C.bg }}>
    <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border }}>
      <View style={s.rowBetween}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back in composer" onPress={back}
          style={{ minWidth: 38, minHeight: 40, justifyContent: 'center' }}>
          <Ionicons name="arrow-back" size={24} color={C.ink}/>
        </Pressable>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={{ color: C.ink, fontSize: 17, fontWeight: '900' }}>{composerTitle}</Text>
          <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>PRIVATE PREVIEW</Text>
        </View>
        {stage === 'edit'
          ? <Pressable accessibilityRole="button" accessibilityLabel="Review post" disabled={processing}
              onPress={continueToShare} style={{ minWidth: 48, minHeight: 40, justifyContent: 'center', alignItems: 'flex-end' }}>
              <Text style={{ color: C.accent, fontSize: 15, fontWeight: '900' }}>Next</Text>
            </Pressable>
          : <View style={{ width: 48 }}/>}
      </View>
    </View>
    {status ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss composer notice"
      onPress={() => setStatus(null)} style={{
        paddingHorizontal: 15, paddingVertical: 10, backgroundColor: C.accentDark,
        borderBottomWidth: 1, borderColor: '#306F61',
      }}>
      <Text accessibilityRole="alert" style={{ color: '#C9F8E9', fontSize: 12 }}>{status}</Text>
    </Pressable> : null}

    {stage === 'select' ? <>
      <CameraCapture mode={mode} disabled={selecting || processing}
        onCapture={captureFromCamera} onLibrary={() => void chooseMedia()}/>
      <View style={{
        borderTopWidth: 1, borderColor: C.border,
        paddingHorizontal: 15, paddingVertical: 9, gap: 8, backgroundColor: C.bg,
      }}>
        {media.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Continue editing"
          onPress={() => setStage('edit')} style={{ alignItems: 'center', paddingVertical: 7 }}>
          <Text style={{ color: C.accent, fontSize: 12, fontWeight: '800' }}>
            Continue editing ({media.length})
          </Text>
        </Pressable> : null}
        <View style={[s.row, { justifyContent: 'center', gap: 26 }]}>
          {formats.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={item + ' format'}
            accessibilityState={{ selected: mode === item }} onPress={() => changeMode(item)}
            style={{ paddingVertical: 7, borderBottomWidth: 2, borderBottomColor: mode === item ? C.accent : 'transparent' }}>
            <Text style={{ color: mode === item ? C.ink : C.muted, fontWeight: '900', fontSize: 14 }}>{item}</Text>
          </Pressable>)}
        </View>
      </View>
    </> : null}

    {stage === 'edit' && selected ? <>
      <View testID="media-edit-canvas" style={{ flex: 1, minHeight: 140, backgroundColor: '#020408', position: 'relative' }}>
        <MediaCanvas key={selected.id + selected.uri} item={selected}/>
        <View style={{ position: 'absolute', top: 13, left: 13, paddingHorizontal: 9, paddingVertical: 6,
          backgroundColor: 'rgba(5,9,12,0.72)', borderRadius: 8 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{active + 1} / {media.length}</Text>
        </View>
      </View>
      <View style={{ paddingTop: 10, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.bg, gap: 9 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 13, alignItems: 'center', gap: 8 }}>
          {media.map((item, i) => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={'Select media ' + String(i + 1)} onPress={() => { setActive(i); setRatio('original'); }}
            style={{ width: 58, height: 68, borderRadius: 9, overflow: 'hidden', borderWidth: 2,
              borderColor: active === i ? C.accent : C.border, backgroundColor: C.panel }}>
            {item.kind === 'image' ? <Image source={{ uri: item.uri }} resizeMode="cover"
              style={{ width: '100%', height: '100%' }}/> :
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="videocam" color={C.ink} size={23}/>
              </View>}
          </Pressable>)}
          {allowedMore ? <Pressable accessibilityRole="button" accessibilityLabel="Add more media"
            onPress={() => void chooseMedia()} style={{ width: 54, height: 68,
              borderRadius: 9, borderWidth: 1, borderColor: C.border,
              justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="add" color={C.accent} size={26}/>
          </Pressable> : null}
        </ScrollView>
        {selected.kind === 'image' ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center', gap: 6 }}>
          {ratios.filter(item => mode === 'Post' || item.value === 'original' || item.value === 'vertical')
            .map(item => <Option key={item.value} label={item.label} selected={ratio === item.value}
              onPress={() => void editImage({ ratio: item.value })}/>)}
        </ScrollView> : <Text style={{ color: C.muted, fontSize: 12, paddingHorizontal: 16 }}>
          Video preview · trim and audio editing not yet available
        </Text>}
        <View style={[s.row, { justifyContent: 'space-around', paddingBottom: 10, flexWrap: 'wrap' }]}>
          {media.length > 1 ? <>
            <Tool icon="arrow-back-outline" label="Earlier" disabled={active === 0}
              onPress={() => {
                setMedia(list => moveMedia(list, selected.id, -1));
                setActive(index => Math.max(0, index - 1));
              }}/>
            <Tool icon="arrow-forward-outline" label="Later" disabled={active === media.length - 1}
              onPress={() => {
                setMedia(list => moveMedia(list, selected.id, 1));
                setActive(index => Math.min(media.length - 1, index + 1));
              }}/>
          </> : null}
          <Tool icon="refresh-outline" label="Rotate" onPress={() => void editImage({ rotate: true })}
            disabled={isVideo || processing}/>
          <Tool icon="trash-outline" label="Remove" onPress={removeSelected}/>
          <Tool icon="images-outline" label="Library" onPress={() => void chooseMedia()} disabled={selecting || !allowedMore}/>
          <Tool icon="bookmark-outline" label="Draft" onPress={() => void saveTextDraft()}/>
        </View>
      </View>
    </> : null}

    {stage === 'share' ? <>
      <ScrollView nativeID="composer-scroll" testID="composer-scroll" style={{ flex: 1, minHeight: 0 }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 24 }}>
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <View style={{ width: 100, height: 142, backgroundColor: '#020408', borderRadius: 12, overflow: 'hidden' }}>
            {media[0]?.kind === 'image' ? <Image source={{ uri: media[0].uri }}
              style={{ width: '100%', height: '100%' }} resizeMode="cover"/> :
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="videocam-outline" color={C.ink} size={31}/>
              </View>}
          </View>
          <TextInput accessibilityLabel="Create caption" multiline value={caption}
            maxLength={MAX_CAPTION} onChangeText={setCaption}
            placeholder="Write a caption…" placeholderTextColor={C.muted}
            style={{ flex: 1, color: C.ink, fontSize: 15, paddingVertical: 5, minHeight: 130, textAlignVertical: 'top' }}/>
        </View>
        <Text style={[s.small, { alignSelf: 'flex-end' }]}>{caption.length} / {MAX_CAPTION}</Text>
        <View style={{ height: 1, backgroundColor: C.border }}/>
        <View style={{ gap: 11 }}>
          <Text style={s.cardHeading}>Community</Text>
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            {topics.map(item => <Option key={item.value} label={item.label}
              selected={category === item.value} onPress={() => setCategory(item.value)}/>)}
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: C.border }}/>
        <View style={{ gap: 12 }}>
          <Text style={s.cardHeading}>Audience</Text>
          {audiences.map(item => <Pressable key={item.value} accessibilityRole="radio"
            accessibilityLabel={'Audience ' + item.label} accessibilityState={{ checked: audience === item.value }}
            aria-checked={audience === item.value}
            onPress={() => setAudience(item.value)} style={[s.rowBetween, { minHeight: 43 }]}>
            <View style={s.row}>
              <Ionicons name={item.icon} color={C.ink} size={20}/>
              <Text style={s.body}>{item.label}</Text>
            </View>
            <Ionicons name={audience === item.value ? 'radio-button-on' : 'radio-button-off'}
              color={audience === item.value ? C.accent : C.muted} size={21}/>
          </Pressable>)}
        </View>
        <View style={{ height: 1, backgroundColor: C.border }}/>
        <View style={[s.rowBetween, { paddingVertical: 6 }]}>
          <View style={s.row}>
            <Ionicons name="shield-checkmark-outline" color={C.accent} size={22}/>
            <Text style={s.cardHeading}>Not published</Text>
          </View>
          <Text style={s.small}>{mode} · {media.length} item{media.length === 1 ? '' : 's'}</Text>
        </View>
        <Text style={s.small}>This is a private development preview. No media is uploaded to a server.</Text>
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderColor: C.border, padding: 13, gap: 9 }}>
        <View style={s.row}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to edit" onPress={() => setStage('edit')}
            style={[s.ghost, { flex: 1 }]}>
            <Text style={s.ghostText}>Edit</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save text draft" onPress={() => void saveTextDraft()}
            style={[s.cta, { flex: 2 }]}>
            <Text style={s.ctaText}>Save text draft</Text>
          </Pressable>
        </View>
      </View>
    </> : null}
  </View>;
}
