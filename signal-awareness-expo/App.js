import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import MapView, { Marker, Polyline, Circle } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

const STORAGE_KEY = 'signal-awareness-mobile-v1';

const PMR = [
  446.00625, 446.01875, 446.03125, 446.04375,
  446.05625, 446.06875, 446.08125, 446.09375,
  446.10625, 446.11875, 446.13125, 446.14375,
  446.15625, 446.16875, 446.18125, 446.19375,
];

const BUILTIN_RF = [
  ...PMR.map((frequencyMHz, index) => ({
    id: 'pmr-' + (index + 1),
    label: 'PMR446 CH ' + (index + 1),
    frequencyMHz,
    category: 'PMR446',
    note: 'Referenčný kanál. iPhone túto RF frekvenciu priamo neprijíma.',
  })),
  {
    id: 'ham-2m-call',
    label: '2 m amateur calling',
    frequencyMHz: 145.5,
    category: 'Amateur',
    note: 'Referenčná frekvencia. Vysielanie vyžaduje príslušné oprávnenie.',
  },
  {
    id: 'ham-70-call',
    label: '70 cm amateur calling',
    frequencyMHz: 433.5,
    category: 'Amateur',
    note: 'Referenčná frekvencia. Vysielanie vyžaduje príslušné oprávnenie.',
  },
  {
    id: 'cb-9',
    label: 'CB CH 9',
    frequencyMHz: 27.065,
    category: 'CB',
    note: 'Referenčný kanál. Over miestne pravidlá a aktuálne využitie.',
  },
];

const DEFAULT_STORE = {
  signals: [],
  observations: [],
  sessions: [],
  customRF: [],
};

