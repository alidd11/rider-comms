import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './styles';

export type CommentPreview = { id: string; text: string };

export function CommentsSheet({
  title, comments, onSubmit, onClose,
}: {
  title: string;
  comments: readonly CommentPreview[];
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const text = draft.trim();
    if (!text || text.length > 500) return;
    onSubmit(text);
    setDraft('');
  };
  return <View testID="comments-overlay" style={{
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 50,
    justifyContent: 'flex-end',
  }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss comments"
      onPress={onClose} style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
        backgroundColor: 'rgba(0,0,0,0.63)',
      }}/>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{
        height: '70%', backgroundColor: C.panel, borderTopLeftRadius: 22,
        borderTopRightRadius: 22, borderColor: C.border, borderWidth: 1,
      }}>
      <View style={{
        paddingHorizontal: 18, paddingVertical: 15, flexDirection: 'row',
        alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1,
        borderColor: C.border,
      }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: C.ink, fontSize: 17, fontWeight: '900' }}>Comments</Text>
          <Text style={{ color: C.muted, fontSize: 11 }} numberOfLines={1}>{title} · Local preview</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close comments"
          onPress={onClose} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={25} color={C.ink}/>
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 15 }}>
        {comments.length === 0 ? <View style={{ alignItems: 'center', paddingTop: 28, gap: 9 }}>
          <Ionicons name="chatbubbles-outline" color={C.accent} size={33}/>
          <Text style={{ color: C.ink, fontWeight: '800' }}>Start the conversation</Text>
          <Text style={{ color: C.muted, textAlign: 'center', fontSize: 12 }}>
            Comments here are only visible on this device during this session.
          </Text>
        </View> : comments.map(item => <View key={item.id} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ backgroundColor: C.accentDark, borderRadius: 18, width: 35, height: 35,
            alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person-outline" size={18} color={C.accent}/>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: C.accent, fontSize: 12, fontWeight: '800' }}>You · Preview</Text>
            <Text style={{ color: C.ink, fontSize: 14 }}>{item.text}</Text>
          </View>
        </View>)}
      </ScrollView>
      <View style={{
        flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10,
        borderTopWidth: 1, borderColor: C.border,
      }}>
        <TextInput accessibilityLabel="Write a comment" value={draft}
          onChangeText={setDraft} maxLength={500} placeholder="Add a comment…"
          placeholderTextColor={C.muted} style={{
            flex: 1, color: C.ink, backgroundColor: 'transparent', paddingVertical: 11,
            paddingHorizontal: 0, fontSize: 16, borderBottomWidth: 1, borderBottomColor: '#3B4752',
          }}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Post local comment"
          disabled={!draft.trim()} onPress={submit} style={{
            opacity: draft.trim() ? 1 : 0.3, minHeight: 44, minWidth: 45,
            alignItems: 'center', justifyContent: 'center',
          }}>
          <Ionicons name="send" color={C.accent} size={23}/>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  </View>;
}
