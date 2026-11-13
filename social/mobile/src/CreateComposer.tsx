import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { VideoView, useVideoPlayer } from 'expo-video';
import { CameraCapture } from './CameraCapture';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, s } from './styles';
import { cropRect } from './imageEdit';
import { accountTextDraftKey, LEGACY_UNSCOPED_TEXT_DRAFT } from './createDraftKey';
import { loadAccountTextDraft, saveAccountTextDraft } from './textDraftStorage';
import type { AspectPreset } from './imageEdit';
import { MAX_CAPTION, MAX_TITLE, moveMedia, parseTextDraft, validateDraft, validateMedia } from './upload';
import type { Audience, ComposerDraft, ComposerMedia, ComposerMode } from './upload';

type Stage = 'select' | 'edit' | 'share';
type Topic = ComposerDraft['category'];
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

function Option({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }}
    disabled={disabled} onPress={onPress}
    style={[s.pill, selected && s.pillActive, { paddingVertical: 8, paddingHorizontal: 13, opacity: disabled ? 0.45 : 1 }]}>
    <Text style={[s.pillText, selected && s.pillTextActive]}>{label}</Text>
  </Pressable>;
}

function Tool({ icon, label, onPress, disabled = false }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minWidth: 54, minHeight: 46, opacity: disabled ? 0.3 : 1, gap: 3,
      alignItems: 'center', justifyContent: 'center' }}>
    <Ionicons name={icon} size={22} color={C.ink}/>
    <Text style={{ color: C.muted, fontSize: 10, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
}

export function CreateComposer({ initialMode = 'Post', onClose, riderId }: { initialMode?: ComposerMode; onClose: () => void; riderId: string }) {
  const draftKey = accountTextDraftKey(riderId);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<ComposerMode>(initialMode);
  const [stage, setStage] = useState<Stage>('select');
  const [media, setMedia] = useState<ComposerMedia[]>([]);
  const [active, setActive] = useState(0);
  const [caption, setCaption] = useState('');
  const [title, setTitle] = useState('');
  const [paidContent, setPaidContent] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<ComposerMode | null>(null);
  const [category, setCategory] = useState<Topic>('motorcycles');
  const [audience, setAudience] = useState<Audience>('private');
  const [status, setStatus] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ratio, setRatio] = useState<AspectPreset>('original');
  const originals = useRef<Record<string, ComposerMedia>>({});
  const currentMode = useRef(mode);
  currentMode.current = mode;
  const mounted = useRef(true);
  const pickerSequence = useRef(0);
  const pickerPending = useRef(false);
  const editSequence = useRef(0);
  // A slow device-storage read must not overwrite text or choices entered
  // after Create opened. This is especially important when restoring a draft
  // from a previous session on a busy iPhone.
  const userEditedDraft = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // File pickers and image manipulation can outlive this screen. Never
      // apply their results to a discarded draft or an unmounted composer.
      mounted.current = false;
      pickerSequence.current++;
      editSequence.current++;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    // A previous preview used one draft for every account on this device.
    // Delete that unscoped cache rather than exposing someone else's words.
    void AsyncStorage.removeItem(LEGACY_UNSCOPED_TEXT_DRAFT).catch(() => {});
    void loadAccountTextDraft(riderId).then(raw => {
      if (!mounted || !raw || userEditedDraft.current) return;
      const restored = parseTextDraft(JSON.parse(raw) as unknown);
      if (restored) {
        setCaption(restored.caption);
        setTitle(restored.title ?? '');
        // An explicit Reel entry point takes precedence over an older saved Post draft.
        if (initialMode === 'Post') setMode(restored.mode);
        setCategory(restored.category);
        setAudience(restored.audience);
        setStatus('Text draft restored. Select media again.');
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, [draftKey, initialMode]);

  const selected = media[active] ?? null;
  const isVideo = selected?.kind === 'video';
  const allowedMore = mode === 'Post' && media.length < 6;

  function changeMode(next: ComposerMode) {
    if (selecting || processing || pickerPending.current) return;
    if (mode === next) return;
    userEditedDraft.current = true;
    if (media.length) { setPendingMode(next); return; }
    applyMode(next);
  }

  function applyMode(next: ComposerMode) {
    pickerSequence.current++;
    editSequence.current++;
    setPendingMode(null);
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
    if (selecting || processing || pickerPending.current) return;
    pickerPending.current = true;
    userEditedDraft.current = true;
    const request = ++pickerSequence.current;
    const requestedMode = mode;
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
      if (!mounted.current || request !== pickerSequence.current || requestedMode !== currentMode.current) return;
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
      if (mounted.current && request === pickerSequence.current)
        setStatus('Could not open your media library. Check permissions and try again.');
    } finally {
      if (request === pickerSequence.current) {
        pickerPending.current = false;
        if (mounted.current) setSelecting(false);
      }
    }
  }

  function captureFromCamera(item: Omit<ComposerMedia, 'id'>) {
    if (!mounted.current || pickerPending.current || processing) return;
    userEditedDraft.current = true;
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
    if (!selected || processing || pickerPending.current) return;
    delete originals.current[selected.id];
    const next = media.filter(item => item.id !== selected.id);
    setMedia(next);
    setActive(current => Math.max(0, Math.min(current, next.length - 1)));
    setRatio('original');
    if (!next.length) setStage('select');
  }

  async function editImage(operation: { ratio: AspectPreset } | { rotate: true }) {
    if (!selected || selected.kind !== 'image' || processing || pickerPending.current) return;
    const operationId = ++editSequence.current;
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
      if (!mounted.current || operationId !== editSequence.current) return;
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
      if (mounted.current && operationId === editSequence.current)
        setStatus('Photo editing failed. Your original image is unchanged.');
    } finally {
      if (mounted.current && operationId === editSequence.current) setProcessing(false);
    }
  }

  function continueToShare() {
    const result = validateDraft({ mode, title, caption, audience, category, media });
    if (!result.ok) { setStatus(result.error); return; }
    setStatus(null);
    setStage('share');
  }

  async function saveTextDraft() {
    try {
      await saveAccountTextDraft(riderId, JSON.stringify({ mode, title, caption, category, audience }));
      setStatus('Text draft saved. Photos and videos are not saved; select them again next time.');
    } catch {
      setStatus('Text draft could not be saved on this device.');
    }
  }

  function back() {
    if (processing || selecting || pickerPending.current) return;
    setStatus(null);
    if (previewOpen) { setPreviewOpen(false); return; }
    if (stage === 'share') setStage('edit');
    else if (stage === 'edit') setStage('select');
    else if (media.length || caption) setStatus('Use Clear to discard this draft.');
  }

  const composerTitle = stage === 'share' ? 'Post details' :
    stage === 'edit' ? 'Edit ' + mode.toLowerCase() : 'New ' + mode.toLowerCase();
  const bottomInset = Platform.OS === 'web' ? 13 : Math.max(13, insets.bottom);
  const heroBg = '#050709';
  const surface = '#141619';
  const border = '#292D31';
  const secondary = '#A5AAB0';
  const white = '#FFFFFF';

  return <View testID="create-studio" nativeID="social-create-studio"
    style={{ flex: 1, minHeight: 0, backgroundColor: heroBg, paddingBottom: bottomInset }}>

    {stage === 'select' ? <>
      <CameraCapture mode={mode} disabled={selecting || processing}
        onCapture={captureFromCamera} onLibrary={() => void chooseMedia()} onClose={onClose}/>
      <View style={{ backgroundColor: heroBg, paddingHorizontal: 12,
        paddingTop: 11, paddingBottom: 5 }}>
        {media.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Continue editing"
          onPress={() => setStage('edit')} style={{ alignSelf: 'center',
            borderRadius: 20, paddingVertical: 9, paddingHorizontal: 17,
            backgroundColor: surface, marginBottom: 4 }}>
          <Text style={{ color: white, fontWeight: '800', fontSize: 13 }}>
            Continue editing · {media.length} selected
          </Text>
        </Pressable> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          {formats.map(item => <Pressable key={item} accessibilityRole="button"
            accessibilityLabel={item + ' format'} accessibilityState={{ selected: mode === item }}
            disabled={selecting || processing}
          onPress={() => changeMode(item)} style={{
              minWidth: 78, paddingVertical: 11, paddingHorizontal: 10,
              justifyContent: 'center', alignItems: 'center',
              borderBottomWidth: 2, borderBottomColor: item === mode ? white : 'transparent',
            }}>
            <Text style={{ color: item === mode ? white : secondary, fontSize: 13,
              fontWeight: item === mode ? '900' : '600' }}>
              {item}
            </Text>
          </Pressable>)}
        </View>
      </View>
    </> : <>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'center', paddingHorizontal: 13, minHeight: 58, gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back in composer"
          disabled={processing || selecting}
          onPress={back} style={{ width: 42, height: 43, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={29} color={white}/>
        </Pressable>
        <Text style={{ color: white, fontSize: 17, fontWeight: '800' }}>{composerTitle}</Text>
        {stage === 'edit' ? <Pressable accessibilityRole="button" accessibilityLabel="Review post"
          disabled={processing} onPress={continueToShare}
          style={{ borderRadius: 22, backgroundColor: white, minWidth: 70,
            minHeight: 37, alignItems: 'center', justifyContent: 'center',
            opacity: processing ? 0.5 : 1 }}>
          <Text style={{ color: heroBg, fontSize: 13, fontWeight: '900' }}>Next</Text>
        </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="Preview post"
          onPress={() => setPreviewOpen(true)}
          style={{ minWidth: 70, minHeight: 42, justifyContent: 'center', alignItems: 'flex-end' }}>
          <Text style={{ color: white, fontSize: 13, fontWeight: '700' }}>Preview</Text>
        </Pressable>}
      </View>

      {stage === 'edit' && selected ? <>
        <View testID="media-edit-canvas" style={{
          flex: 1, minHeight: 140, backgroundColor: '#000000', overflow: 'hidden',
          marginHorizontal: 7, borderRadius: 18, position: 'relative',
        }}>
          <MediaCanvas key={selected.id + selected.uri} item={selected}/>
          <View style={{ position: 'absolute', top: 15, left: 15, borderRadius: 16,
            backgroundColor: 'rgba(0,0,0,0.64)', paddingVertical: 6, paddingHorizontal: 11 }}>
            <Text style={{ color: white, fontSize: 12, fontWeight: '800' }}>
              {active + 1} / {media.length}
            </Text>
          </View>
        </View>
        <View style={{ paddingTop: 12, paddingBottom: 6, gap: 11, backgroundColor: heroBg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center', gap: 9 }}>
            {media.map((item, i) => <Pressable key={item.id} accessibilityRole="button"
              accessibilityLabel={'Select media ' + String(i + 1)}
              disabled={processing || selecting} onPress={() => {
                setActive(i); setRatio('original');
              }} style={{ width: 57, height: 72, borderRadius: 10,
                overflow: 'hidden', borderWidth: 2,
                borderColor: active === i ? white : border, backgroundColor: surface }}>
              {item.kind === 'image' ? <Image source={{ uri: item.uri }} resizeMode="cover"
                style={{ width: '100%', height: '100%' }}/> :
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="videocam" color={white} size={23}/>
                </View>}
            </Pressable>)}
            {allowedMore ? <Pressable accessibilityRole="button" accessibilityLabel="Add more media"
              onPress={() => void chooseMedia()} style={{ width: 55, height: 72,
                borderRadius: 10, borderWidth: 1, borderColor: border,
                justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="add" color={white} size={29}/>
            </Pressable> : null}
          </ScrollView>
          {selected.kind === 'image' ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center', gap: 8 }}>
            {ratios.filter(item => mode === 'Post' || item.value === 'original' || item.value === 'vertical')
              .map(item => <Option key={item.value} label={item.label}
                selected={ratio === item.value}
                disabled={processing || selecting}
                onPress={() => void editImage({ ratio: item.value })}/>)}
          </ScrollView> : <Text style={{ color: secondary, fontSize: 12, paddingHorizontal: 17 }}>
            Video preview · editing tools for video are not yet available
          </Text>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 14, alignItems: 'center', gap: 14 }}>
            {media.length > 1 ? <>
              <Tool icon="arrow-back-outline" label="Earlier" disabled={active === 0 || processing || selecting}
                onPress={() => {
                  setMedia(list => moveMedia(list, selected.id, -1));
                  setActive(index => Math.max(0, index - 1));
                }}/>
              <Tool icon="arrow-forward-outline" label="Later" disabled={active === media.length - 1 || processing || selecting}
                onPress={() => {
                  setMedia(list => moveMedia(list, selected.id, 1));
                  setActive(index => Math.min(media.length - 1, index + 1));
                }}/>
            </> : null}
            <Tool icon="refresh-outline" label="Rotate" onPress={() => void editImage({ rotate: true })}
              disabled={isVideo || processing}/>
            <Tool icon="trash-outline" label="Remove" disabled={processing || selecting} onPress={removeSelected}/>
            <Tool icon="images-outline" label="Library" onPress={() => void chooseMedia()}
              disabled={selecting || processing || !allowedMore}/>
          </ScrollView>
        </View>
      </> : null}

      {stage === 'share' ? <>
        <ScrollView nativeID="composer-scroll" testID="composer-scroll" style={{
          flex: 1, minHeight: 0, backgroundColor: heroBg,
        }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 17, paddingTop: 10,
            paddingBottom: 28, gap: 20 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 108, height: 147, borderRadius: 13,
              overflow: 'hidden', backgroundColor: surface, position: 'relative' }}>
              {media[0]?.kind === 'image'
                ? <Image source={{ uri: media[0].uri }} resizeMode="cover"
                    style={{ height: '100%', width: '100%' }}/>
                : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="videocam-outline" color={white} size={30}/>
                  </View>}
              <View style={{ position: 'absolute', top: 7, left: 7, backgroundColor: 'rgba(0,0,0,0.6)',
                borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4 }}>
                <Text style={{ color: white, fontSize: 10, fontWeight: '800' }}>Cover</Text>
              </View>
            </View>
            <View style={{ flex: 1, minHeight: 140, gap: 9 }}>
              <Text style={{ color: white, fontSize: 12, fontWeight: '700' }}>Add a title</Text>
              <TextInput accessibilityLabel="Post title" maxLength={MAX_TITLE}
                value={title} onChangeText={value => { userEditedDraft.current = true; setTitle(value); }}
                placeholder="Give your post a title"
                placeholderTextColor="#777B81"
                style={{ borderBottomWidth: 1, borderColor: border,
                  color: white, fontSize: 16, fontWeight: '700', paddingBottom: 13,
                  paddingHorizontal: 0, minHeight: 47 }}/>
              <Text style={{ color: secondary, fontSize: 11 }}>
                {mode} · {media.length} item{media.length === 1 ? '' : 's'} · Draft
              </Text>
              {allowedMore ? <Pressable accessibilityRole="button"
                accessibilityLabel="Add more media" onPress={() => void chooseMedia()}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 10 }}>
                <Ionicons name="add-circle-outline" color={white} size={21}/>
                <Text style={{ color: white, fontSize: 12, fontWeight: '700' }}>
                  Add photos
                </Text>
              </Pressable> : null}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <TextInput accessibilityLabel="Create caption" multiline value={caption}
              maxLength={MAX_CAPTION} onChangeText={value => { userEditedDraft.current = true; setCaption(value); }}
              placeholder="Write a description…"
              placeholderTextColor="#80858B"
              style={{ color: white, fontSize: 15, lineHeight: 22,
                minHeight: 140, textAlignVertical: 'top', padding: 0 }}/>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Add hashtag"
                onPress={() => { userEditedDraft.current = true; setCaption(current => (current && !/\s$/.test(current) ? current + ' ' : current) + '#'); }}
                style={{ backgroundColor: surface, borderRadius: 10,
                  minWidth: 39, minHeight: 38, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: white, fontSize: 21, fontWeight: '700' }}>#</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Add mention"
                onPress={() => { userEditedDraft.current = true; setCaption(current => (current && !/\s$/.test(current) ? current + ' ' : current) + '@'); }}
                style={{ backgroundColor: surface, borderRadius: 10,
                  minWidth: 39, minHeight: 38, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: white, fontSize: 20, fontWeight: '700' }}>@</Text>
              </Pressable>
              <Text style={{ color: secondary, marginLeft: 'auto', fontSize: 11 }}>
                {caption.length}/{MAX_CAPTION}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: border }}/>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Ionicons name="people-outline" size={21} color={white}/>
              <Text style={{ color: white, fontSize: 15, fontWeight: '800' }}>Community</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
              {topics.map(item => <Option key={item.value} label={item.label}
                selected={category === item.value} onPress={() => { userEditedDraft.current = true; setCategory(item.value); }}/>)}
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: border }}/>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Ionicons name="earth-outline" size={21} color={white}/>
              <Text style={{ color: white, fontSize: 15, fontWeight: '800' }}>Who can view this post</Text>
            </View>
            {audiences.map(item => <Pressable key={item.value} accessibilityRole="radio"
              accessibilityLabel={'Audience ' + item.label}
              accessibilityState={{ checked: audience === item.value }}
              aria-checked={audience === item.value}
              onPress={() => { userEditedDraft.current = true; setAudience(item.value); }}
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center',
                justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name={item.icon} color={secondary} size={20}/>
                <Text style={{ color: white, fontSize: 14 }}>{item.label}</Text>
              </View>
              <Ionicons name={audience === item.value ? 'radio-button-on' : 'radio-button-off'}
                color={audience === item.value ? C.accent : secondary} size={22}/>
            </Pressable>)}
          </View>

          <View style={{ height: 1, backgroundColor: border }}/>
          <Pressable accessibilityRole="checkbox"
            accessibilityLabel="Contains paid promotion" accessibilityState={{ checked: paidContent }}
            onPress={() => { userEditedDraft.current = true; setPaidContent(current => !current); }}
            style={{ minHeight: 47, flexDirection: 'row',
              alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="megaphone-outline" size={22} color={white}/>
              <Text style={{ color: white, fontSize: 14, fontWeight: '700' }}>Contains paid promotion</Text>
            </View>
            <Ionicons name={paidContent ? 'checkbox' : 'square-outline'} color={
              paidContent ? C.accent : secondary} size={23}/>
          </Pressable>
          <Text style={{ color: secondary, fontSize: 11, lineHeight: 17 }}>
            This is a local preview setting. Sponsored content must be disclosed before it can be published.
          </Text>

          <View style={{ padding: 13, backgroundColor: surface, borderRadius: 13, gap: 5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="lock-closed-outline" color={white} size={19}/>
              <Text style={{ color: white, fontWeight: '800', fontSize: 13 }}>
                Not published
              </Text>
            </View>
            <Text style={{ color: secondary, fontSize: 12, lineHeight: 17 }}>
              Your media stays on this device. Uploading and publishing are not available until accounts, safety checks and storage are connected.
            </Text>
          </View>
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center',
          backgroundColor: heroBg, paddingHorizontal: 15, paddingTop: 13, paddingBottom: 3,
          borderTopWidth: 1, borderColor: border }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Save text draft"
            onPress={() => void saveTextDraft()}
            style={{ flex: 1, borderRadius: 26, backgroundColor: '#26292C',
              alignItems: 'center', justifyContent: 'center',
              minHeight: 51, flexDirection: 'row', gap: 8 }}>
            <Ionicons name="archive-outline" color={white} size={20}/>
            <Text style={{ color: white, fontWeight: '800', fontSize: 14 }}>Drafts</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Post unavailable"
            disabled accessibilityState={{ disabled: true }}
            style={{ flex: 1.1, borderRadius: 26, backgroundColor: '#43494C',
              alignItems: 'center', justifyContent: 'center',
              minHeight: 51, flexDirection: 'row', gap: 8 }}>
            <Ionicons name="arrow-up-circle" color="#ADB4B7" size={21}/>
            <Text style={{ color: '#D3D7D9', fontWeight: '800', fontSize: 14 }}>Post unavailable</Text>
          </Pressable>
        </View>
      </> : null}
    </>}

    {status ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss composer notice"
      onPress={() => setStatus(null)}
      style={{ position: 'absolute', left: 12, right: 12, top: stage === 'select' ? 65 : 57,
        backgroundColor: '#24332F', borderRadius: 12, borderWidth: 1,
        borderColor: '#415D54', padding: 12, zIndex: 15 }}>
      <Text accessibilityRole="alert" style={{ color: '#EAFFF8', fontSize: 12, lineHeight: 18 }}>
        {status}
      </Text>
    </Pressable> : null}

    {pendingMode ? <View style={{ position: 'absolute', left: 12, right: 12,
      bottom: bottomInset + 14, backgroundColor: surface, borderColor: border,
      borderWidth: 1, borderRadius: 17, padding: 16, gap: 12, zIndex: 25 }}>
      <Text style={{ color: white, fontSize: 16, fontWeight: '800' }}>Switch to {pendingMode}?</Text>
      <Text style={{ color: secondary, fontSize: 12, lineHeight: 18 }}>
        Switching formats will discard the selected media. Nothing has been uploaded.
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Keep current format"
          onPress={() => setPendingMode(null)}
          style={{ flex: 1, borderRadius: 12, minHeight: 44, backgroundColor: '#292D31',
            alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: white, fontWeight: '800', fontSize: 13 }}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Discard and change format"
          onPress={() => applyMode(pendingMode)}
          style={{ flex: 1, borderRadius: 12, minHeight: 44, backgroundColor: white,
            alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: heroBg, fontWeight: '800', fontSize: 13 }}>Switch format</Text>
        </Pressable>
      </View>
    </View> : null}

    {previewOpen && media[0] ? <View testID="post-preview" style={{
      position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
      backgroundColor: '#000000', zIndex: 40,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between',
        paddingHorizontal: 16, minHeight: 54, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close post preview"
          onPress={() => setPreviewOpen(false)}>
          <Ionicons name="close" size={27} color={white}/>
        </Pressable>
        <Text style={{ color: white, fontWeight: '800', fontSize: 14 }}>Preview · Not published</Text>
        <View style={{ width: 30 }}/>
      </View>
      <View style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <MediaCanvas item={media[0]}/>
        {caption ? <View style={{ position: 'absolute', left: 14, right: 14, bottom: 18,
          padding: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.7)' }}>
          {title ? <Text style={{ color: white, fontSize: 15, fontWeight: '800',
            marginBottom: 5 }}>{title}</Text> : null}
          <Text style={{ color: white, fontSize: 13 }} numberOfLines={4}>{caption}</Text>
        </View> : null}
      </View>
    </View> : null}
  </View>;
}
