import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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

/**
 * Browser camera surface for Safari Home Screen PWAs and other browsers.
 *
 * iPhone WebKit does not reliably support the native camera permission hooks
 * and can require a new getUserMedia prompt after a Home Screen app relaunch.
 * Keep the camera permission prompt user-initiated, play the MediaStream in an
 * inline/muted video element, and always provide a Gallery escape route.
 *
 * This web-only implementation is resolved by Metro instead of CameraCapture.tsx.
 * It never loads expo-camera on web; native iOS/Android continue using CameraView.
 */
export function CameraCapture({ mode, onCapture, onLibrary, onClose, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const requestSerial = useRef(0);
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [live, setLive] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isReel = mode === 'Reel';

  function stopStream() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setLive(false);
  }

  function cancelCountdown() {
    if (countdownRef.current !== null) clearTimeout(countdownRef.current);
    countdownRef.current = null;
    setCountdown(null);
  }

  function openLibrary() {
    // Safari's file picker may leave the PWA visible: visibilitychange is
    // not guaranteed. Release hardware BEFORE opening the picker, even if
    // the user cancels. Also invalidate a permission prompt still pending.
    requestSerial.current += 1;
    stopStream();
    cancelCountdown();
    setRequesting(false);
    setError(null);
    onLibrary();
  }

  // A Reel on the PWA can only be selected from Gallery. Never leave the
  // microphone or camera hardware running for a mode with no web recording.
  useEffect(() => {
    if (!isReel) return;
    requestSerial.current += 1;
    stopStream();
    cancelCountdown();
    setRequesting(false);
    setError(null);
  }, [isReel]);

  useEffect(() => {
    mounted.current = true;
    const handleVisibility = () => {
      // Never leave a running camera in the background on a locked phone.
      if (document.visibilityState === 'hidden') {
        requestSerial.current++;
        stopStream();
        cancelCountdown();
        setRequesting(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mounted.current = false;
      requestSerial.current++;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (countdownRef.current !== null) clearTimeout(countdownRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  // Safari may retain permission only for the current PWA launch. Never prompt
  // automatically; the explicit action preserves the browser user gesture.
  async function enableCamera(nextFacing: 'user' | 'environment' = facing) {
    const requestId = ++requestSerial.current;
    stopStream();
    cancelCountdown();
    setError(null);
    setRequesting(true);
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setRequesting(false);
      setError('The camera is unavailable in this browser. Choose a photo or video from Gallery.');
      return;
    }
    let nextStream: MediaStream | null = null;
    let permissionTimer: ReturnType<typeof setTimeout> | null = null;
    let playTimer: ReturnType<typeof setTimeout> | null = null;
    let requestExpired = false;
    try {
      // getUserMedia is allowed to remain pending forever when the user
      // ignores the permission dialog. Never leave Create in an infinite
      // loading state; dispose any stream granted after a timeout/cancel.
      const permission = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextFacing } },
      });
      void permission.then(stream => {
        if (requestExpired || !mounted.current || requestId !== requestSerial.current)
          stream.getTracks().forEach(track => track.stop());
      }).catch(() => {});
      nextStream = await Promise.race([
        permission,
        new Promise<never>((_, reject) => {
          permissionTimer = setTimeout(() => {
            requestExpired = true;
            reject(new Error('camera_permission_timeout'));
          }, 20000);
        }),
      ]);
      if (!mounted.current || requestId !== requestSerial.current) {
        nextStream.getTracks().forEach(track => track.stop());
        return;
      }
      if (permissionTimer !== null) clearTimeout(permissionTimer);
      permissionTimer = null;
      const preview = videoRef.current;
      if (!preview) throw Error('Missing camera preview');
      preview.muted = true;
      preview.playsInline = true;
      preview.srcObject = nextStream;
      // Capture ownership BEFORE awaiting play(): Gallery/Close/Background
      // must be able to stop the active hardware even if Safari stalls here.
      streamRef.current = nextStream;
      await Promise.race([
        preview.play(),
        new Promise<never>((_, reject) => {
          playTimer = setTimeout(() => reject(new Error('camera_preview_timeout')), 8000);
        }),
      ]);
      if (!mounted.current || requestId !== requestSerial.current) {
        nextStream.getTracks().forEach(track => track.stop());
        return;
      }
      setLive(true);
    } catch {
      nextStream?.getTracks().forEach(track => track.stop());
      if (streamRef.current === nextStream) streamRef.current = null;
      if (mounted.current && requestId === requestSerial.current) {
        setError(requestExpired
          ? 'The camera permission request timed out. Try again or choose Gallery.'
          : 'Camera access was blocked or could not start. Allow camera access in your browser settings, or choose Gallery.');
      }
    } finally {
      requestExpired = true;
      if (permissionTimer !== null) clearTimeout(permissionTimer);
      if (playTimer !== null) clearTimeout(playTimer);
      if (mounted.current && requestId === requestSerial.current) setRequesting(false);
    }
  }

  function capturePhoto() {
    const preview = videoRef.current;
    if (!preview || !live || !streamRef.current || disabled) return;
    const width = preview.videoWidth;
    const height = preview.videoHeight;
    if (!width || !height) {
      setError('The camera is still starting. Try again or choose Gallery.');
      return;
    }
    try {
      // Bound the bitmap size so a high-resolution iPhone capture cannot
      // exhaust Safari memory or create an unbounded in-memory preview.
      const scale = Math.min(1, 2048 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('Canvas not available');
      if (facing === 'user') {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(preview, 0, 0, w, h);
      const uri = canvas.toDataURL('image/jpeg', 0.86);
      if (!uri.startsWith('data:image/jpeg;base64,')) throw Error('No photo data');
      stopStream();
      onCapture({ uri, kind: 'image', fileName: 'Camera photo.jpg',
        mimeType: 'image/jpeg', width: w, height: h });
    } catch {
      setError('Could not capture this photo. Please try again or choose Gallery.');
    }
  }

  function startCountdown() {
    if (!live || disabled || countdown !== null) return;
    if (timerSeconds === 0) {
      capturePhoto();
      return;
    }
    let remaining = timerSeconds;
    setCountdown(remaining);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        countdownRef.current = null;
        setCountdown(null);
        capturePhoto();
      } else {
        setCountdown(remaining);
        countdownRef.current = setTimeout(tick, 1000);
      }
    };
    countdownRef.current = setTimeout(tick, 1000);
  }

  return <View testID="camera-first-studio" style={{
    flex: 1, minHeight: 0, backgroundColor: BLACK, paddingHorizontal: 7, paddingTop: 4,
  }}>
    <View testID="camera-preview-area" style={{
      flex: 1, minHeight: 140, backgroundColor: '#15181D', borderRadius: 23,
      overflow: 'hidden', position: 'relative',
    }}>
      <video ref={videoRef} autoPlay muted playsInline
        aria-label="Live camera preview"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', opacity: live ? 1 : 0, pointerEvents: 'none',
          transform: facing === 'user' ? 'scaleX(-1)' : undefined }} />
      {!live ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center',
        gap: 14, paddingHorizontal: 27, backgroundColor: '#15181D' }}>
        <Ionicons name="camera-outline" size={44} color={WHITE}/>
        <Text style={{ color: WHITE, fontSize: 21, fontWeight: '800' }}>Your camera</Text>
        <Text style={{ color: '#B4BBC4', fontSize: 13, lineHeight: 19,
          maxWidth: 290, textAlign: 'center' }}>
          {isReel ? 'Choose a recorded video from Gallery to create your Reel.' :
            requesting ? 'Opening camera…' :
              'Enable your camera to take a photo, or select one from your gallery.'}
        </Text>
        {!isReel ? <Pressable accessibilityRole="button" accessibilityLabel="Enable camera"
          disabled={requesting || disabled}
          onPress={() => { void enableCamera(); }}
          style={{ backgroundColor: WHITE, borderRadius: 22,
            opacity: requesting || disabled ? 0.6 : 1,
            paddingVertical: 12, paddingHorizontal: 24 }}>
          <Text style={{ color: BLACK, fontSize: 14, fontWeight: '800' }}>
            {requesting ? 'Opening camera…' : 'Enable camera'}
          </Text>
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Open Gallery"
          disabled={disabled} onPress={openLibrary} style={{ padding: 9 }}>
          <Text style={{ color: WHITE, fontSize: 13, fontWeight: '700' }}>
            Choose from Gallery
          </Text>
        </Pressable>
        {error ? <Text accessibilityRole="alert" style={{
          color: '#F5B7C5', fontSize: 12, textAlign: 'center', lineHeight: 18,
        }}>{error}</Text> : null}
      </View> : null}

      <View style={{ position: 'absolute', top: 12, left: 13, right: 13,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Create"
          onPress={() => { requestSerial.current++; stopStream(); cancelCountdown(); onClose(); }}
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
          disabled={!live || requesting}
          onPress={() => {
            const nextFacing = facing === 'environment' ? 'user' : 'environment';
            setFacing(nextFacing);
            void enableCamera(nextFacing);
          }}
          style={{ backgroundColor: DIM, width: 43, height: 43, borderRadius: 22,
            justifyContent: 'center', alignItems: 'center',
            opacity: live && !requesting ? 1 : 0.4 }}>
          <Ionicons name="camera-reverse-outline" color={WHITE} size={27}/>
        </Pressable>
      </View>

      {live && !isReel ? <View style={{ position: 'absolute', top: 88, right: 9,
        backgroundColor: DIM, borderRadius: 23, paddingVertical: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Capture timer"
          onPress={() => setTimerSeconds(x => x === 0 ? 3 : x === 3 ? 10 : 0)}
          disabled={countdown !== null}
          style={{ minHeight: 56, minWidth: 54, gap: 3,
            alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="timer-outline" size={25} color={WHITE}/>
          <Text style={{ color: WHITE, fontSize: 10, fontWeight: '700' }}>
            {timerSeconds === 0 ? 'Timer off' : String(timerSeconds) + 's timer'}
          </Text>
        </Pressable>
      </View> : null}

      {countdown !== null ? <View pointerEvents="none" style={{
        position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center',
      }}><Text style={{ fontSize: 78, color: WHITE, fontWeight: '900' }}>
        {countdown}
      </Text></View> : null}

      <View style={{ position: 'absolute', bottom: 14, left: 0, right: 0 }}>
        <View style={{ paddingHorizontal: 15, flexDirection: 'row',
          alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose from library"
            onPress={openLibrary} disabled={disabled}
            style={{ width: 64, height: 66, alignItems: 'center',
              justifyContent: 'center', gap: 5, backgroundColor: DIM, borderRadius: 16 }}>
            <Ionicons name="images-outline" size={25} color={WHITE}/>
            <Text style={{ fontSize: 10, fontWeight: '700', color: WHITE }}>Gallery</Text>
          </Pressable>
          <Pressable accessibilityRole="button"
            accessibilityLabel={isReel ? 'Choose Reel video' : 'Take photo'}
            disabled={disabled || requesting || countdown !== null || (!live && !isReel)}
            onPress={isReel ? openLibrary : startCountdown}
            style={{ width: 81, height: 81, borderRadius: 42, borderWidth: 5,
              borderColor: WHITE, backgroundColor: DIM,
              alignItems: 'center', justifyContent: 'center',
              opacity: disabled || (!live && !isReel) ? 0.45 : 1 }}>
            {isReel ? <Ionicons name="videocam-outline" size={31} color={WHITE}/> :
              <View style={{ width: 60, height: 60, borderRadius: 30,
                backgroundColor: WHITE }}/>}
          </Pressable>
          <View style={{ width: 64, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={isReel ? 'videocam-outline' : 'image-outline'}
              size={22} color={WHITE}/>
            <Text style={{ color: WHITE, fontSize: 10, marginTop: 4 }}>
              {isReel ? 'Gallery video' : 'Photo'}
            </Text>
          </View>
        </View>
      </View>
    </View>
    {isReel ? <Text style={{ color: '#A8ADB5', fontSize: 11,
      textAlign: 'center', paddingTop: 5 }}>
      Record a Reel using your phone camera, then select it from Gallery.
    </Text> : null}
  </View>;
}
