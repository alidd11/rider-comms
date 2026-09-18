import * as React from 'react';
import {
  Alert,
  Image,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VehicleCategory } from '@rider-comms/shared';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';
import {
  CURATED_ROUTES,
  googleMapsDirectionsUrl,
  routeMatchesVehicle,
  type CuratedRoute,
} from './curatedRoutes';

const VEHICLE_LABELS: Record<VehicleCategory, string> = {
  motorcycle_small: '125cc & small bikes',
  motorcycle_large: 'Larger motorcycles',
  scooter: 'Scooters',
  car: 'Cars',
};

async function openExternalUrl(url: string, failureMessage: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Couldn’t open that link', failureMessage);
  }
}

function MetaItem({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: string; label: string }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={17} color={colors.accent} />
      <View>
        <Text style={styles.metaValue}>{value}</Text>
        <Text style={styles.metaLabel}>{label}</Text>
      </View>
    </View>
  );
}

function RouteOverview({ route, onClose }: { route: CuratedRoute | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [imageFailed, setImageFailed] = React.useState(false);
  if (!route) return null;

  const credit = `${route.image.author} · ${route.image.licenseName}`;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.overviewRoot}>
        <ScrollView
          contentContainerStyle={[styles.overviewScroll, { paddingBottom: insets.bottom + spacing.xxl }]}
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={styles.overviewHero}>
            {imageFailed ? (
              <View style={[styles.overviewImage, styles.overviewImageFallback]}>
                <MaterialCommunityIcons name="image-off-outline" size={34} color={colors.textMuted} />
              </View>
            ) : (
              <Image source={{ uri: route.image.uri }} style={styles.overviewImage} accessibilityLabel={route.image.alt} onError={() => setImageFailed(true)} />
            )}
            <View style={styles.overviewShade} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close route overview"
              hitSlop={8}
              onPress={onClose}
              style={[styles.closeButton, { top: Math.max(insets.top, spacing.md) }]}
            >
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
            <View style={styles.heroCopy}>
              <Text style={styles.heroRegion}>{route.region}</Text>
              <Text style={styles.heroTitle}>{route.name}</Text>
              <Text style={styles.heroRoad}>{route.road}</Text>
            </View>
          </View>

          <View style={styles.overviewBody}>
            <View style={styles.metaStrip}>
              <MetaItem icon="navigate-outline" value={`${route.distanceMiles} mi`} label="Distance" />
              <MetaItem icon="time-outline" value={`${Math.round(route.estimatedDurationMinutes / 15) * 15} min`} label="Ride time*" />
              <MetaItem icon="speedometer-outline" value={route.difficulty} label="Road demand" />
            </View>

            <Text style={styles.overviewDescription}>{route.description}</Text>
            <View style={styles.riderNote}>
              <MaterialCommunityIcons name="motorbike" size={22} color={colors.accent} />
              <Text style={styles.riderNoteText}>{route.riderNote}</Text>
            </View>

            <Text style={styles.sectionTitle}>Route highlights</Text>
            <View style={styles.tagRow}>
              {route.highlights.map((highlight) => (
                <View key={highlight} style={styles.highlightTag}><Text style={styles.highlightText}>{highlight}</Text></View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Plan before you ride</Text>
            <View style={styles.noticeList}>
              {route.safetyNotices.map((notice) => (
                <View key={notice} style={styles.noticeRow}>
                  <Ionicons name="warning-outline" size={18} color={colors.warning} />
                  <Text style={styles.noticeText}>{notice}</Text>
                </View>
              ))}
            </View>

            <Pressable
              style={styles.primaryButton}
              onPress={() => void openExternalUrl(googleMapsDirectionsUrl(route), 'Try opening your maps app manually.')}
              accessibilityRole="button"
            >
              <Ionicons name="navigate" size={19} color={colors.accentText} />
              <Text style={styles.primaryButtonText}>Open route in Maps</Text>
            </Pressable>
            <Text style={styles.estimateNote}>*Planning estimate only. Your maps app calculates live routing. Always obey closures, signs and local restrictions.</Text>

            <View style={styles.sourceBlock}>
              <Text style={styles.sectionTitle}>Sources & image rights</Text>
              <Text style={styles.sourceText}>Route information was reviewed {route.reviewedAt}. Conditions and suitability can change.</Text>
              <Pressable onPress={() => void openExternalUrl(route.routeSourceUrl, 'The route source is temporarily unavailable.')}>
                <Text style={styles.sourceLink}>Read route source</Text>
              </Pressable>
              <Pressable onPress={() => void openExternalUrl(route.conditionsUrl, 'Check current conditions in a browser before riding.')}>
                <Text style={styles.sourceLink}>Check current road conditions</Text>
              </Pressable>
              <Pressable onPress={() => void openExternalUrl(route.image.sourceUrl, 'The image source is temporarily unavailable.')}>
                <Text style={styles.creditLink}>Photo: {credit}. Displayed with responsive cropping; source and licence.</Text>
              </Pressable>
              <Pressable onPress={() => void openExternalUrl(route.image.licenseUrl, 'The Creative Commons licence is temporarily unavailable.')}>
                <Text style={styles.sourceLink}>View image licence</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function CuratedRouteCard({ route, width, onPress }: { route: CuratedRoute; width: number; onPress: () => void }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${route.name} route overview`}
      onPress={onPress}
      style={({ pressed }) => [styles.curatedCard, { width }, pressed && styles.cardPressed]}
    >
      {imageFailed ? (
        <View style={[styles.cardImage, styles.imageFallback]}>
          <MaterialCommunityIcons name="image-off-outline" size={28} color={colors.textMuted} />
          <View style={styles.fallbackCopy}>
            <Text style={styles.fallbackRegion}>{route.region}</Text>
            <Text style={styles.fallbackTitle}>{route.name}</Text>
          </View>
        </View>
      ) : (
        <ImageBackground
          source={{ uri: route.image.uri }}
          style={styles.cardImage}
          imageStyle={styles.cardImageRadius}
          accessibilityLabel={route.image.alt}
          onError={() => setImageFailed(true)}
        >
          <View style={styles.cardImageShade} />
          <View style={styles.cardImageCopy}>
            <Text style={styles.cardRegion}>{route.region}</Text>
            <Text style={styles.cardTitle} numberOfLines={2}>{route.name}</Text>
            <Text style={styles.cardRoad} numberOfLines={1}>{route.road}</Text>
            <View style={styles.cardStats}>
              <Text style={styles.cardStat}>{route.distanceMiles} mi</Text>
              <Text style={styles.cardStat}>{route.estimatedDurationMinutes} min</Text>
              <Text style={styles.cardStat}>{route.difficulty}</Text>
            </View>
          </View>
        </ImageBackground>
      )}
    </Pressable>
  );
}

export function CuratedRouteBrowser({ vehicleFilter }: { vehicleFilter: VehicleCategory | null }) {
  const { width: viewportWidth } = useWindowDimensions();
  const [selectedRoute, setSelectedRoute] = React.useState<CuratedRoute | null>(null);
  const routes = React.useMemo(
    () => CURATED_ROUTES.filter((route) => routeMatchesVehicle(route, vehicleFilter)),
    [vehicleFilter]
  );
  const contentWidth = Math.min(viewportWidth - spacing.lg * 2, 720);
  const cardWidth = contentWidth >= 620 ? (contentWidth - spacing.md) / 2 : contentWidth;

  return (
    <>
      <View style={styles.catalogueIntro}>
        <View>
          <Text style={styles.catalogueEyebrow}>RIDER COMMS PICKS</Text>
          <Text style={styles.catalogueTitle}>Roads worth the ride</Text>
        </View>
        <View style={styles.routeCount}><Text style={styles.routeCountText}>{routes.length}</Text></View>
      </View>
      <Text style={styles.catalogueCopy}>Motorbike-first UK routes researched from published road and tourism sources, with real route photography and visible image credits.</Text>
      <View style={styles.cardGrid}>
        {routes.map((route) => (
          <CuratedRouteCard key={route.id} route={route} width={cardWidth} onPress={() => setSelectedRoute(route)} />
        ))}
      </View>
      <RouteOverview key={selectedRoute?.id ?? 'closed'} route={selectedRoute} onClose={() => setSelectedRoute(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  catalogueIntro: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.sm },
  catalogueEyebrow: { ...type.caption, color: colors.accent, fontWeight: '800', letterSpacing: 1.2 },
  catalogueTitle: { ...type.heading, color: colors.textPrimary, marginTop: 2 },
  catalogueCopy: { ...type.body, color: colors.textSecondary, maxWidth: 620 },
  routeCount: { minWidth: 34, height: 34, paddingHorizontal: spacing.sm, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  routeCountText: { ...type.label, color: colors.textSecondary },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  curatedCard: { aspectRatio: 1.72, overflow: 'hidden', borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  cardImage: { flex: 1, justifyContent: 'flex-end', padding: spacing.md, backgroundColor: colors.surfaceRaised },
  cardImageRadius: { borderRadius: radii.lg },
  cardImageShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(5,8,11,0.34)', borderRadius: radii.lg },
  imageFallback: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  fallbackCopy: { alignItems: 'center', gap: 2, paddingHorizontal: spacing.md },
  fallbackRegion: { ...type.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center' },
  fallbackTitle: { ...type.heading, color: colors.textPrimary, textAlign: 'center' },
  cardImageCopy: { gap: 3 },
  cardRegion: { ...type.caption, color: '#FF9C52', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  cardTitle: { ...type.heading, color: '#FFFFFF', fontSize: 20, lineHeight: 23, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 8 },
  cardRoad: { ...type.body, color: 'rgba(255,255,255,0.82)' },
  cardStats: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  cardStat: { ...type.caption, color: '#FFFFFF', textTransform: 'capitalize', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm, backgroundColor: 'rgba(8,12,16,0.58)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  overviewRoot: { flex: 1, backgroundColor: colors.background },
  overviewScroll: { backgroundColor: colors.background },
  overviewHero: { height: 300, justifyContent: 'flex-end' },
  overviewImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  overviewImageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  overviewShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(4,7,10,0.36)' },
  closeButton: { position: 'absolute', right: spacing.md, width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,15,20,0.82)' },
  heroCopy: { padding: spacing.lg, gap: spacing.xs },
  heroRegion: { ...type.label, color: colors.accent, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  heroTitle: { ...type.title, color: '#FFFFFF' },
  heroRoad: { ...type.body, color: '#FFFFFF', fontWeight: '700' },
  overviewBody: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  metaStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface },
  metaItem: { minWidth: 95, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaValue: { ...type.label, color: colors.textPrimary, textTransform: 'capitalize' },
  metaLabel: { ...type.caption, color: colors.textMuted },
  overviewDescription: { ...type.body, color: colors.textPrimary, fontSize: 17, lineHeight: 25 },
  riderNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface },
  riderNoteText: { ...type.body, color: colors.textSecondary, flex: 1 },
  sectionTitle: { ...type.subheading, color: colors.textPrimary },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  highlightTag: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised },
  highlightText: { ...type.caption, color: colors.textPrimary, fontWeight: '700' },
  noticeList: { gap: spacing.sm },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  noticeText: { ...type.body, color: colors.textSecondary, flex: 1 },
  primaryButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.lg, backgroundColor: colors.accent },
  primaryButtonText: { ...type.button, color: colors.accentText },
  estimateNote: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
  sourceBlock: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  sourceText: { ...type.caption, color: colors.textSecondary },
  sourceLink: { ...type.label, color: colors.accent, paddingVertical: spacing.xs },
  creditLink: { ...type.caption, color: colors.textSecondary, textDecorationLine: 'underline', paddingVertical: spacing.xs },
});
