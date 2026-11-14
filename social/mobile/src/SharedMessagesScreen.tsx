import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import { IdentityAvatar } from './IdentityAvatar';
import { handleWithAt } from './identityDisplay';
import { AccountApiError, accountErrorMessage } from './authClient';
import type { DirectMessage, RiderAccountClient, RiderProfile, SharedConversation, SharedFriend } from './authClient';

type Props = {
  ownRiderId: string;
  emailVerified: boolean;
  client: RiderAccountClient;
  conversations: readonly SharedConversation[];
  friends: readonly SharedFriend[];
  profiles: Readonly<Record<string, RiderProfile>>;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
};
const messageText = (error: unknown, verified: boolean): string => {
  if (error instanceof AccountApiError) {
    if ((error.code === 'not_verified' || (error.status === 403 && !verified)))
      return 'Verify your email to message riders.';
    if (error.code === 'blocked') return 'You can’t message this rider.';
    if (error.code === 'not_friends') return 'You can only message your Rider Comms friends.';
    if (error.code === 'objectionable_content') return 'That message can’t be sent.';
    if (error.status === 429) return 'Too many attempts. Try again in a few minutes.';
  }
  return accountErrorMessage(error);
};
/** Uses the existing direct-message API and Rider Comms friendships. Not a Social inbox. */
export function SharedMessagesScreen({
  ownRiderId, emailVerified, client, conversations, friends, profiles,
  loading, error, onRefresh,
}: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [thread, setThread] = useState<DirectMessage[]>([]);
  const [threadOwner, setThreadOwner] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadLoadFailed, setThreadLoadFailed] = useState(false);
  const [threadAttempt, setThreadAttempt] = useState(0);
  const requestId = useRef(0);
  const messageScrollRef = useRef<ScrollViewInstance>(null);
  const scrollToLatestRef = useRef(false);
  const otherFriends = friends.filter(person =>
    !conversations.some(entry => entry.friend.riderId === person.riderId)
  );

  const friend = (riderId: string): SharedFriend | undefined =>
    friends.find(item => item.riderId === riderId) ||
    conversations.find(item => item.friend.riderId === riderId)?.friend;
  const display = (riderId: string): { displayName: string; handle: string } => {
    const profile = profiles[riderId], known = friend(riderId);
    return {
      displayName: profile?.displayName || known?.displayName || 'Rider',
      handle: profile?.handle || known?.handle || '',
    };
  };

  useEffect(() => {
    if (!active || loading) return;
    const stillAvailable = friends.some(item => item.riderId === active) ||
      conversations.some(item => item.friend.riderId === active);
    if (!error && stillAvailable) return;
    // A refresh can revoke friendship access or fail while the server state
    // has changed. Close the old thread rather than displaying stale private
    // messages or allowing another send based on an outdated relationship.
    requestId.current += 1;
    setActive(null);
    setThread([]);
    setThreadOwner(null);
    setDraft('');
  }, [active, loading, error, friends, conversations]);

  useEffect(() => {
    // Prevent a slow response from an older thread from appearing under a
    // newly selected rider. No credentials, message bodies or request URLs logged.
    const id = ++requestId.current;
    if (!active) {
      setThreadOwner(null);
      setThread([]);
      setThreadError(null);
      setThreadLoadFailed(false);
      setThreadLoading(false);
      setSending(false);
      return;
    }
    // Clear the previous rider's messages before loading the next thread.
    // A delayed response must never appear beneath another rider's name.
    setThreadOwner(null);
    setThread([]);
    setThreadLoading(true);
    setSending(false);
    setThreadError(null);
    setThreadLoadFailed(false);
    setDraft('');
    scrollToLatestRef.current = true;
    void client.messageThread(active).then(page => {
      if (requestId.current !== id) return;
      scrollToLatestRef.current = true;
      setThread(page.messages);
      setThreadOwner(active);
    }).catch(cause => {
      if (requestId.current !== id) return;
      setThreadError(messageText(cause, emailVerified));
      setThreadLoadFailed(true);
    }).finally(() => { if (requestId.current === id) setThreadLoading(false); });
    return () => { requestId.current += 1; };
  }, [active, client, emailVerified, threadAttempt]);

  async function send(): Promise<void> {
    if (!active || sending || !emailVerified) return;
    const message = draft.trim();
    if (message.length < 1 || message.length > 1000) {
      setThreadError('Enter a message between 1 and 1,000 characters.');
      return;
    }
    // If the rider navigates to a different conversation while a send is
    // in flight, never insert the old rider's message/error into that thread.
    const threadRequestId = requestId.current;
    const recipientId = active;
    setSending(true); setThreadError(null);
    try {
      const sent = await client.sendMessage(recipientId, message);
      if (requestId.current !== threadRequestId) return;
      scrollToLatestRef.current = true;
      setThread(previous => previous.some(item => item.id === sent.id) ? previous : [...previous, sent]);
      setThreadOwner(recipientId);
      setDraft('');
      void onRefresh();
    } catch (cause) {
      if (requestId.current === threadRequestId)
        setThreadError(messageText(cause, emailVerified));
    } finally {
      if (requestId.current === threadRequestId) setSending(false);
    }
  }

  if (active) {
    const rider = display(active);
    // Prevent a single render frame of a previous rider's private messages
    // before the active-thread effect has a chance to clear its state.
    const visibleThread = threadOwner === active ? thread : [];
    return <View testID="shared-message-thread" style={{ flex: 1, minHeight: 0, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8,
        borderBottomWidth: 1, borderColor: C.border }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to conversations"
          onPress={() => setActive(null)} style={{ width: 42, height: 44,
            justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="chevron-back" color={C.ink} size={25}/>
        </Pressable>
        <IdentityAvatar name={rider.displayName} size={38}/>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 15 }}>{rider.displayName}</Text>
          {rider.handle ? <Text style={s.small}>{handleWithAt(rider.handle)}</Text> : null}
        </View>
      </View>
      <ScrollView ref={messageScrollRef} testID="shared-message-bubbles"
        style={{ flex: 1, minHeight: 0 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: 12, gap: 10 }}
        onContentSizeChange={() => {
          if (!scrollToLatestRef.current) return;
          scrollToLatestRef.current = false;
          messageScrollRef.current?.scrollToEnd({ animated: false });
        }}
        showsVerticalScrollIndicator={false}>
        {threadLoading ? <ActivityIndicator color={C.accent}/> : null}
        {!threadLoading && !threadError && threadOwner === active && !visibleThread.length ? <Text style={s.muted}>
          No messages yet.
        </Text> : null}
        {visibleThread.map(item => {
          const mine = item.fromRiderId === ownRiderId;
          return <View key={item.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start',
            maxWidth: '84%', borderRadius: 19, paddingHorizontal: 15,
            paddingVertical: 11, backgroundColor: mine ? '#21433A' : '#242A32' }}>
            <Text style={{ color: C.ink, fontSize: 14, lineHeight: 20 }}>{item.text}</Text>
          </View>;
        })}
      </ScrollView>
      {threadError ? <View style={{ gap: 8, paddingHorizontal: 6 }}>
        <Text accessibilityRole="alert" style={{ color: '#F2B0BA',
          fontSize: 13, lineHeight: 19 }}>{threadError}</Text>
        {threadLoadFailed ? <Pressable accessibilityRole="button"
          accessibilityLabel="Retry loading messages"
          accessibilityState={{ disabled: threadLoading }} disabled={threadLoading} onPress={() => setThreadAttempt(count => count + 1)}
          style={{ alignSelf: 'flex-start', minHeight: 44, minWidth: 100,
            justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Ionicons name="refresh" size={17} color={C.accent}/>
          <Text style={{ color: C.accent, fontSize: 14, fontWeight: '800' }}>Try again</Text>
        </Pressable> : null}
      </View> : null}
      {!emailVerified ? <Text style={{ color: C.muted, fontSize: 12 }}>
        Verify your email to message riders.
      </Text> : null}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end',
        paddingTop: 9, paddingBottom: 7, borderTopWidth: 1, borderTopColor: '#242A32' }}>
        <TextInput accessibilityLabel="Write a message"
          value={draft} onChangeText={setDraft} editable={emailVerified && !sending && !threadLoading && !threadLoadFailed}
          placeholder="Message" placeholderTextColor={C.muted} multiline maxLength={1000}
          style={[s.input, { flex: 1, minHeight: 48, maxHeight: 118,
            fontSize: 16, textAlignVertical: 'top', borderBottomWidth: 0,
            borderRadius: 22, backgroundColor: C.panel, paddingHorizontal: 15,
            paddingVertical: 12 }]}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Send message"
          accessibilityState={{ disabled: !emailVerified || sending || threadLoading || threadLoadFailed || !draft.trim() || draft.trim().length > 1000 }}
          disabled={!emailVerified || sending || threadLoading || threadLoadFailed || !draft.trim() || draft.trim().length > 1000}
          onPress={() => void send()}
          style={{ width: 46, height: 46, borderRadius: 23,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: C.accent, opacity: !emailVerified || sending || threadLoading || threadLoadFailed || !draft.trim() || draft.trim().length > 1000 ? 0.45 : 1 }}>
          <Ionicons name="arrow-up" color="#080A0E" size={22}/>
        </Pressable>
      </View>
    </View>;
  }
  return <View testID="shared-message-inbox" style={{ flex: 1, minHeight: 0, gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={[s.title, { fontSize: 27, letterSpacing: -0.8 }]}>Messages</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh shared messages"
        accessibilityState={{ disabled: loading }} disabled={loading} onPress={() => void onRefresh()}
        style={{ width: 44, height: 44, borderRadius: 22,
          backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="refresh" size={20} color={loading ? C.muted : C.ink}/>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: '#F2B0BA', fontSize: 12 }}>{error}</Text> : null}
    {!emailVerified ? <Text style={{ color: C.muted, fontSize: 12 }}>
      Verify your email to message riders.
    </Text> : null}
    <ScrollView style={{ flex: 1, minHeight: 0 }} showsVerticalScrollIndicator={false}
      contentContainerStyle={{ gap: 2, paddingBottom: 20, flexGrow: 1 }}>
      {!loading && !error && !conversations.length ? <View testID="messages-empty-visual"
        style={{ alignItems: 'center', justifyContent: 'center', minHeight: 285,
          paddingVertical: 35, paddingHorizontal: 15, gap: 13 }}>
        <View style={{ width: 80, height: 80, borderRadius: 28,
          backgroundColor: '#1B262B', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chatbubbles-outline" color={C.accent} size={36}/>
        </View>
        <Text style={[s.cardHeading, { fontSize: 20, fontWeight: '900',
          letterSpacing: -0.4 }]}>No conversations yet</Text>
        <Text style={[s.small, { textAlign: 'center', maxWidth: 290,
          fontSize: 14, lineHeight: 21 }]}>
          Private chats with your Rider Comms friends will appear here.
        </Text>
      </View> : null}
      {conversations.map(entry => {
        const riderId = entry.friend.riderId;
        const rider = display(riderId);
        return <Pressable key={riderId} accessibilityRole="button"
          accessibilityLabel={'Open conversation with ' + rider.displayName}
          onPress={() => setActive(riderId)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 13,
            paddingVertical: 13, minHeight: 76, borderBottomWidth: 1,
            borderColor: '#1F252C' }}>
          <IdentityAvatar name={rider.displayName} size={48}/>
          <View style={{ flex: 1, gap: 5 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: C.ink, fontSize: 15, fontWeight: '800' }}>{rider.displayName}</Text>
              {entry.unreadCount > 0 ? <Text style={{ color: C.accent, fontSize: 12 }}>
                {entry.unreadCount} new
              </Text> : null}
            </View>
            <Text numberOfLines={1} style={s.muted}>{entry.lastMessage.text}</Text>
          </View>
          <Ionicons name="chevron-forward" color={C.muted} size={17}/>
        </Pressable>;
      })}
      {!loading && !error && otherFriends.length > 0 ? <View testID="message-start-friends"
        style={{ paddingTop: 20, gap: 6 }}>
        <Text style={{ color: C.ink, fontSize: 16, fontWeight: '800', paddingBottom: 6 }}>
          Start a message
        </Text>
        <Text style={{ color: C.muted, fontSize: 13, lineHeight: 19, paddingBottom: 8 }}>
          Message someone you’re already friends with on Rider Comms.
        </Text>
        {otherFriends.map(person => {
          const name = display(person.riderId).displayName;
          return <Pressable key={person.riderId} accessibilityRole="button"
            accessibilityLabel={'Start conversation with ' + name}
            onPress={() => setActive(person.riderId)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12,
              minHeight: 58, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.border }}>
            <IdentityAvatar name={name} size={42}/>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{name}</Text>
              {person.handle ? <Text style={s.small}>{handleWithAt(person.handle)}</Text> : null}
            </View>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={C.accent}/>
          </Pressable>;
        })}
      </View> : null}
    </ScrollView>
  </View>;
}
