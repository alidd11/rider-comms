import { StyleSheet } from 'react-native';

export const AUTH_HERO_IMAGE = 'https://images.unsplash.com/photo-1552306062-29a5560e1c31?auto=format&fit=crop&q=82&w=1400';
export const AUTH_ACCENT = '#63F3D2';
export const AUTH_ACCENT_DEEP = '#0D8C78';
export const AUTH_TEXT = '#F2F7F7';
export const AUTH_MUTED = '#9DAAAD';
const AUTH_SURFACE = 'rgba(7,15,18,0.58)';
const AUTH_BORDER = 'rgba(214,236,238,0.22)';

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#03090B' },
  keyboard: { flex: 1 },
  backgroundImage: { resizeMode: 'cover' },
  backgroundShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(2,8,10,0.55)' },
  authScroll: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', paddingHorizontal: 24 },
  intro: { marginBottom: 18 },
  title: { color: AUTH_TEXT, fontSize: 28, lineHeight: 30, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { color: AUTH_MUTED, fontSize: 12, lineHeight: 17, fontWeight: '500', marginTop: 5 },
  form: { gap: 10 },
  fieldWrap: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: AUTH_BORDER,
    borderRadius: 7,
    backgroundColor: AUTH_SURFACE,
    overflow: 'hidden',
  },
  fieldIcon: { marginLeft: 12, marginRight: 3 },
  input: { minHeight: 43, flex: 1, color: AUTH_TEXT, fontSize: 13, paddingHorizontal: 8 },
  passwordInput: { minHeight: 43, flex: 1, color: AUTH_TEXT, fontSize: 13, paddingHorizontal: 8 },
  passwordToggle: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  loginMeta: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rememberRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 17, height: 17, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(215,231,233,0.36)', backgroundColor: 'rgba(4,11,13,0.45)', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { borderColor: AUTH_ACCENT, backgroundColor: AUTH_ACCENT_DEEP },
  checkboxInner: { width: 7, height: 7, borderRadius: 2, backgroundColor: AUTH_ACCENT },
  rememberText: { color: '#D7E0E1', fontSize: 11, fontWeight: '500' },
  forgotButton: { minHeight: 30, justifyContent: 'center' },
  forgotText: { color: AUTH_ACCENT, fontSize: 11, fontWeight: '600' },
  primaryButton: { minHeight: 46, marginTop: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(101,246,211,0.38)', backgroundColor: AUTH_ACCENT_DEEP, alignItems: 'center', justifyContent: 'center', shadowColor: AUTH_ACCENT, shadowOpacity: 0.12, shadowRadius: 10 },
  primaryButtonPressed: { opacity: 0.88 },
  primaryButtonText: { color: AUTH_TEXT, fontSize: 13, fontWeight: '700' },
  buttonDisabled: { opacity: 0.62 },
  requirements: { color: '#95A2A5', fontSize: 10, lineHeight: 14 },
  error: { color: '#FF9DA2', fontSize: 11, lineHeight: 15, paddingHorizontal: 2 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(255,98,104,0.28)', borderRadius: 7, padding: 9, backgroundColor: 'rgba(70,16,20,0.35)', marginBottom: 10 },
  noticeText: { color: '#FFC0C3', fontSize: 11, lineHeight: 15, flex: 1 },
  noticeAction: { color: AUTH_ACCENT, fontSize: 11, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 7 },
  dividerLine: { height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: AUTH_BORDER },
  dividerText: { color: AUTH_MUTED, fontSize: 10 },
  socialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 2 },
  socialButton: { width: 48, height: 44, borderWidth: 1, borderColor: 'rgba(214,236,238,0.14)', borderRadius: 9, backgroundColor: 'rgba(10,20,23,0.72)', alignItems: 'center', justifyContent: 'center' },
  createAccountButton: { minHeight: 34, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: 8, marginTop: 1 },
  createAccountText: { color: AUTH_ACCENT, fontSize: 12, fontWeight: '600' },
  footerTagline: { color: '#667578', fontSize: 8, lineHeight: 11, fontWeight: '600', letterSpacing: 2.1, textAlign: 'center', marginTop: 'auto', paddingTop: 30, paddingBottom: 8 },
  splash: { flex: 1, backgroundColor: '#03090B' },
  splashShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(2,8,10,0.62)' },
  splashCenter: { alignItems: 'center' },
  splashMark: { color: '#DFFCFF', fontSize: 76, lineHeight: 78, fontWeight: '200', fontStyle: 'italic', letterSpacing: -10, textShadowColor: 'rgba(99,243,210,0.28)', textShadowRadius: 16 },
  splashName: { color: AUTH_TEXT, fontSize: 13, fontWeight: '500', letterSpacing: 6, marginTop: 10, marginLeft: 6 },
  splashMotto: { color: '#D2DDDF', fontSize: 9, lineHeight: 17, fontWeight: '500', letterSpacing: 4, textAlign: 'center', marginTop: 26, marginLeft: 4 },
  splashFooter: { position: 'absolute', left: 0, right: 0, color: '#899699', fontSize: 8, lineHeight: 14, letterSpacing: 3, textAlign: 'center' },
  splashProgress: { position: 'absolute', left: '50%', width: 72, height: 3, marginLeft: -36, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(217,236,238,0.22)' },
  splashProgressFill: { width: '62%', height: '100%', borderRadius: 999, backgroundColor: AUTH_ACCENT },
});
