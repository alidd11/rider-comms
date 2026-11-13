import * as React from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  PixelRatio,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors, spacing, pressedFeedback } from '../theme';
import { styles } from './CuratedRouteBrowser.styles';
import { useSettings } from '../settings/SettingsContext';
import {
  CURATED_ROUTES,
  googleMapsDirectionsUrl,
  routeMatchesCategory,
  routeMatchesVehicle,
  ROAD_TYPE_LABELS,
  type CuratedRoute,
  type RouteCategory,
} from './curatedRoutes';
import {
  distanceMilesToRouteStart,
  formatApproachDistance,
  sortRoutesForDiscovery,
  type RideWindow,
  type RiderCoordinate,
} from './routeDiscovery';
import { routeCardImageSource } from './routeCardAssets';
import { routeCardImageUri, routeHeroImageUri } from './routeImages';

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
  const heroImageUri = route ? routeHeroImageUri(route.image.uri) : '';
  const [showHeroImage, setShowHeroImage] = React.useState(false);

  React.useEffect(() => {
    setImageFailed(false);
    setShowHeroImage(false);
    // heroImageUri is empty whenever there is no route.
    if (!heroImageUri) return undefined;

    let active = true;
    void Image.prefetch(heroImageUri)
      .then(() => { if (active) setShowHeroImage(true); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [route?.id, heroImageUri]);

  if (!route) return null;

  const credit = `${route.image.author} · ${route.image.licenseName}`;
  const approach = riderLocation ? formatApproachDistance(distanceMilesToRouteStart(route, riderLocation)) : null;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
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
              <Image source={showHeroImage ? { uri: heroImageUri } : routeCardImageSource(route.id)} style={styles.overviewImage} resizeMode="cover" fadeDuration={0} accessibilityLabel={route.image.alt} onError={() => setImageFailed(true)} />
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
              <MetaItem icon="speedometer-outline" value={route.difficulty} label="Difficulty" />
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
              <View style={styles.highlightTag}><Text style={styles.highlightText}>{ROAD_TYPE_LABELS[route.roadType]}</Text></View>
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
              style={({ pressed }) => [styles.primaryButton, pressed && pressedFeedback]}
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
              style={({ pressed }) => [styles.secondaryButton, pressed && pressedFeedback]}
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
              <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(route.routeSourceUrl, 'The route source is temporarily unavailable.')}>
                <Text style={styles.sourceLink}>Read route source</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(route.conditionsUrl, 'Check current conditions in a browser before riding.')}>
                <Text style={styles.sourceLink}>Check current road conditions</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(route.image.sourceUrl, 'The image source is temporarily unavailable.')}>
                <Text style={styles.creditLink}>Photo: {credit}. Displayed with responsive cropping; source and licence.</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(route.image.licenseUrl, 'The Creative Commons licence is temporarily unavailable.')}>
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
  index,
  onPress,
}: {
  route: CuratedRoute;
  width: number;
  index: number;
  onPress: () => void;
}) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const [highResolutionReady, setHighResolutionReady] = React.useState(false);
  const highResolutionUri = React.useMemo(
    () => routeCardImageUri(route.image.uri, width, PixelRatio.get()),
    [route.image.uri, width],
  );

  React.useEffect(() => {
    let active = true;
    setHighResolutionReady(false);
    const timer = setTimeout(() => {
      void Image.prefetch(highResolutionUri)
        .then((loaded) => {
          if (active && loaded !== false) setHighResolutionReady(true);
        })
        .catch(() => undefined);
    }, Math.min(index, 12) * 90);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [highResolutionUri, index]);

  const showFallback = imageFailed && !highResolutionReady;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${route.name} route overview`}
      onPress={onPress}
      style={({ pressed }) => [styles.curatedCard, { width }, pressed && styles.cardPressed]}
    >
      <View style={styles.cardMedia}>
        {showFallback ? (
          <View style={[styles.cardImage, styles.imageFallback]}>
            <MaterialCommunityIcons name="image-off-outline" size={26} color={colors.textMuted} />
          </View>
        ) : (
          <Image
            source={highResolutionReady ? { uri: highResolutionUri } : routeCardImageSource(route.id)}
            style={styles.cardImage}
            resizeMode="cover"
            fadeDuration={0}
            accessibilityLabel={route.image.alt}
            onError={() => {
              if (highResolutionReady) setHighResolutionReady(false);
              else setImageFailed(true);
            }}
          />
        )}
        <View style={styles.cardImageShade} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{route.name}</Text>
        <Text style={styles.cardRegion} numberOfLines={1}>{route.region}</Text>
        <View style={styles.cardStats}>
          <View style={styles.cardStatItem}><Ionicons name="navigate-outline" size={11} color={colors.textMuted} /><Text style={styles.cardStat}>{route.distanceMiles} mi</Text></View>
          <View style={styles.cardStatItem}><Ionicons name="speedometer-outline" size={11} color={colors.textMuted} /><Text style={styles.cardStat}>{route.difficulty[0].toUpperCase() + route.difficulty.slice(1)}</Text></View>
          <View style={styles.cardStatItem}><Ionicons name="time-outline" size={11} color={colors.textMuted} /><Text style={styles.cardStat}>{route.estimatedDurationMinutes} min</Text></View>
        </View>
      </View>
    </Pressable>
  );
}


function routeDiscoveryText(route: CuratedRoute): string {
  return [route.name, route.region, route.road, route.description, route.riderNote, ...route.highlights].join(' ').toLocaleLowerCase();
}

export function CuratedRouteBrowser({
  rideWindow,
  riderLocation,
  category,
  query,
  onGuideToStart,
}: {
  rideWindow: RideWindow;
  riderLocation: RiderCoordinate | null;
  category: RouteCategory;
  query: string;
  onGuideToStart: (route: CuratedRoute) => void;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const [selectedRoute, setSelectedRoute] = React.useState<CuratedRoute | null>(null);
  // Settings → Vehicle details: only routes that suit what the rider rides.
  const { riderVehicle } = useSettings();
  const routes = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return sortRoutesForDiscovery(CURATED_ROUTES, rideWindow, category === 'near' ? riderLocation : null)
      .filter((route) => routeMatchesVehicle(route, riderVehicle))
      .filter((route) => routeMatchesCategory(route, category))
      .filter((route) => !normalizedQuery || routeDiscoveryText(route).includes(normalizedQuery));
  }, [category, query, rideWindow, riderLocation, riderVehicle]);
  const contentWidth = Math.min(viewportWidth - spacing.lg * 2, 720);
  const cardWidth = contentWidth >= 620 ? (contentWidth - spacing.md) / 2 : contentWidth;

  return (
    <>
      <View style={styles.cardGrid}>
        {routes.map((route, index) => (
          <CuratedRouteCard key={route.id} route={route} width={cardWidth} index={index} onPress={() => setSelectedRoute(route)} />
        ))}
      </View>
      {routes.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="routes" size={28} color={colors.textMuted} />
          {/* A vehicle no reviewed route suits yet (a van or motorhome) gets
              its own message: no filter change would help (PWA: renderRoutes). */}
          {CURATED_ROUTES.some((route) => routeMatchesVehicle(route, riderVehicle)) ? (
            <>
              <Text style={styles.emptyTitle}>No curated rides match</Text>
              <Text style={styles.emptyCopy}>Try another category, duration or search. Rider Comms only shows routes we have actually reviewed.</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyTitle}>No reviewed routes for your vehicle yet</Text>
              <Text style={styles.emptyCopy}>We only list a route for a vehicle once we’ve checked it suits it. You can change your vehicle in Settings → Vehicle details.</Text>
            </>
          )}
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

