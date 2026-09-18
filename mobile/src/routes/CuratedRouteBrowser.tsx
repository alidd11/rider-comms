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
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';
import {
  CURATED_ROUTES,
  googleMapsDirectionsUrl,
  type CuratedRoute,
} from './curatedRoutes';
import {
  distanceMilesToRouteStart,
  formatApproachDistance,
  sortRoutesForDiscovery,
  type RideWindow,
  type RiderCoordinate,
} from './routeDiscovery';

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

function routeTracePoints(route: CuratedRoute, width: number, height: number): string {
  const coordinates = [route.start, ...route.waypoints, route.end];
  const lats = coordinates.map((point) => point.lat);
  const lons = coordinates.map((point) => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const padding = 9;
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2;
  const latSpan = Math.max(maxLat - minLat, 0.0001);
  const lonSpan = Math.max(maxLon - minLon, 0.0001);

  return coordinates.map((point) => {
    const x = padding + ((point.lon - minLon) / lonSpan) * drawableWidth;
    const y = padding + (1 - (point.lat - minLat) / latSpan) * drawableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function RouteTrace({ route, width = 132, height = 76 }: { route: CuratedRoute; width?: number; height?: number }) {
  const points = routeTracePoints(route, width, height);
  const pointList = points.split(' ');
  const start = pointList[0]?.split(',').map(Number) ?? [9, height - 9];
  const end = pointList.at(-1)?.split(',').map(Number) ?? [width - 9, 9];

  return (
    <View style={[styles.routeTrace, { width, height }]}>
      <Svg width={width} height={height} accessibilityLabel={`Route shape for ${route.name}`}>
        <Polyline points={points} fill="none" stroke={colors.accent} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={start[0]} cy={start[1]} r={4.5} fill={colors.textPrimary} />
        <Circle cx={end[0]} cy={end[1]} r={5.5} fill={colors.accent} />
      </Svg>
    </View>
  );
}

function RouteOverview({
  route,
  riderLocation,
  onClose,
  onGuideToStart,
}: {
  route: CuratedRoute | null;
  riderLocation: RiderCoordinate | null;
  onClose: () => void;
  onGuideToStart: (route: CuratedRoute) => void;
}) {
  const insets = useSafeAreaInsets();
  const [imageFailed, setImageFailed] = React.useState(false);
  if (!route) return null;

  const credit = `${route.image.author} · ${route.image.licenseName}`;
  const approach = riderLocation ? formatApproachDistance(distanceMilesToRouteStart(route, riderLocation)) : null;

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
              <MetaItem icon="navigate-outline" value={`${route.distanceMiles} mi`} label="Route" />
              <MetaItem icon="time-outline" value={`${route.estimatedDurationMinutes} min`} label="Ride time*" />
              <MetaItem icon="speedometer-outline" value={route.difficulty} label="Demand" />
              {approach ? <MetaItem icon="locate-outline" value={approach.replace(' from you', '')} label="To start" /> : null}
            </View>

            <View style={styles.tracePanel}>
              <View style={styles.traceCopy}>
                <Text style={styles.sectionTitle}>Route shape</Text>
                <Text style={styles.traceText}>{route.start.label} → {route.end.label}</Text>
                <Text style={styles.traceTextMuted}>{route.waypoints.length ? `${route.waypoints.length} curated ${route.waypoints.length === 1 ? 'waypoint' : 'waypoints'}` : 'Direct route'}</Text>
              </View>
              <RouteTrace route={route} width={156} height={88} />
            </View>

            <Text style={styles.overviewDescription}>{route.description}</Text>
            <View style={styles.riderNote}>
              <MaterialCommunityIcons name="motorbike" size={22} color={colors.accent} />
              <Text style={styles.riderNoteText}>{route.riderNote}</Text>
            </View>

            <Text style={styles.sectionTitle}>Why ride it</Text>
            <View style={styles.tagRow}>
              <View style={styles.highlightTag}><Text style={styles.highlightText}>{route.roadType}</Text></View>
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
              onPress={() => {
                onClose();
                onGuideToStart(route);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Guide me to the start of ${route.name} in Rider Comms`}
            >
              <Ionicons name="navigate" size={19} color={colors.accentText} />
              <Text style={styles.primaryButtonText}>Guide me to the start</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => void openExternalUrl(googleMapsDirectionsUrl(route), 'Try opening your maps app manually.')}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="map-marker-path" size={19} color={colors.textPrimary} />
              <Text style={styles.secondaryButtonText}>Open full route in Maps</Text>
            </Pressable>
            <Text style={styles.estimateNote}>Rider Comms guides you to the route start. “Open full route” preserves the curated waypoints. *Ride time is an editorial planning estimate, not live traffic.</Text>

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

function CuratedRouteCard({
  route,
  width,
  approach,
  onPress,
}: {
  route: CuratedRoute;
  width: number;
  approach: string | null;
  onPress: () => void;
}) {
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
          <View style={styles.cardTraceWrap}><RouteTrace route={route} width={112} height={66} /></View>
          <View style={styles.cardImageCopy}>
            <Text style={styles.cardRegion}>{route.region}</Text>
            <Text style={styles.cardTitle} numberOfLines={2}>{route.name}</Text>
            <Text style={styles.cardRoad} numberOfLines={1}>{route.road}</Text>
            <View style={styles.cardStats}>
              {approach ? <Text style={[styles.cardStat, styles.cardStatPrimary]}>{approach}</Text> : null}
              <Text style={styles.cardStat}>{route.distanceMiles} mi</Text>
              <Text style={styles.cardStat}>{route.estimatedDurationMinutes} min</Text>
              <Text style={styles.cardStat}>{route.roadType}</Text>
            </View>
          </View>
        </ImageBackground>
      )}
    </Pressable>
  );
}

export function CuratedRouteBrowser({
  rideWindow,
  riderLocation,
  onGuideToStart,
}: {
  rideWindow: RideWindow;
  riderLocation: RiderCoordinate | null;
  onGuideToStart: (route: CuratedRoute) => void;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const [selectedRoute, setSelectedRoute] = React.useState<CuratedRoute | null>(null);
  const routes = React.useMemo(
    () => sortRoutesForDiscovery(CURATED_ROUTES, rideWindow, riderLocation),
    [rideWindow, riderLocation]
  );
  const contentWidth = Math.min(viewportWidth - spacing.lg * 2, 720);
  const cardWidth = contentWidth >= 620 ? (contentWidth - spacing.md) / 2 : contentWidth;

  return (
    <>
      <View style={styles.catalogueIntro}>
        <View>
          <Text style={styles.catalogueEyebrow}>{riderLocation ? 'NEAREST FIRST' : 'RIDER COMMS PICKS'}</Text>
          <Text style={styles.catalogueTitle}>{riderLocation ? 'Closest rides worth the trip' : 'Roads worth the ride'}</Text>
        </View>
        <View style={styles.routeCount}><Text style={styles.routeCountText}>{routes.length}</Text></View>
      </View>
      <Text style={styles.catalogueCopy}>
        {riderLocation
          ? 'Sorted by distance to each route start using your existing location permission. Ride times describe the route itself, not the trip to reach it.'
          : 'Curated UK rides with route shape, road character and planning notes. Allow location on the Map to sort this list by distance to the start.'}
      </Text>
      <View style={styles.cardGrid}>
        {routes.map((route) => {
          const approach = riderLocation ? formatApproachDistance(distanceMilesToRouteStart(route, riderLocation)) : null;
          return <CuratedRouteCard key={route.id} route={route} width={cardWidth} approach={approach} onPress={() => setSelectedRoute(route)} />;
        })}
      </View>
      {routes.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="routes" size={28} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No curated rides in that time window yet</Text>
          <Text style={styles.emptyCopy}>Try another duration. The catalogue will expand without fabricating routes we have not reviewed.</Text>
        </View>
      ) : null}
      <RouteOverview
        key={selectedRoute?.id ?? 'closed'}
        route={selectedRoute}
        riderLocation={riderLocation}
        onClose={() => setSelectedRoute(null)}
        onGuideToStart={onGuideToStart}
      />
    </>
  );
}

const styles = StyleSheet.create({
  catalogueIntro: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.sm },
  catalogueEyebrow: { ...type.caption, color: colors.accent, fontWeight: '800', letterSpacing: 1.2 },
  catalogueTitle: { ...type.heading, color: colors.textPrimary, marginTop: 2 },
  catalogueCopy: { ...type.body, color: colors.textSecondary, maxWidth: 620 },
  routeCount: { minWidth: 34, height: 34, paddingHorizontal: spacing.sm, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  routeCountText: { ...type.label, color: colors.textSecondary },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  curatedCard: { aspectRatio: 1.34, overflow: 'hidden', borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  cardImage: { flex: 1, justifyContent: 'flex-end', padding: spacing.lg, backgroundColor: colors.surfaceRaised },
  cardImageRadius: { borderRadius: radii.md },
  cardImageShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(5,8,11,0.42)', borderRadius: radii.md },
  imageFallback: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  fallbackCopy: { alignItems: 'center', gap: 2, paddingHorizontal: spacing.md },
  fallbackRegion: { ...type.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center' },
  fallbackTitle: { ...type.heading, color: colors.textPrimary, textAlign: 'center' },
  cardImageCopy: { gap: 3 },
  cardTraceWrap: { position: 'absolute', top: spacing.md, right: spacing.md },
  routeTrace: { borderRadius: radii.sm, backgroundColor: 'rgba(8,10,16,0.72)', overflow: 'hidden' },
  cardRegion: { ...type.caption, color: '#FF9C52', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  cardTitle: { ...type.heading, color: '#FFFFFF', fontSize: 25, lineHeight: 29, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 8 },
  cardRoad: { ...type.body, color: 'rgba(255,255,255,0.82)' },
  cardStats: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  cardStat: { ...type.caption, color: '#FFFFFF', textTransform: 'capitalize', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm, backgroundColor: 'rgba(8,12,16,0.68)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  cardStatPrimary: { borderColor: colors.accent, color: '#FFFFFF' },
  overviewRoot: { flex: 1, backgroundColor: colors.background },
  overviewScroll: { backgroundColor: colors.background },
  overviewHero: { height: 320, justifyContent: 'flex-end' },
  overviewImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  overviewImageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  overviewShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(4,7,10,0.42)' },
  closeButton: { position: 'absolute', right: spacing.md, width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,15,20,0.82)' },
  heroCopy: { padding: spacing.lg, gap: spacing.xs },
  heroRegion: { ...type.label, color: colors.accent, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  heroTitle: { ...type.title, color: '#FFFFFF' },
  heroRoad: { ...type.body, color: '#FFFFFF', fontWeight: '700' },
  overviewBody: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  metaStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  metaItem: { minWidth: 95, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaValue: { ...type.label, color: colors.textPrimary, textTransform: 'capitalize' },
  metaLabel: { ...type.caption, color: colors.textMuted },
  tracePanel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  traceCopy: { flex: 1, gap: 3 },
  traceText: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  traceTextMuted: { ...type.caption, color: colors.textSecondary },
  overviewDescription: { ...type.body, color: colors.textPrimary, fontSize: 17, lineHeight: 25 },
  riderNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  riderNoteText: { ...type.body, color: colors.textSecondary, flex: 1 },
  sectionTitle: { ...type.subheading, color: colors.textPrimary },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  highlightTag: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
  highlightText: { ...type.caption, color: colors.textPrimary, fontWeight: '700', textTransform: 'capitalize' },
  noticeList: { gap: spacing.sm },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  noticeText: { ...type.body, color: colors.textSecondary, flex: 1 },
  primaryButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.accent },
  primaryButtonText: { ...type.button, color: colors.accentText },
  secondaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  secondaryButtonText: { ...type.button, color: colors.textPrimary },
  estimateNote: { ...type.caption, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  sourceBlock: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  sourceText: { ...type.caption, color: colors.textSecondary },
  sourceLink: { ...type.label, color: colors.accent, paddingVertical: spacing.xs },
  creditLink: { ...type.caption, color: colors.textSecondary, textDecorationLine: 'underline', paddingVertical: spacing.xs },
  emptyState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyTitle: { ...type.subheading, color: colors.textPrimary, textAlign: 'center' },
  emptyCopy: { ...type.body, color: colors.textSecondary, textAlign: 'center', maxWidth: 420 },
});
