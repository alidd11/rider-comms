import React, { useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import type { CameraType } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { C } from './styles';
import type { ComposerMedia, ComposerMode } from './upload';

type CapturedMedia = Omit<ComposerMedia, 'id'>;
type Props = {
  mode: ComposerMode;
  onCapture: (captured: CapturedMedia) => void;
  onLibrary: () => void;
  disabled: boolean;
};

export function CameraCapture({ mode, onCapture, onLibrary, disabled }: Props) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [microphone, requestMicrophone] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUseCamera = Boolean(permission?.granted);
  const isVideo = mode === 'Reel';

  async function photo() {
    if (!camera.current || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const result = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!result?.uri) throw Error('No photo returned');
      onCapture({
        uri: result.uri, kind: 'image', fileName: 'Camera photo.jpg',
        mimeType: 'image/jpeg', width: result.width, height: result.height,
      });
    } catch {
      setError('Could not take a photo. Try again or choose one from your gallery.');
    } finally {
      setBusy(false);
    }
  }

  async function video() {
    if (!camera.current || disabled) return;
    if (Platform.OS === 'web') {
      // Expo Camera does not provide a consistent browser recording contract,
      // especially in installed iOS PWAs. Avoid pretending to record a Reel.
      setError('Video recording is not yet supported in this web preview. You can choose a video from your gallery.');
      return;
    }
    if (recording) {
      camera.current.stopRecording();
      return;
    }
    if (busy) return;
    setError(null);
    try {
      if (!microphone?.granted) {
        const permissionResult = await requestMicrophone();
        if (!permissionResult.granted) {
          setError('Microphone permission is needed to record video with sound.');
          return;
        }
      }
      setRecording(true);
      const result = await camera.current.recordAsync({ maxDuration: 60 });
      if (!result?.uri) throw Error('No video returned');
      onCapture({ uri: result.uri, kind: 'video', fileName: 'Camera video.mp4', mimeType: 'video/mp4' });
    } catch {
      setError('Video recording failed. You can choose a video from your gallery.');
    } finally {
      setRecording(false);
    }
  }

  const pickerReel = isVideo && Platform.OS === 'web';
  const shutterDisabled = disabled || busy || (!canUseCamera && !pickerReel);
  return <View testID="camera-first-studio" style={{
    flex: 1, minHeight: 0, width: '100%', backgroundColor: '#020408',
  }}>
    <View testID="camera-preview-area" style={{
      flex: 1, minHeight: 140, overflow: 'hidden', position: 'relative',
      justifyContent: 'center', alignItems: 'center',
    }}>
      {canUseCamera ? <CameraView ref={camera} mode={isVideo && Platform.OS !== 'web' ? 'video' : 'picture'}
        facing={facing} style={{ width: '100%', height: '100%' }}
        onMountError={() => setError('Camera preview is unavailable. You can still select from your gallery.')} />
        : <View style={{ alignItems: 'center', gap: 13, padding: 24, maxWidth: 320 }}>
          <Ionicons name="camera-outline" size={46} color={C.accent}/>
          <Text style={{ color: C.ink, fontSize: 19, textAlign: 'center', fontWeight: '900' }}>
            Camera
          </Text>
          <Text style={{ color: C.muted, textAlign: 'center', fontSize: 13, lineHeight: 19 }}>
            {permission?.canAskAgain === false
              ? 'Camera access is blocked. Enable camera permission in your device or browser settings, or use Gallery.'
              : 'Allow camera access to take photos directly in Social.'}
          </Text>
          {permission?.canAskAgain !== false ? <Pressable
            accessibilityRole="button" accessibilityLabel="Enable camera"
            onPress={() => void requestPermission().catch(() => setError('Camera access was not granted.'))}
            style={{ backgroundColor: C.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 25 }}>
            <Text style={{ color: C.bg, fontSize: 14, fontWeight: '900' }}>Enable camera</Text>
          </Pressable> : null}
        </View>}
      {canUseCamera ? <View pointerEvents="none" style={{
        position: 'absolute', top: 14, left: 14, backgroundColor: 'rgba(0,0,0,0.48)',
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
      }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 12 }}>
          {isVideo ? 'VIDEO' : 'PHOTO'}
        </Text>
      </View> : null}
    </View>
    {error ? <View style={{ backgroundColor: C.accentDark, paddingHorizontal: 15, paddingVertical: 9 }}>
      <Text accessibilityRole="alert" style={{ color: '#DCFBF1', textAlign: 'center', fontSize: 12 }}>{error}</Text>
    </View> : null}
    <View style={{
      paddingHorizontal: 18, paddingVertical: 13, backgroundColor: C.bg,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose from library"
        onPress={onLibrary} disabled={disabled || recording}
        style={{ width: 75, minHeight: 55, gap: 4, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="images-outline" color={C.ink} size={26}/>
        <Text style={{ color: C.muted, fontSize: 11, fontWeight: '800' }}>Gallery</Text>
      </Pressable>
      <Pressable accessibilityRole="button"
        accessibilityLabel={pickerReel ? 'Choose Reel video' : recording ? 'Stop recording' : isVideo ? 'Record Reel' : 'Take photo'}
        disabled={shutterDisabled} onPress={() => { if (pickerReel) onLibrary(); else void (isVideo ? video() : photo()); }}
        style={{
          width: 76, height: 76, borderRadius: 38,
          borderWidth: 5, borderColor: shutterDisabled ? C.muted : '#FFFFFF',
          alignItems: 'center', justifyContent: 'center',
          opacity: shutterDisabled ? 0.45 : 1,
        }}>
        {pickerReel ? <Ionicons name="videocam-outline" color="#FFFFFF" size={32}/> :
        <View style={{
          height: recording ? 25 : 58, width: recording ? 25 : 58,
          borderRadius: recording ? 6 : 30,
          backgroundColor: isVideo ? '#E64F62' : '#FFFFFF',
        }}/>} 
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Flip camera"
        disabled={!canUseCamera || recording} onPress={() => setFacing(current => current === 'back' ? 'front' : 'back')}
        style={{ width: 75, minHeight: 55, gap: 4, alignItems: 'center', justifyContent: 'center',
          opacity: canUseCamera ? 1 : 0.4 }}>
        <Ionicons name="camera-reverse-outline" color={C.ink} size={27}/>
        <Text style={{ color: C.muted, fontSize: 11, fontWeight: '800' }}>Flip</Text>
      </Pressable>
    </View>
  </View>;
}