function uid(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function nowLabel(value = Date.now()) {
  return new Date(value).toLocaleString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusFor(count, tracked) {
  if (tracked) return 'TRACKED';
  if (count >= 25) return 'FREQUENT';
  if (count >= 5) return 'REPEATED';
  if (count >= 2) return 'KNOWN';
  return 'NEW';
}

function signalColor(rssi) {
  if (rssi == null) return '#6f8588';
  if (rssi >= -50) return '#5de29a';
  if (rssi >= -65) return '#5fcbd7';
  if (rssi >= -80) return '#e1b45f';
  return '#ea7378';
}

function haversine(a, b) {
  const R = 6371000;
  const p1 = a.latitude * Math.PI / 180;
  const p2 = b.latitude * Math.PI / 180;
  const dp = (b.latitude - a.latitude) * Math.PI / 180;
  const dl = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(m) {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km';
}

function SectionTitle({ children, right }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

function Pill({ text, tone = 'neutral' }) {
  return <Text style={[styles.pill, styles['pill_' + tone]]}>{text}</Text>;
}

function Metric({ icon, label, value }) {
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={18} color="#62d3dd" />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function CapabilityRow({ icon, name, value, tone = 'neutral' }) {
  return (
    <View style={styles.capabilityRow}>
      <View style={styles.capabilityLeft}>
        <Ionicons name={icon} size={17} color="#70878a" />
        <Text style={styles.capabilityName}>{name}</Text>
      </View>
      <Pill text={value} tone={tone} />
    </View>
  );
}

function SignalRow({ item, onPress }) {
  return (
    <Pressable style={styles.signalRow} onPress={onPress}>
      <View style={styles.signalIcon}>
        <Ionicons name="radio-outline" size={18} color="#61d3dc" />
      </View>
      <View style={styles.signalTextWrap}>
        <Text style={styles.signalName} numberOfLines={1}>{item.label}</Text>
        <Text style={styles.signalMeta}>{item.kind} · {item.status} · {item.detections}×</Text>
      </View>
      <View style={styles.signalRight}>
        <Text style={[styles.rssi, { color: signalColor(item.lastRssi) }]}>
          {item.lastRssi == null ? '—' : item.lastRssi}
        </Text>
        <Text style={styles.tiny}>{item.lastRssi == null ? '' : 'dBm'}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color="#4b6063" />
    </Pressable>
  );
}

export default function App() {
  const [tab, setTab] = useState('overview');
  const [store, setStore] = useState(DEFAULT_STORE);
  const [loaded, setLoaded] = useState(false);
  const [location, setLocation] = useState(null);
  const [heading, setHeading] = useState(null);
  const [mag, setMag] = useState({ x: 0, y: 0, z: 0 });
  const [accel, setAccel] = useState({ x: 0, y: 0, z: 0 });
  const [gyro, setGyro] = useState({ x: 0, y: 0, z: 0 });
  const [locationState, setLocationState] = useState('IDLE');
  const [sensorState, setSensorState] = useState('IDLE');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [selectedSignalId, setSelectedSignalId] = useState(null);
  const activeSessionRef = useRef(null);
  const locationSub = useRef(null);
  const headingSub = useRef(null);
  const sensorSubs = useRef([]);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          setStore({
            signals: Array.isArray(parsed.signals) ? parsed.signals : [],
            observations: Array.isArray(parsed.observations) ? parsed.observations : [],
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
            customRF: Array.isArray(parsed.customRF) ? parsed.customRF : [],
          });
        }
      } catch {}
      setLoaded(true);
    })();

    return () => {
      locationSub.current?.remove?.();
      headingSub.current?.remove?.();
      sensorSubs.current.forEach(s => s?.remove?.());
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...store,
        observations: store.observations.slice(-6000),
        sessions: store.sessions.slice(0, 150),
      })
    ).catch(() => {});
  }, [store, loaded]);

  const selectedSignal = store.signals.find(s => s.id === selectedSignalId) || null;
  const activeSession = store.sessions.find(s => s.id === activeSessionId) || null;

  const currentPosition = location ? {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  } : null;

  const routePoints = useMemo(
    () => store.observations
      .filter(o => o.source === 'gps' && o.latitude != null && o.longitude != null)
      .slice(-1000)
      .map(o => ({ latitude: o.latitude, longitude: o.longitude })),
    [store.observations]
  );

  const routeDistance = useMemo(() => {
    let total = 0;
    for (let i = 1; i < routePoints.length; i++) total += haversine(routePoints[i - 1], routePoints[i]);
    return total;
  }, [routePoints]);

  const strongest = useMemo(
    () => [...store.signals]
      .filter(s => s.lastRssi != null)
      .sort((a, b) => b.lastRssi - a.lastRssi)
      .slice(0, 5),
    [store.signals]
  );

  const magneticTotal = Math.sqrt(mag.x ** 2 + mag.y ** 2 + mag.z ** 2);

  async function enableSensors() {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setLocationState('DENIED');
      } else {
        setLocationState('ACTIVE');
        locationSub.current?.remove?.();
        locationSub.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 8,
            timeInterval: 3000,
          },
          pos => {
            setLocation(pos);
            const sessionId = activeSessionRef.current;
            if (!sessionId) return;
            setStore(prev => ({
              ...prev,
              observations: [
                ...prev.observations,
                {
                  id: uid('obs'),
                  signalId: 'observer-route',
                  label: 'Observer route',
                  kind: 'Route',
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  accuracy: pos.coords.accuracy,
                  heading: pos.coords.heading,
                  at: Date.now(),
                  source: 'gps',
                },
              ].slice(-6000),
              sessions: prev.sessions.map(s =>
                s.id === sessionId ? { ...s, observationCount: s.observationCount + 1 } : s
              ),
            }));
          }
        );

        headingSub.current?.remove?.();
        headingSub.current = await Location.watchHeadingAsync(h => {
          const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          setHeading(value);
        });
      }
    } catch {
      setLocationState('ERROR');
    }

    try {
      Magnetometer.setUpdateInterval(500);
      Accelerometer.setUpdateInterval(500);
      Gyroscope.setUpdateInterval(500);
      sensorSubs.current.forEach(s => s?.remove?.());
      sensorSubs.current = [
        Magnetometer.addListener(setMag),
        Accelerometer.addListener(setAccel),
        Gyroscope.addListener(setGyro),
      ];
      setSensorState('ACTIVE');
    } catch {
      setSensorState('ERROR');
    }
  }

  async function startSession() {
    if (locationState !== 'ACTIVE' || sensorState !== 'ACTIVE') await enableSensors();
    const id = uid('session');
    const session = {
      id,
      name: 'Field Session ' + nowLabel(),
      startedAt: Date.now(),
      endedAt: null,
      observationCount: 0,
    };
    setStore(prev => ({ ...prev, sessions: [session, ...prev.sessions] }));
    setActiveSessionId(id);
  }

  function stopSession() {
    const id = activeSessionId;
    if (!id) return;
    setStore(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.id === id ? { ...s, endedAt: Date.now() } : s),
    }));
    setActiveSessionId(null);
  }

  function addObservation({ label, kind, rssi, frequencyMHz }) {
    const clean = label.trim();
    if (!clean) return;
    const now = Date.now();
    const base = (kind + '-' + clean).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const id = base || uid('sig');

    setStore(prev => {
      const existing = prev.signals.find(s => s.id === id);
      const detections = (existing?.detections || 0) + 1;
      const tracked = !!existing?.tracked;
      const nextSignal = {
        id,
        label: clean,
        kind,
        firstSeen: existing?.firstSeen || now,
        lastSeen: now,
        detections,
        tracked,
        status: statusFor(detections, tracked),
        lastRssi: Number.isFinite(rssi) ? rssi : null,
        note: existing?.note || '',
        tags: existing?.tags || [],
      };
      const obs = {
        id: uid('obs'),
        signalId: id,
        label: clean,
        kind,
        rssi: Number.isFinite(rssi) ? rssi : null,
        frequencyMHz: Number.isFinite(frequencyMHz) ? frequencyMHz : null,
        latitude: currentPosition?.latitude ?? null,
        longitude: currentPosition?.longitude ?? null,
        accuracy: location?.coords?.accuracy ?? null,
        heading: heading ?? null,
        at: now,
        source: 'manual',
      };
      return {
        ...prev,
        signals: [nextSignal, ...prev.signals.filter(s => s.id !== id)],
        observations: [...prev.observations, obs].slice(-6000),
        sessions: activeSessionId
          ? prev.sessions.map(s => s.id === activeSessionId ? { ...s, observationCount: s.observationCount + 1 } : s)
          : prev.sessions,
      };
    });
  }

  function toggleTracked(id) {
    setStore(prev => ({
      ...prev,
      signals: prev.signals.map(s => {
        if (s.id !== id) return s;
        const tracked = !s.tracked;
        return { ...s, tracked, status: statusFor(s.detections, tracked) };
      }),
    }));
  }

  function saveNote(id, note) {
    setStore(prev => ({
      ...prev,
      signals: prev.signals.map(s => s.id === id ? { ...s, note } : s),
    }));
  }

  function addCustomRF(item) {
    setStore(prev => ({ ...prev, customRF: [item, ...prev.customRF] }));
  }

  async function exportFile(kind) {
    let content = '';
    let filename = '';

    if (kind === 'json') {
      content = JSON.stringify(store, null, 2);
      filename = 'signal-awareness.json';
    }

    if (kind === 'csv') {
      const head = 'timestamp,signal_id,label,kind,rssi,frequency_mhz,latitude,longitude,accuracy,heading,source';
      const rows = store.observations.map(o => [
        new Date(o.at).toISOString(),
        o.signalId,
        JSON.stringify(o.label || ''),
        o.kind,
        o.rssi ?? '',
        o.frequencyMHz ?? '',
        o.latitude ?? '',
        o.longitude ?? '',
        o.accuracy ?? '',
        o.heading ?? '',
        o.source,
      ].join(','));
      content = [head, ...rows].join('\n');
      filename = 'signal-awareness.csv';
    }

    if (kind === 'gpx') {
      const pts = store.observations
        .filter(o => o.latitude != null && o.longitude != null)
        .map(o => '<wpt lat="' + o.latitude + '" lon="' + o.longitude + '"><name>' +
          String(o.label || 'Observation').replaceAll('&', '&amp;').replaceAll('<', '&lt;') +
          '</name><time>' + new Date(o.at).toISOString() + '</time></wpt>')
        .join('');
      content = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Signal Awareness" xmlns="http://www.topografix.com/GPX/1/1">' + pts + '</gpx>';
      filename = 'signal-awareness.gpx';
    }

    try {
      const uri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      else Alert.alert('Export ready', uri);
    } catch (e) {
      Alert.alert('Export failed', String(e?.message || e));
    }
  }

  function importExternal(text) {
    try {
      const parsed = JSON.parse(text);
      const incoming = Array.isArray(parsed) ? parsed : parsed.observations;
      if (!Array.isArray(incoming)) throw new Error('JSON must contain an observations array');

      let count = 0;
      incoming.forEach(item => {
        if (!item?.label) return;
        addObservation({
          label: String(item.label),
          kind: item.kind || 'External',
          rssi: Number(item.rssi),
          frequencyMHz: Number(item.frequencyMHz),
        });
        count++;
      });
      Alert.alert('Import complete', count + ' observations imported.');
    } catch (e) {
      Alert.alert('Invalid import', String(e?.message || e));
    }
  }

  function clearAll() {
    Alert.alert(
      'Delete local data?',
      'This removes sessions, observations, signals and custom RF references from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setStore(DEFAULT_STORE);
            setActiveSessionId(null);
            setSelectedSignalId(null);
          },
        },
      ]
    );
  }

  const content = {
    overview: (
      <OverviewPage
        store={store}
        activeSession={activeSession}
        strongest={strongest}
        location={location}
        heading={heading}
        magTotal={magneticTotal}
        locationState={locationState}
        sensorState={sensorState}
        routeDistance={routeDistance}
        onEnable={enableSensors}
        onStart={startSession}
        onStop={stopSession}
        onOpenSignal={(id) => { setSelectedSignalId(id); setTab('signals'); }}
      />
    ),
    field: (
      <FieldPage
        activeSession={activeSession}
        currentPosition={currentPosition}
        heading={heading}
        magTotal={magneticTotal}
        accel={accel}
        gyro={gyro}
        onStart={startSession}
        onStop={stopSession}
        onAdd={addObservation}
      />
    ),
    map: (
      <MapPage
        currentPosition={currentPosition}
        routePoints={routePoints}
        observations={store.observations}
      />
    ),
    signals: (
      <SignalsPage
        signals={store.signals}
        observations={store.observations}
        selectedSignal={selectedSignal}
        onSelect={setSelectedSignalId}
        onTrack={toggleTracked}
        onSaveNote={saveNote}
        heading={heading}
      />
    ),
    rf: (
      <RFPage
        builtIn={BUILTIN_RF}
        custom={store.customRF}
        currentPosition={currentPosition}
        onAdd={addCustomRF}
      />
    ),
    data: (
      <DataPage
        store={store}
        onExport={exportFile}
        onImport={importExternal}
        onClear={clearAll}
      />
    ),
  }[tab];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.app}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.eyebrow}>LOCAL FIELD SYSTEM</Text>
            <Text style={styles.appTitle}>Signal Awareness</Text>
          </View>
          <View style={styles.localBadge}>
            <View style={styles.greenDot} />
            <Text style={styles.localBadgeText}>LOCAL</Text>
          </View>
        </View>

        <View style={styles.pageWrap}>{content}</View>

        <View style={styles.bottomNav}>
          <NavButton tab="overview" current={tab} label="Overview" icon="speedometer-outline" setTab={setTab} />
          <NavButton tab="field" current={tab} label="Field" icon="navigate-outline" setTab={setTab} />
          <NavButton tab="map" current={tab} label="Map" icon="map-outline" setTab={setTab} />
          <NavButton tab="signals" current={tab} label="Signals" icon="radio-outline" setTab={setTab} />
          <NavButton tab="rf" current={tab} label="RF" icon="cellular-outline" setTab={setTab} />
          <NavButton tab="data" current={tab} label="Data" icon="server-outline" setTab={setTab} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function NavButton({ tab, current, label, icon, setTab }) {
  const active = tab === current;
  return (
    <Pressable style={[styles.navButton, active && styles.navButtonActive]} onPress={() => setTab(tab)}>
      <Ionicons name={icon} size={18} color={active ? '#68dce5' : '#617679'} />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function Page({ children }) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

function Header({ eyebrow, title, body, right }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.headerTitle}>{title}</Text>
        {!!body && <Text style={styles.headerBody}>{body}</Text>}
      </View>
      {right}
    </View>
  );
}

