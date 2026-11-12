import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import type { CameraType, FlashMode } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import type { ComposerMedia, ComposerMode } from './upload';

type CapturedMedia = Omit<ComposerMedia, 'id'>;
type Props = {
  mode: ComposerMode;
  onCapture: (captured: CapturedMedia) => void;
  onLibrary: () => void;
  onClose: () => void;
  disabled: boolean;
};

const WHITE = '#FFFFFF';
const BLACK = '#050709';
const DIM = 'rgba(0,0,0,0.56)';

function CameraAction({ icon, label, onPress, disabled }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    disabled={disabled} onPress={onPress}
    style={{ width: 53, minHeight: 55, alignItems: 'center', justifyContent: 'center',
      gap: 4, opacity: disabled ? 0.42 : 1 }}>
    <Ionicons name={icon} size={25} color={WHITE}/>
    <Text style={{ color: WHITE, fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
      {label}
    </Text>
  </Pressable>;
}

/** Camera-only surface. Recording and flash actions are real, not decorative. */
export function CameraCapture({ mode, onCapture, onLibrary, onClose, disabled }: Props) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [microphone, requestMicrophone] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [recordLimit, setRecordLimit] = useState<15 | 60>(15);
  const [timerSeconds, setTimerSeconds] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUseCamera = Boolean(permission?.granted);
  const isVideo = mode === 'Reel';
  const webReel = isVideo && Platform.OS === 'web';

  useEffect(() => { setCountdown(null); setError(null); }, [mode]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const timeout = setTimeout(() => setCountdown(value => value === null ? null : value - 1), 1000);
      return () => clearTimeout(timeout);
    }
    setCountdown(null);
    if (isVideo) void recordVideo();
    else void takePhoto();
    // Each countdown ends with exactly one capture. The camera unmounts when editing begins.
  }, [countdown]);

  async function takePhoto() {
    if (!camera.current || busy || disabled || recording) return;
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
      setError('Could not capture a photo. Try again or choose from your gallery.');
    } finally {
      setBusy(false);
    }
  }

  async function recordVideo() {
    if (!camera.current || disabled) return;
    if (Platform.OS === 'web') {
      // Expo Camera v58 records video on iOS and Android only.
      setError('Record a video with your device camera and select it from Gallery.');
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
        const answer = await requestMicrophone();
        if (!answer.granted) {
          setError('Allow microphone access to record a Reel with sound.');
          return;
        }
      }
      setRecording(true);
      const result = await camera.current.recordAsync({ maxDuration: recordLimit });
      if (!result?.uri) throw Error('No video returned');
      onCapture({ uri: result.uri, kind: 'video', fileName: 'Camera video.mp4', mimeType: 'video/mp4' });
    } catch {
      setError('Recording failed. You can select an existing video from Gallery.');
    } finally {
      setRecording(false);
    }
  }

  function pressShutter() {
    if (recording) { void recordVideo(); return; }
    if (webReel) { onLibrary(); return; }
    if (timerSeconds > 0) { setCountdown(timerSeconds); return; }
    if (isVideo) void recordVideo();
    else void takePhoto();
  }

  const shutterDisabled = disabled || busy || countdown !== null ||
    (!canUseCamera && !webReel);
  const shutterLabel = webReel ? 'Choose Reel video' : recording ? 'Stop recording'
    : isVideo ? 'Record Reel' : 'Take photo';

  return <View testID="camera-first-studio" style={{
    flex: 1, minHeight: 0, backgroundColor: BLACK, paddingHorizontal: 7, paddingTop: 4,
  }}>
    <View testID="camera-preview-area" style={{
      flex: 1, minHeight: 140, borderRadius: 23, overflow: 'hidden',
      backgroundColor: '#15181D', position: 'relative',
    }}>
      {canUseCamera ? <CameraView ref={camera}
        mode={isVideo && Platform.OS !== 'web' ? 'video' : 'picture'}
        facing={facing} flash={facing === 'back' ? flash : 'off'}
        style={{ width: '100%', height: '100%' }}
        onMountError={() => setError('Camera unavailable. Choose an existing photo or video from Gallery.')} />
      : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14,
        paddingHorizontal: 30, backgroundColor: '#15181D' }}>
          <Ionicons name="camera-outline" size={44} color={WHITE}/>
          <Text style={{ color: WHITE, fontSize: 21, fontWeight: '800' }}>Your camera</Text>
          <Text style={{ color: '#B4BBC4', fontSize: 13, lineHeight: 19,
            maxWidth: 290, textAlign: 'center' }}>
            {permission?.canAskAgain === false
              ? 'Camera access is blocked. Change your device or browser permissions, or choose Gallery.'
              : 'Enable the camera to capture your own photos and videos.'}
          </Text>
          {permission?.canAskAgain !== false ? <Pressable accessibilityRole="button"
            accessibilityLabel="Enable camera"
            onPress={() => void requestPermission().catch(() => setError('Camera access was not granted.'))}
            style={{ backgroundColor: WHITE, borderRadius: 22, paddingVertical: 12, paddingHorizontal: 24 }}>
            <Text style={{ color: BLACK, fontSize: 14, fontWeight: '800' }}>Enable camera</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Open Gallery"
            onPress={onLibrary} style={{ padding: 9 }}>
            <Text style={{ color: WHITE, fontSize: 13, fontWeight: '700' }}>Choose from Gallery</Text>
          </Pressable>
        </View>}

      <View style={{ position: 'absolute', top: 12, left: 13, right: 13,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Create"
          disabled={recording} onPress={onClose}
          style={{ backgroundColor: DIM, width: 43, height: 43, borderRadius: 22,
            justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="close" color={WHITE} size={27}/>
        </Pressable>
        <View style={{ maxWidth: '52%', backgroundColor: DIM, borderRadius: 22,
          paddingVertical: 10, paddingHorizontal: 18 }}>
          <Text style={{ color: WHITE, fontWeight: '800', fontSize: 13 }}>
            {mode === 'Reel' ? 'New reel' : mode === 'Story' ? 'New story' : 'New post'}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Flip camera"
          disabled={!canUseCamera || recording} onPress={() => {
            setFacing(current => current === 'back' ? 'front' : 'back');
            setFlash('off');
          }} style={{ backgroundColor: DIM, width: 43, height: 43, borderRadius: 22,
            justifyContent: 'center', alignItems: 'center',
            opacity: canUseCamera && !recording ? 1 : 0.4 }}>
          <Ionicons name="camera-reverse-outline" color={WHITE} size={27}/>
        </Pressable>
      </View>

      {canUseCamera ? <View style={{ position: 'absolute', right: 9, top: 90,
        alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 23,
        paddingVertical: 6 }}>
        <CameraAction icon={flash === 'on' ? 'flash' : 'flash-off-outline'}
          label={flash === 'on' ? 'Flash on' : 'Flash off'}
          disabled={facing !== 'back' || recording}
          onPress={() => setFlash(value => value === 'on' ? 'off' : 'on')}/>
        <CameraAction icon="timer-outline"
          label={timerSeconds === 0 ? 'Timer off' : String(timerSeconds) + 's timer'}
          disabled={recording || countdown !== null}
          onPress={() => setTimerSeconds(current => current === 0 ? 3 : current === 3 ? 10 : 0)}/>
      </View> : null}

      {countdown !== null ? <View pointerEvents="none" style={{
        position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center',
      }}><Text style={{ fontSize: 78, color: WHITE, fontWeight: '900' }}>
        {countdown}
      </Text></View> : null}

      <View style={{ position: 'absolute', bottom: 14, left: 0, right: 0, gap: 14 }}>
        {isVideo ? <View style={{ alignSelf: 'center', flexDirection: 'row',
          gap: 12, paddingVertical: 7, paddingHorizontal: 14, backgroundColor: DIM, borderRadius: 21 }}>
          {([15, 60] as const).map(limit => <Pressable key={limit} accessibilityRole="button"
            accessibilityLabel={String(limit) + ' seconds'}
            accessibilityState={{ selected: recordLimit === limit }}
            disabled={recording}
            onPress={() => setRecordLimit(limit)}>
            <Text style={{ color: recordLimit === limit ? WHITE : '#AEB2B9',
              fontWeight: recordLimit === limit ? '900' : '600', fontSize: 13 }}>
              {limit}s
            </Text>
          </Pressable>)}
        </View> : null}
        <View style={{ paddingHorizontal: 15, flexDirection: 'row',
          alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose from library"
            onPress={onLibrary} disabled={disabled || recording}
            style={{ width: 64, height: 66, alignItems: 'center', justifyContent: 'center',
              gap: 5, backgroundColor: DIM, borderRadius: 16 }}>
            <Ionicons name="images-outline" size={25} color={WHITE}/>
            <Text style={{ fontSize: 10, fontWeight: '700', color: WHITE }}>Gallery</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={shutterLabel}
            disabled={shutterDisabled} onPress={pressShutter} style={{
              width: 81, height: 81, borderRadius: 42, borderWidth: 5,
              borderColor: WHITE, backgroundColor: DIM,
              alignItems: 'center', justifyContent: 'center',
              opacity: shutterDisabled ? 0.45 : 1,
            }}>
            {webReel ? <Ionicons name="videocam-outline" size={31} color={WHITE}/> :
              <View style={{ width: recording ? 27 : 60, height: recording ? 27 : 60,
                borderRadius: recording ? 7 : 30,
                backgroundColor: isVideo ? '#F43B5C' : WHITE }}/>}
          </Pressable>
          <View style={{ width: 64, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={isVideo ? 'videocam-outline' : 'image-outline'} size={22} color={WHITE}/>
            <Text style={{ color: WHITE, fontSize: 10, marginTop: 4 }}>
              {recording ? 'Recording' : isVideo ? (webReel ? 'Gallery video' : 'Video') : 'Photo'}
            </Text>
          </View>
        </View>
      </View>

      {error ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss camera notice"
        onPress={() => setError(null)} style={{ position: 'absolute', left: 15, right: 15,
          bottom: isVideo ? 150 : 124, padding: 12, borderRadius: 12,
          backgroundColor: 'rgba(10,15,20,0.92)' }}>
        <Text accessibilityRole="alert" style={{ color: WHITE, fontSize: 12 }}>{error}</Text>
      </Pressable> : null}
    </View>
    {webReel ? <Text style={{ color: '#A8ADB5', fontSize: 11, textAlign: 'center', paddingTop: 5 }}>
      Video recording is available in the native app. Select a video here.
    </Text> : null}
  </View>;
}