function OverviewPage({
  store,
  activeSession,
  strongest,
  location,
  heading,
  magTotal,
  locationState,
  sensorState,
  routeDistance,
  onEnable,
  onStart,
  onStop,
  onOpenSignal,
}) {
  return (
    <Page>
      <Header
        eyebrow="SITUATIONAL OVERVIEW"
        title="Environment"
        body="On-device field logging, map, sensors and RF reference. No cloud account required."
      />

      <Pressable
        style={[styles.primaryButton, activeSession && styles.stopButton]}
        onPress={activeSession ? onStop : onStart}
      >
        <Ionicons name={activeSession ? 'stop' : 'play'} size={16} color={activeSession ? '#270809' : '#001416'} />
        <Text style={[styles.primaryButtonText, activeSession && { color: '#270809' }]}>
          {activeSession ? 'STOP FIELD SESSION' : 'START FIELD SESSION'}
        </Text>
      </Pressable>

      <View style={styles.metricGrid}>
        <Metric icon="radio-outline" label="Signals" value={store.signals.length} />
        <Metric icon="location-outline" label="Observations" value={store.observations.length} />
        <Metric icon="shield-checkmark-outline" label="Tracked" value={store.signals.filter(s => s.tracked).length} />
        <Metric icon="navigate-outline" label="Route" value={formatDistance(routeDistance)} />
      </View>

      <SectionTitle>CAPABILITY ENGINE</SectionTitle>
      <View style={styles.card}>
        <CapabilityRow icon="location-outline" name="GPS / location" value={locationState} tone={locationState === 'ACTIVE' ? 'good' : 'info'} />
        <CapabilityRow icon="compass-outline" name="Heading" value={heading == null ? 'WAITING' : Math.round(heading) + '°'} tone={heading == null ? 'info' : 'good'} />
        <CapabilityRow icon="magnet-outline" name="Magnetometer" value={sensorState} tone={sensorState === 'ACTIVE' ? 'good' : 'info'} />
        <CapabilityRow icon="camera-outline" name="Camera Finder" value="AVAILABLE" tone="good" />
        <CapabilityRow icon="bluetooth-outline" name="BLE scan in Expo Go" value="NATIVE / BRIDGE REQUIRED" tone="warn" />
        <CapabilityRow icon="wifi-outline" name="Nearby Wi-Fi scan on iOS" value="NOT AVAILABLE" tone="warn" />
        <Pressable style={styles.secondaryButton} onPress={onEnable}>
          <Ionicons name="power-outline" size={16} color="#d8e6e7" />
          <Text style={styles.secondaryButtonText}>Enable sensors</Text>
        </Pressable>
        <View style={styles.notice}>
          <Ionicons name="warning-outline" size={17} color="#d9ab57" />
          <Text style={styles.noticeText}>
            Expo Go does not expose unrestricted BLE or nearby Wi-Fi scanning. The app never invents results; external observations can be imported later.
          </Text>
        </View>
      </View>

      <SectionTitle>LIVE SENSOR SNAPSHOT</SectionTitle>
      <View style={styles.card}>
        <View style={styles.infoGrid}>
          <Info label="Latitude" value={location ? location.coords.latitude.toFixed(6) : '—'} />
          <Info label="Longitude" value={location ? location.coords.longitude.toFixed(6) : '—'} />
          <Info label="Accuracy" value={location?.coords?.accuracy ? Math.round(location.coords.accuracy) + ' m' : '—'} />
          <Info label="Mag field" value={Number.isFinite(magTotal) ? magTotal.toFixed(1) + ' μT' : '—'} />
        </View>
      </View>

      <SectionTitle>STRONGEST / RECENT SIGNALS</SectionTitle>
      <View style={[styles.card, styles.cardFlush]}>
        {strongest.length === 0
          ? <Empty icon="radio-outline" text="No signal observations yet. Add one in Field or import an external sensor log." />
          : strongest.map(item => <SignalRow key={item.id} item={item} onPress={() => onOpenSignal(item.id)} />)}
      </View>
    </Page>
  );
}

function Info({ label, value }) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function FieldPage({
  activeSession,
  currentPosition,
  heading,
  magTotal,
  accel,
  gyro,
  onStart,
  onStop,
  onAdd,
}) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('Manual');
  const [rssi, setRssi] = useState('-65');
  const [frequency, setFrequency] = useState('');

  function submit() {
    if (!label.trim()) {
      Alert.alert('Missing label', 'Enter a signal or observation label.');
      return;
    }
    onAdd({
      label,
      kind,
      rssi: Number(rssi),
      frequencyMHz: frequency ? Number(frequency) : NaN,
    });
    setLabel('');
  }

  return (
    <Page>
      <Header
        eyebrow="FIELD WORKSPACE"
        title={activeSession ? 'Session active' : 'Ready'}
        body={activeSession ? activeSession.name : 'Start a session to log your route and sensor context.'}
      />

      <Pressable style={[styles.primaryButton, activeSession && styles.stopButton]} onPress={activeSession ? onStop : onStart}>
        <Text style={styles.primaryButtonText}>{activeSession ? 'STOP SESSION' : 'START SESSION'}</Text>
      </Pressable>

      <SectionTitle>QUICK OBSERVATION</SectionTitle>
      <View style={styles.card}>
        <Field label="Signal label">
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Unknown BLE A17"
            placeholderTextColor="#4e6366"
            style={styles.input}
          />
        </Field>

        <View style={styles.chipRow}>
          {['Manual', 'BLE', 'Wi-Fi', 'RF', 'External'].map(item => (
            <Pressable key={item} style={[styles.chip, kind === item && styles.chipActive]} onPress={() => setKind(item)}>
              <Text style={[styles.chipText, kind === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.twoCol}>
          <Field label="RSSI dBm">
            <TextInput
              value={rssi}
              onChangeText={setRssi}
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />
          </Field>
          <Field label="Frequency MHz">
            <TextInput
              value={frequency}
              onChangeText={setFrequency}
              keyboardType="decimal-pad"
              placeholder="optional"
              placeholderTextColor="#4e6366"
              style={styles.input}
            />
          </Field>
        </View>

        <Pressable style={styles.primaryButton} onPress={submit}>
          <Ionicons name="add" size={17} color="#001416" />
          <Text style={styles.primaryButtonText}>ADD OBSERVATION</Text>
        </Pressable>

        <Text style={styles.formFoot}>
          GPS {currentPosition ? currentPosition.latitude.toFixed(5) + ', ' + currentPosition.longitude.toFixed(5) : '—'} · Heading {heading == null ? '—' : Math.round(heading) + '°'}
        </Text>
      </View>

      <SectionTitle>SENSOR DETAIL</SectionTitle>
      <View style={styles.card}>
        <View style={styles.infoGrid}>
          <Info label="Magnetic field" value={magTotal.toFixed(1) + ' μT'} />
          <Info label="Heading" value={heading == null ? '—' : Math.round(heading) + '°'} />
          <Info label="Accel X" value={accel.x.toFixed(3)} />
          <Info label="Accel Y" value={accel.y.toFixed(3)} />
          <Info label="Gyro X" value={gyro.x.toFixed(3)} />
          <Info label="Gyro Z" value={gyro.z.toFixed(3)} />
        </View>
      </View>
    </Page>
  );
}

function Field({ label, children }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function MapPage({ currentPosition, routePoints, observations }) {
  const markers = observations.filter(o => o.latitude != null && o.longitude != null && o.source !== 'gps').slice(-300);

  if (!currentPosition) {
    return (
      <Page>
        <Header eyebrow="FIELD MAP" title="Observations" body="Enable GPS from Overview or start a Field Session." />
        <View style={styles.card}>
          <Empty icon="map-outline" text="No current position yet." />
        </View>
      </Page>
    );
  }

  return (
    <View style={styles.fullPage}>
      <View style={styles.mapHeader}>
        <Text style={styles.eyebrow}>FIELD MAP</Text>
        <Text style={styles.headerTitle}>Observations</Text>
        <Text style={styles.headerBody}>Points show where your phone recorded an observation, not a confirmed path of another device.</Text>
      </View>
      <MapView
        style={styles.map}
        showsUserLocation
        showsMyLocationButton
        initialRegion={{
          latitude: currentPosition.latitude,
          longitude: currentPosition.longitude,
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        }}
      >
        {routePoints.length > 1 && <Polyline coordinates={routePoints} strokeColor="#61d4de" strokeWidth={3} />}
        {markers.map(o => (
          <Marker
            key={o.id}
            coordinate={{ latitude: o.latitude, longitude: o.longitude }}
            title={o.label}
            description={(o.rssi == null ? '' : o.rssi + ' dBm · ') + nowLabel(o.at)}
            pinColor={signalColor(o.rssi)}
          />
        ))}
      </MapView>
      <View style={styles.mapLegend}>
        <Text style={styles.mapLegendText}>{markers.length} observation markers · {routePoints.length} route points</Text>
      </View>
    </View>
  );
}

function SignalsPage({
  signals,
  observations,
  selectedSignal,
  onSelect,
  onTrack,
  onSaveNote,
  heading,
}) {
  const [query, setQuery] = useState('');
  const [note, setNote] = useState(selectedSignal?.note || '');
  const [showFinder, setShowFinder] = useState(false);

  useEffect(() => setNote(selectedSignal?.note || ''), [selectedSignal?.id]);

  const filtered = signals.filter(s =>
    (s.label + ' ' + s.kind + ' ' + s.status).toLowerCase().includes(query.toLowerCase())
  );

  const selectedObs = selectedSignal
    ? observations.filter(o => o.signalId === selectedSignal.id && o.latitude != null && o.longitude != null)
    : [];

  let movementCorrelation = 0;
  if (selectedObs.length >= 5) {
    const first = selectedObs[0];
    const last = selectedObs[selectedObs.length - 1];
    const distance = haversine(
      { latitude: first.latitude, longitude: first.longitude },
      { latitude: last.latitude, longitude: last.longitude }
    );
    movementCorrelation = Math.min(95, Math.round(40 + Math.min(55, distance / 20)));
  }

  if (showFinder && selectedSignal) {
    return <FinderPage signal={selectedSignal} heading={heading} onClose={() => setShowFinder(false)} />;
  }

  return (
    <Page>
      <Header eyebrow="SIGNAL RECORDS" title="Signals" body="Local observations, repeat status, tracking and notes." />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search signals…"
        placeholderTextColor="#4e6366"
        style={styles.input}
      />

      <SectionTitle>RECORDS</SectionTitle>
      <View style={[styles.card, styles.cardFlush]}>
        {filtered.length === 0
          ? <Empty icon="search-outline" text="No matching signals." />
          : filtered.map(item => <SignalRow key={item.id} item={item} onPress={() => onSelect(item.id)} />)}
      </View>

      {selectedSignal && (
        <>
          <SectionTitle>DETAIL</SectionTitle>
          <View style={styles.card}>
            <View style={styles.detailHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>{selectedSignal.kind}</Text>
                <Text style={styles.detailTitle}>{selectedSignal.label}</Text>
                <Text style={styles.signalMeta}>First {nowLabel(selectedSignal.firstSeen)} · Last {nowLabel(selectedSignal.lastSeen)}</Text>
              </View>
              <View>
                <Text style={[styles.detailRssi, { color: signalColor(selectedSignal.lastRssi) }]}>
                  {selectedSignal.lastRssi ?? '—'}
                </Text>
                <Text style={styles.tiny}>dBm</Text>
              </View>
            </View>

            <View style={styles.infoGrid}>
              <Info label="Detections" value={String(selectedSignal.detections)} />
              <Info label="Status" value={selectedSignal.status} />
              <Info label="Locations" value={String(selectedObs.length)} />
              <Info label="Movement correlation" value={movementCorrelation + '%'} />
            </View>

            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={17} color="#6fcbd5" />
              <Text style={styles.noticeText}>
                Movement correlation is a behavioral similarity score, not proof that a person or physical device followed you.
              </Text>
            </View>

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Local note…"
              placeholderTextColor="#4e6366"
              multiline
              style={[styles.input, styles.textArea]}
            />

            <View style={styles.buttonRow}>
              <Pressable style={styles.secondaryButton} onPress={() => onTrack(selectedSignal.id)}>
                <Ionicons name="shield-outline" size={16} color="#d8e6e7" />
                <Text style={styles.secondaryButtonText}>{selectedSignal.tracked ? 'UNTRACK' : 'TRACK'}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => onSaveNote(selectedSignal.id, note)}>
                <Ionicons name="save-outline" size={16} color="#d8e6e7" />
                <Text style={styles.secondaryButtonText}>SAVE NOTE</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => setShowFinder(true)}>
                <Ionicons name="camera-outline" size={16} color="#d8e6e7" />
                <Text style={styles.secondaryButtonText}>FINDER</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </Page>
  );
}

function FinderPage({ signal, heading, onClose }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [sample, setSample] = useState(signal.lastRssi ?? -70);
  const [history, setHistory] = useState([]);
  const [best, setBest] = useState({ rssi: -999, heading: null });

  function applySample(delta) {
    const next = Math.max(-100, Math.min(-30, sample + delta));
    setHistory(prev => [...prev.slice(-19), sample]);
    setSample(next);
    if (next > best.rssi) setBest({ rssi: next, heading });
  }

  const avg = history.length ? history.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, history.length) : sample;
  const trend = history.length < 2 ? 'CALIBRATING' : sample > avg + 1 ? 'STRONGER ↑' : sample < avg - 1 ? 'WEAKER ↓' : 'STABLE →';

  if (!permission?.granted) {
    return (
      <Page>
        <Header eyebrow="CAMERA FINDER" title={signal.label} body="Camera access is used only for the local finder overlay." />
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>ALLOW CAMERA</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onClose}>
          <Text style={styles.secondaryButtonText}>BACK</Text>
        </Pressable>
      </Page>
    );
  }

  return (
    <View style={styles.finder}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.finderShade} />
      <Pressable style={styles.finderClose} onPress={onClose}>
        <Ionicons name="close" size={24} color="#fff" />
      </Pressable>
      <View style={styles.finderTop}>
        <Text style={styles.eyebrow}>CAMERA FINDER · ESTIMATED</Text>
        <Text style={styles.finderTarget}>{signal.label}</Text>
      </View>
      <View style={styles.reticleWrap}>
        <View style={styles.reticle}>
          <Ionicons name="compass-outline" size={42} color="#76e5ed" />
        </View>
        <Text style={styles.finderHeading}>{heading == null ? '—' : Math.round(heading) + '°'}</Text>
      </View>
      <View style={styles.finderPanel}>
        <View style={styles.finderMetricRow}>
          <View>
            <Text style={styles.tiny}>RSSI SAMPLE</Text>
            <Text style={[styles.finderRssi, { color: signalColor(sample) }]}>{sample} dBm</Text>
          </View>
          <View>
            <Text style={styles.tiny}>TREND</Text>
            <Text style={styles.finderTrend}>{trend}</Text>
          </View>
        </View>
        <View style={styles.sampleButtons}>
          <Pressable style={styles.sampleButton} onPress={() => applySample(-5)}><Text style={styles.sampleButtonText}>−5</Text></Pressable>
          <Pressable style={styles.sampleButton} onPress={() => applySample(-1)}><Text style={styles.sampleButtonText}>−1</Text></Pressable>
          <Pressable style={styles.sampleButton} onPress={() => applySample(1)}><Text style={styles.sampleButtonText}>+1</Text></Pressable>
          <Pressable style={styles.sampleButton} onPress={() => applySample(5)}><Text style={styles.sampleButtonText}>+5</Text></Pressable>
        </View>
        <Text style={styles.finderSmall}>Best heading {best.heading == null ? '—' : Math.round(best.heading) + '°'} at {best.rssi <= -999 ? '—' : best.rssi + ' dBm'}</Text>
        <Text style={styles.finderNotice}>
          Expo Go cannot supply a real BLE RSSI stream. Use manual/external RSSI samples here; direction remains an estimate affected by reflections and body shielding.
        </Text>
      </View>
    </View>
  );
}

function RFPage({ builtIn, custom, currentPosition, onAdd }) {
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState('');
  const [frequency, setFrequency] = useState('');
  const [category, setCategory] = useState('Custom');
  const [radius, setRadius] = useState('25');

  function distanceTo(item) {
    if (!currentPosition || item.latitude == null || item.longitude == null) return null;
    return haversine(currentPosition, { latitude: item.latitude, longitude: item.longitude });
  }

  const all = [...builtIn, ...custom].filter(item => {
    if (item.latitude == null || item.longitude == null || item.radiusKm == null || !currentPosition) return true;
    const d = distanceTo(item);
    return d != null && d <= item.radiusKm * 1000;
  });

  const filtered = all.filter(item =>
    (item.label + ' ' + item.category + ' ' + item.frequencyMHz).toLowerCase().includes(query.toLowerCase())
  );

  function save() {
    const f = Number(frequency);
    if (!label.trim() || !Number.isFinite(f)) {
      Alert.alert('Missing data', 'Enter a name and numeric frequency.');
      return;
    }
    onAdd({
      id: uid('rf'),
      label: label.trim(),
      frequencyMHz: f,
      category: category.trim() || 'Custom',
      latitude: currentPosition?.latitude ?? null,
      longitude: currentPosition?.longitude ?? null,
      radiusKm: currentPosition ? Number(radius) || 25 : null,
      note: currentPosition ? 'User-defined regional reference.' : 'User-defined reference.',
    });
    setShowAdd(false);
    setLabel('');
    setFrequency('');
  }

  return (
    <Page>
      <Header eyebrow="RF REFERENCE" title="Frequencies" body="Reference catalog filtered by location for regional entries." />
      <View style={styles.notice}>
        <Ionicons name="warning-outline" size={17} color="#d9ab57" />
        <Text style={styles.noticeText}>This is not an RF receiver. The iPhone/Expo app does not directly receive VHF/UHF/PMR/DMR traffic.</Text>
      </View>

      <View style={styles.buttonRow}>
        <Pressable style={styles.secondaryButton} onPress={() => setShowAdd(v => !v)}>
          <Ionicons name="add" size={16} color="#d8e6e7" />
          <Text style={styles.secondaryButtonText}>ADD CUSTOM</Text>
        </Pressable>
      </View>

      {showAdd && (
        <View style={styles.card}>
          <Field label="Name"><TextInput value={label} onChangeText={setLabel} style={styles.input} /></Field>
          <View style={styles.twoCol}>
            <Field label="Frequency MHz"><TextInput value={frequency} onChangeText={setFrequency} keyboardType="decimal-pad" style={styles.input} /></Field>
            <Field label="Radius km"><TextInput value={radius} onChangeText={setRadius} keyboardType="number-pad" style={styles.input} /></Field>
          </View>
          <Field label="Category"><TextInput value={category} onChangeText={setCategory} style={styles.input} /></Field>
          <Pressable style={styles.primaryButton} onPress={save}><Text style={styles.primaryButtonText}>SAVE REFERENCE</Text></Pressable>
        </View>
      )}

      <TextInput value={query} onChangeText={setQuery} placeholder="Search frequency / category…" placeholderTextColor="#4e6366" style={styles.input} />

      <SectionTitle>CATALOG</SectionTitle>
      <View style={[styles.card, styles.cardFlush]}>
        {filtered.map(item => {
          const d = distanceTo(item);
          return (
            <View style={styles.rfRow} key={item.id}>
              <View style={styles.rfFreqWrap}>
                <Text style={styles.rfFreq}>{Number(item.frequencyMHz).toFixed(item.frequencyMHz < 100 ? 3 : 5)}</Text>
                <Text style={styles.tiny}>MHz</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.signalName}>{item.label}</Text>
                <Text style={styles.signalMeta}>{item.category}{d != null ? ' · ' + formatDistance(d) : ''}</Text>
                {!!item.note && <Text style={styles.rfNote}>{item.note}</Text>}
              </View>
            </View>
          );
        })}
      </View>
    </Page>
  );
}

function DataPage({ store, onExport, onImport, onClear }) {
  const [importText, setImportText] = useState('');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Page>
        <Header eyebrow="LOCAL DATA" title="History & Export" body="All operational records are stored locally in this Expo app." />

        <SectionTitle>SESSIONS</SectionTitle>
        <View style={[styles.card, styles.cardFlush]}>
          {store.sessions.length === 0
            ? <Empty icon="time-outline" text="No sessions yet." />
            : store.sessions.map(item => (
              <View style={styles.sessionRow} key={item.id}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.signalName}>{item.name}</Text>
                  <Text style={styles.signalMeta}>{nowLabel(item.startedAt)} · {item.observationCount} records</Text>
                </View>
                <Pill text={item.endedAt ? 'CLOSED' : 'ACTIVE'} tone={item.endedAt ? 'neutral' : 'good'} />
              </View>
            ))}
        </View>

        <SectionTitle>EXPORT</SectionTitle>
        <View style={styles.exportGrid}>
          <ExportButton icon="document-text-outline" label="CSV" sub="Excel / Sheets" onPress={() => onExport('csv')} />
          <ExportButton icon="code-slash-outline" label="JSON" sub="Full backup" onPress={() => onExport('json')} />
          <ExportButton icon="map-outline" label="GPX" sub="Map points" onPress={() => onExport('gpx')} />
        </View>

        <SectionTitle>EXTERNAL SENSOR / WEBBLUETOOTH BRIDGE</SectionTitle>
        <View style={styles.card}>
          <Text style={styles.headerBody}>
            Paste JSON from Bluefy/WebBluetooth, Android, ESP32 or another scanner. Imported entries join the same local signal history.
          </Text>
          <TextInput
            value={importText}
            onChangeText={setImportText}
            placeholder='{"observations":[{"label":"Device A","kind":"BLE","rssi":-61}]}'
            placeholderTextColor="#4e6366"
            multiline
            style={[styles.input, styles.importArea]}
          />
          <Pressable style={styles.secondaryButton} onPress={() => onImport(importText)}>
            <Ionicons name="download-outline" size={16} color="#d8e6e7" />
            <Text style={styles.secondaryButtonText}>IMPORT JSON</Text>
          </Pressable>
        </View>

        <SectionTitle>PRIVACY</SectionTitle>
        <View style={styles.card}>
          <CapabilityRow icon="person-outline" name="Account" value="NONE" tone="good" />
          <CapabilityRow icon="server-outline" name="Data storage" value="LOCAL" tone="good" />
          <CapabilityRow icon="cloud-offline-outline" name="Cloud sync" value="OFF" tone="good" />
          <Pressable style={styles.dangerButton} onPress={onClear}>
            <Ionicons name="trash-outline" size={16} color="#f19a9d" />
            <Text style={styles.dangerButtonText}>DELETE ALL LOCAL DATA</Text>
          </Pressable>
        </View>
      </Page>
    </KeyboardAvoidingView>
  );
}

function ExportButton({ icon, label, sub, onPress }) {
  return (
    <Pressable style={styles.exportButton} onPress={onPress}>
      <Ionicons name={icon} size={21} color="#5fd3dd" />
      <View>
        <Text style={styles.exportLabel}>{label}</Text>
        <Text style={styles.tiny}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function Empty({ icon, text }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={24} color="#617679" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#05090a' },
  app: { flex: 1, backgroundColor: '#05090a' },
  topBar: {
    minHeight: 66,
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#172426',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.3,
    color: '#6e8487',
  },
  appTitle: {
    color: '#edf7f7',
    fontSize: 19,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  localBadge: {
    borderWidth: 1,
    borderColor: '#1f4434',
    backgroundColor: '#0b1d16',
    borderRadius: 30,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  greenDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#5ce097',
  },
  localBadgeText: { color: '#64dc99', fontSize: 9, fontWeight: '800' },
  pageWrap: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 105 },
  fullPage: { flex: 1, paddingBottom: 76 },
  header: { marginBottom: 15 },
  headerText: { flex: 1 },
  headerTitle: {
    color: '#edf7f7',
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: 4,
  },
  headerBody: {
    color: '#819598',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  primaryButton: {
    minHeight: 46,
    backgroundColor: '#65d7e0',
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  stopButton: { backgroundColor: '#e07175' },
  primaryButtonText: {
    color: '#001416',
    fontSize: 11,
    letterSpacing: 0.6,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#293a3d',
    backgroundColor: '#101a1c',
    borderRadius: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  secondaryButtonText: { color: '#d9e6e7', fontSize: 10, fontWeight: '800' },
  dangerButton: {
    marginTop: 12,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#4b282a',
    backgroundColor: '#231214',
    borderRadius: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  dangerButtonText: { color: '#f19a9d', fontSize: 10, fontWeight: '800' },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 7,
  },
  metric: {
    width: '48.7%',
    minHeight: 102,
    backgroundColor: '#0d1517',
    borderWidth: 1,
    borderColor: '#1b2a2d',
    borderRadius: 15,
    padding: 12,
    justifyContent: 'space-between',
  },
  metricValue: { color: '#edf7f7', fontSize: 22, fontWeight: '900', marginTop: 8 },
  metricLabel: { color: '#71878a', fontSize: 10 },
  sectionTitleRow: {
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { color: '#71878a', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  card: {
    backgroundColor: '#0c1416',
    borderWidth: 1,
    borderColor: '#1b292c',
    borderRadius: 16,
    padding: 13,
    marginBottom: 6,
  },
  cardFlush: { paddingHorizontal: 0, paddingVertical: 2, overflow: 'hidden' },
  capabilityRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#172326',
  },
  capabilityLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  capabilityName: { color: '#dce8e9', fontSize: 12 },
  pill: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    color: '#8ca0a2',
    backgroundColor: '#11191b',
    borderColor: '#263437',
  },
  pill_good: { color: '#61dd98', backgroundColor: '#0d2017', borderColor: '#214936' },
  pill_warn: { color: '#e0b463', backgroundColor: '#211a0d', borderColor: '#4a391d' },
  pill_info: { color: '#65ced8', backgroundColor: '#0d2023', borderColor: '#1f464b' },
  pill_bad: { color: '#ec777c', backgroundColor: '#211012', borderColor: '#4c2226' },
  pill_neutral: {},
  notice: {
    marginTop: 10,
    backgroundColor: '#091113',
    borderWidth: 1,
    borderColor: '#18272a',
    borderRadius: 11,
    padding: 10,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  noticeText: { color: '#8ca0a2', fontSize: 10, lineHeight: 15, flex: 1 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoCell: {
    width: '48.7%',
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#091113',
    borderWidth: 1,
    borderColor: '#172326',
  },
  infoLabel: { color: '#657b7e', fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  infoValue: { color: '#e6f0f1', fontSize: 12, fontWeight: '700', marginTop: 4 },
  signalRow: {
    minHeight: 62,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#172326',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  signalIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#102124',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalTextWrap: { flex: 1 },
  signalName: { color: '#e8f2f3', fontSize: 12, fontWeight: '800' },
  signalMeta: { color: '#708487', fontSize: 9, marginTop: 3 },
  signalRight: { alignItems: 'flex-end' },
  rssi: { fontSize: 14, fontWeight: '900' },
  tiny: { color: '#65787b', fontSize: 8 },
  empty: { minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  emptyText: { color: '#728689', fontSize: 10, textAlign: 'center', lineHeight: 15 },
  field: { marginBottom: 11 },
  fieldLabel: { color: '#748a8d', fontSize: 9, fontWeight: '800', marginBottom: 6, letterSpacing: 0.4 },
  input: {
    minHeight: 43,
    color: '#eaf3f4',
    backgroundColor: '#081012',
    borderWidth: 1,
    borderColor: '#213134',
    borderRadius: 11,
    paddingHorizontal: 11,
    fontSize: 12,
  },
  textArea: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top', marginTop: 10 },
  importArea: { minHeight: 130, paddingTop: 10, textAlignVertical: 'top', marginVertical: 11 },
  twoCol: { flexDirection: 'row', gap: 9 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#233437',
    backgroundColor: '#0c1517',
  },
  chipActive: { borderColor: '#35636a', backgroundColor: '#10272a' },
  chipText: { color: '#768b8e', fontSize: 9, fontWeight: '700' },
  chipTextActive: { color: '#69d8e1' },
  formFoot: { color: '#677b7e', fontSize: 9, textAlign: 'center', marginTop: 10 },
  mapHeader: { padding: 14, paddingBottom: 9 },
  map: { flex: 1, minHeight: 420 },
  mapLegend: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 88,
    backgroundColor: 'rgba(8,15,17,0.9)',
    borderWidth: 1,
    borderColor: '#1b2a2d',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mapLegendText: { color: '#92a5a7', fontSize: 9, textAlign: 'center' },
  detailHead: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 12 },
  detailTitle: { color: '#eef7f8', fontSize: 20, fontWeight: '900', marginTop: 4 },
  detailRssi: { fontSize: 28, fontWeight: '900', textAlign: 'right' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  finder: { flex: 1, backgroundColor: '#000' },
  finderShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  finderClose: {
    position: 'absolute',
    right: 16,
    top: 18,
    width: 42,
    height: 42,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finderTop: { position: 'absolute', left: 17, top: 22, right: 70 },
  finderTarget: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 4 },
  reticleWrap: { position: 'absolute', top: '35%', alignSelf: 'center', alignItems: 'center' },
  reticle: {
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 1,
    borderColor: '#72dfe8',
    backgroundColor: 'rgba(15,44,48,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finderHeading: { color: '#fff', fontSize: 14, fontWeight: '900', marginTop: 8 },
  finderPanel: {
    position: 'absolute',
    left: 13,
    right: 13,
    bottom: 18,
    backgroundColor: 'rgba(5,12,14,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 19,
    padding: 13,
  },
  finderMetricRow: { flexDirection: 'row', justifyContent: 'space-between' },
  finderRssi: { fontSize: 26, fontWeight: '900', marginTop: 3 },
  finderTrend: { color: '#edf6f7', fontSize: 13, fontWeight: '900', marginTop: 7 },
  sampleButtons: { flexDirection: 'row', gap: 7, marginTop: 11 },
  sampleButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#112124',
    borderWidth: 1,
    borderColor: '#284044',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sampleButtonText: { color: '#cce0e2', fontWeight: '800', fontSize: 11 },
  finderSmall: { color: '#8fa3a5', fontSize: 9, marginTop: 10 },
  finderNotice: { color: '#7f9396', fontSize: 8, lineHeight: 12, marginTop: 8 },
  rfRow: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#172326',
    flexDirection: 'row',
    gap: 12,
  },
  rfFreqWrap: { width: 98, alignItems: 'flex-end' },
  rfFreq: { color: '#64d6df', fontSize: 13, fontWeight: '900' },
  rfNote: { color: '#5f7376', fontSize: 8, lineHeight: 12, marginTop: 4 },
  sessionRow: {
    minHeight: 58,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#172326',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  exportGrid: { flexDirection: 'row', gap: 8 },
  exportButton: {
    flex: 1,
    minHeight: 96,
    padding: 11,
    borderRadius: 14,
    backgroundColor: '#0c1517',
    borderWidth: 1,
    borderColor: '#1d2c2f',
    justifyContent: 'space-between',
  },
  exportLabel: { color: '#e8f2f3', fontSize: 12, fontWeight: '900', marginTop: 12 },
  bottomNav: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 7,
    minHeight: 66,
    backgroundColor: '#091012',
    borderWidth: 1,
    borderColor: '#1b2a2d',
    borderRadius: 20,
    padding: 5,
    flexDirection: 'row',
  },
  navButton: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 15,
  },
  navButtonActive: { backgroundColor: '#0f2427' },
  navLabel: { color: '#617679', fontSize: 7, fontWeight: '800' },
  navLabelActive: { color: '#68dce5' },
});