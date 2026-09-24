import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  Linking,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Clipboard from 'expo-clipboard';
import { VideoView, useVideoPlayer } from 'expo-video';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import {
  continueAsLtwGuest,
  createLtwAccount,
  firebaseErrorMessage,
  loadOrCreateLtwProfile,
  observeLtwAuth,
  signInLtwAccount,
  signOutLtw,
} from './firebase-ltw';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function useKidflixRefresh(delay = 850, refreshTask = null) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    if (refreshing) return;

    setRefreshing(true);
    const startedAt = Date.now();

    try {
      if (typeof refreshTask === 'function') {
        await refreshTask();
      }
    } catch (error) {
      console.warn('Actualisation impossible :', error?.message || error);
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, delay - elapsed);

      setTimeout(() => setRefreshing(false), remaining);
    }
  };

  return { refreshing, onRefresh };
}

const refreshControlProps = {
  tintColor: '#ffffff',
  colors: ['#ffffff'],
  progressBackgroundColor: '#111114',
};

const COLORS = {
  bg: '#000000',
  panel: '#0d0d0f',
  panel2: '#151518',
  card: '#111114',
  line: '#252529',
  text: '#ffffff',
  muted: '#9a9aa3',
  pink: '#ff2e6e',
  cyan: '#16d9f0',
  blue: '#4a8cff',
  green: '#32d583',
  red: '#ff3b5c',
};


// =========================================================
// V56 — PUBLICATIONS DISTANTES SANS FIRESTORE / SUPABASE
// =========================================================
// Mets posts.json à la racine de ton GitHub Pages.
// Après fabrication de l'APK, tu pourras modifier uniquement posts.json.
// Les APK déjà installés récupéreront les nouvelles publications.
const REMOTE_POSTS_URL =
  'https://faroukabuanas13700.github.io/lolitas-of-the-world/posts.json';

function remotePostDate(value, fallbackIndex = 0) {
  if (value === undefined || value === null || value === '') {
    return Date.now() - fallbackIndex * 1000;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) return parsed;

  return Date.now() - fallbackIndex * 1000;
}

function normalizeRemoteOwner(owner) {
  if (!owner || typeof owner !== 'object') {
    return { ...ME, id: 'me' };
  }

  return {
    ...ME,
    ...owner,
    id: owner.id || 'me',
    name: owner.name || ME.name,
    handle: owner.handle || ME.handle,
    avatar: owner.avatar || ME.avatar,
  };
}

function normalizeRemoteComments(value) {
  if (!Array.isArray(value)) return [];

  return value.map((comment, index) => {
    if (typeof comment === 'string') {
      return {
        id: `remote-comment-${index}-${comment.slice(0, 12)}`,
        name: 'Utilisateur',
        text: comment,
      };
    }

    return {
      id: String(comment?.id || `remote-comment-${index}`),
      name: String(comment?.name || comment?.author || 'Utilisateur'),
      text: String(comment?.text || comment?.comment || ''),
    };
  }).filter((comment) => comment.text);
}

function normalizeRemoteMediaItem(entry, hintedType = '') {
  if (!entry) return null;

  if (typeof entry === 'string') {
    const uri = entry.trim();
    if (!/^https?:\/\//i.test(uri)) return null;

    return {
      uri,
      type:
        hintedType === 'embed' || hintedType === 'iframe'
          ? 'embed'
          : hintedType === 'video' || hintedType === 'image'
            ? hintedType
            : externalMediaType(uri, hintedType),
    };
  }

  const uri = String(entry.uri || entry.url || entry.src || '').trim();
  if (!/^https?:\/\//i.test(uri)) return null;

  const rawType = String(entry.type || hintedType || '').toLowerCase();
  const type =
    rawType === 'embed' || rawType === 'iframe'
      ? 'embed'
      : rawType === 'video' || rawType === 'image'
        ? rawType
        : externalMediaType(uri, rawType);

  return { uri, type };
}

function normalizeRemotePost(rawItem, index = 0) {
  const item =
    typeof rawItem === 'string'
      ? { url: rawItem }
      : (rawItem && typeof rawItem === 'object' ? rawItem : {});

  const detected = [];

  const pushMedia = (entry, hintedType = '') => {
    const normalized = normalizeRemoteMediaItem(entry, hintedType);
    if (!normalized) return;
    if (detected.some((media) => media.uri === normalized.uri)) return;
    detected.push(normalized);
  };

  if (Array.isArray(item.media)) {
    item.media.forEach((entry, mediaIndex) => {
      const hinted =
        Array.isArray(item.mediaTypes) && item.mediaTypes[mediaIndex]
          ? item.mediaTypes[mediaIndex]
          : '';
      pushMedia(entry, hinted);
    });
  }

  if (!detected.length && (item.url || item.uri || item.src)) {
    pushMedia(
      item.url || item.uri || item.src,
      String(item.type || '').toLowerCase()
    );
  }

  // Support direct : "iframe": "<iframe ...>", "embed": "...",
  // ou "bbcode": "[video]https://...mp4[/video]"
  const codeFields = [
    { value: item.iframe, mode: 'embed' },
    { value: item.embed, mode: 'embed' },
    { value: item.html, mode: 'embed' },
    { value: item.bbcode, mode: 'bbcode' },
    {
      value: item.code,
      mode: String(item.codeType || item.type || '').toLowerCase() === 'bbcode'
        ? 'bbcode'
        : 'embed',
    },
  ];

  codeFields.forEach(({ value, mode }) => {
    if (!value) return;
    parseExternalPublicationCode(value, mode).forEach((media) => {
      pushMedia(media.uri, media.type);
    });
  });

  if (!detected.length) return null;

  const createdAt = remotePostDate(
    item.createdAt || item.date || item.publishedAt,
    index
  );

  const owner = normalizeRemoteOwner(item.owner || item.author);

  return {
    id: String(item.id || `remote-${createdAt}-${index}`),
    owner,
    media: detected.slice(0, 10).map((media) => media.uri),
    mediaTypes: detected.slice(0, 10).map((media) => media.type),
    caption: String(item.caption || item.text || item.description || 'Publication Lolitas of the World'),
    liked: false,
    likes: Math.max(0, Number(item.likes || 0) || 0),
    saved: false,
    comments: normalizeRemoteComments(item.comments),
    time: String(item.time || 'Publication en ligne'),
    createdAt,
    meta: {
      ...(item.meta && typeof item.meta === 'object' ? item.meta : {}),
      remote: true,
      source: 'posts.json',
    },
  };
}

function normalizeRemotePosts(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.posts)
      ? payload.posts
      : [];

  return list
    .map((item, index) => normalizeRemotePost(item, index))
    .filter(Boolean);
}

function mergeRemotePosts(currentPosts, remotePosts) {
  const previous = new Map(
    currentPosts
      .filter((post) => post?.id)
      .map((post) => [String(post.id), post])
  );

  const hydratedRemote = remotePosts.map((remotePost) => {
    const old = previous.get(String(remotePost.id));

    if (!old) return remotePost;

    return {
      ...remotePost,
      liked: !!old.liked,
      saved: !!old.saved,
    };
  });

  // On conserve les publications locales ajoutées dans l'app,
  // mais on remplace l'ancienne copie des posts distants par la nouvelle.
  const localPosts = currentPosts.filter((post) => !post?.meta?.remote);

  return [...hydratedRemote, ...localPosts];
}

const ME = {
  id: 'me',
  name: 'Lolitas of the World Admin',
  handle: '@lolitasoftheworld',
  bio: 'Créateur • Vidéos • Photos • Stories',
  link: 'lolitasoftheworld.app',
  avatar: 'https://picsum.photos/id/64/300/300',
  banner: 'https://picsum.photos/id/1018/1000/600',
};

const GUEST_USER = {
  id: 'guest',
  name: 'Visiteur',
  handle: '@visiteur',
  bio: '',
  link: '',
  avatar: 'https://picsum.photos/id/91/300/300',
  banner: 'https://picsum.photos/id/1015/1000/600',
};

const USERS = [
  { id: 'u1', name: 'Lina', handle: '@lina.sun', avatar: 'https://picsum.photos/id/1027/300/300', verified: true },
  { id: 'u2', name: 'Noa', handle: '@noa.city', avatar: 'https://picsum.photos/id/1005/300/300' },
  { id: 'u3', name: 'Maya', handle: '@maya.wave', avatar: 'https://picsum.photos/id/1011/300/300', verified: true },
  { id: 'u4', name: 'Eden', handle: '@eden.night', avatar: 'https://picsum.photos/id/1001/300/300' },
  { id: 'u5', name: 'Sofia', handle: '@sofia.motion', avatar: 'https://picsum.photos/id/1025/300/300' },
  { id: 'u6', name: 'Leo', handle: '@leo.frame', avatar: 'https://picsum.photos/id/1012/300/300' },
];

const INITIAL_POSTS = [
  {
    id: 'p1',
    owner: USERS[0],
    media: ['https://picsum.photos/id/1015/900/1100', 'https://picsum.photos/id/1016/900/1100'],
    caption: 'Petit moment au bord de l’eau ✨ #voyage #sunset',
    liked: false,
    likes: 1248,
    saved: false,
    comments: [
      { id: 'c1', name: 'Maya', text: 'Incroyable 😍' },
      { id: 'c2', name: 'Noa', text: 'La lumière est parfaite.' },
    ],
    time: 'Il y a 14 min',
  },
  {
    id: 'p2',
    owner: USERS[2],
    media: ['https://picsum.photos/id/1040/900/1100'],
    caption: 'Nouvelle série. Vous préférez laquelle ? 📷',
    liked: true,
    likes: 8492,
    saved: true,
    comments: [{ id: 'c3', name: 'Lina', text: 'Celle-ci 🔥' }],
    time: 'Il y a 1 h',
  },
  {
    id: 'p3',
    owner: USERS[4],
    media: ['https://picsum.photos/id/1035/900/1100', 'https://picsum.photos/id/1039/900/1100', 'https://picsum.photos/id/1037/900/1100'],
    caption: 'Week-end en ville 🖤',
    liked: false,
    likes: 3105,
    saved: false,
    comments: [],
    time: 'Il y a 3 h',
  },
];

const EXPLORE_ITEMS = [
  { id: 'e1', image: 'https://picsum.photos/id/1003/600/900', tags: 'mode portrait' },
  { id: 'e2', image: 'https://picsum.photos/id/1019/600/900', tags: 'nature montagne' },
  { id: 'e3', image: 'https://picsum.photos/id/1020/600/900', tags: 'ville architecture' },
  { id: 'e4', image: 'https://picsum.photos/id/1024/600/900', tags: 'animal portrait' },
  { id: 'e5', image: 'https://picsum.photos/id/1031/600/900', tags: 'route voyage' },
  { id: 'e6', image: 'https://picsum.photos/id/1033/600/900', tags: 'concert nuit' },
  { id: 'e7', image: 'https://picsum.photos/id/1038/600/900', tags: 'nature forêt' },
  { id: 'e8', image: 'https://picsum.photos/id/1041/600/900', tags: 'plage mer' },
  { id: 'e9', image: 'https://picsum.photos/id/1043/600/900', tags: 'design intérieur' },
  { id: 'e10', image: 'https://picsum.photos/id/1047/600/900', tags: 'portrait mode' },
  { id: 'e11', image: 'https://picsum.photos/id/1050/600/900', tags: 'ville nuit' },
  { id: 'e12', image: 'https://picsum.photos/id/1052/600/900', tags: 'voyage paysage' },
];

const INITIAL_REELS = [
  {
    id: 'r1',
    user: USERS[1],
    video: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    caption: 'Petite séquence du jour 🎬 #reels',
    likes: '18,4 k', comments: '326', shares: '91',
  },
  {
    id: 'r2',
    user: USERS[3],
    video: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    caption: 'Ça valait le détour ✨',
    likes: '42,1 k', comments: '712', shares: '240',
  },
  {
    id: 'r3',
    user: USERS[5],
    video: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    caption: 'Test vidéo vertical — Lolitas of the World',
    likes: '7 902', comments: '108', shares: '44',
  },
];

const INITIAL_CHATS = [
  { id: 'm1', user: USERS[0], preview: 'Tu as vu la vidéo ?', time: '18:42', unread: 2 },
  { id: 'm2', user: USERS[2], preview: 'Photo', time: '17:15', unread: 0 },
  { id: 'm3', user: USERS[3], preview: 'Merci 🙌', time: 'Hier', unread: 0 },
  { id: 'm4', user: USERS[5], preview: 'On se parle demain', time: 'Hier', unread: 1 },
];

const STORY_MEDIA = [
  'https://picsum.photos/id/1015/900/1600',
  'https://picsum.photos/id/1027/900/1600',
  'https://picsum.photos/id/1040/900/1600',
  'https://picsum.photos/id/1052/900/1600',
];

function compactNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace('.0', '')} M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')} k`;
  return String(n);
}

function normalizeHashtag(value = '') {
  const clean = String(value).trim().toLowerCase();
  if (!clean) return '';
  return clean.startsWith('#') ? clean : `#${clean}`;
}

function extractHashtags(value = '') {
  const matches = String(value).match(/#[\p{L}\p{N}_.-]+/gu) || [];
  return Array.from(new Set(matches.map(normalizeHashtag)));
}

function HashtagCaption({ handle, text = '', onHashtagPress, style, numberOfLines }) {
  const parts = String(text).split(/(#[\p{L}\p{N}_.-]+)/gu);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {!!handle && <Text style={styles.captionAuthor}>{handle} </Text>}
      {parts.map((part, index) =>
        part.startsWith('#') ? (
          <Text
            key={`${part}-${index}`}
            style={styles.hashtagLinkText}
            onPress={() => onHashtagPress?.(normalizeHashtag(part))}
          >
            {part}
          </Text>
        ) : (
          <Text key={`text-${index}`}>{part}</Text>
        )
      )}
    </Text>
  );
}

function postAgeMinutes(post) {
  if (post?.createdAt) {
    return Math.max(0, (Date.now() - Number(post.createdAt)) / 60000);
  }

  const value = String(post?.time || '').toLowerCase();

  if (value.includes('instant')) return 0;

  const number = Number((value.match(/[\d,.]+/) || ['999999'])[0].replace(',', '.'));

  if (value.includes('min')) return number;
  if (value.includes(' h')) return number * 60;
  if (value.includes(' j')) return number * 1440;

  return 999999;
}

function homePopularityScore(post) {
  const likes = Number(post?.likes || 0) || 0;
  const comments = Array.isArray(post?.comments) ? post.comments.length : 0;

  // Comme Explorer : les commentaires comptent davantage.
  return likes + comments * 4;
}

function buildHomeFeed(posts = [], followingIds = []) {
  const followed = new Set(followingIds);

  const recentFollowing = posts
    .filter((post) => followed.has(post?.owner?.id))
    .slice()
    .sort((a, b) => postAgeMinutes(a) - postAgeMinutes(b));

  const popular = posts
    .slice()
    .sort((a, b) => {
      const scoreDiff = homePopularityScore(b) - homePopularityScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return postAgeMinutes(a) - postAgeMinutes(b);
    });

  const newest = posts
    .slice()
    .sort((a, b) => postAgeMinutes(a) - postAgeMinutes(b));

  const result = [];
  const seen = new Set();

  const pushUnique = (post) => {
    if (!post?.id || seen.has(post.id)) return;
    seen.add(post.id);
    result.push(post);
  };

  // Mélange de type Instagram :
  // une publication récente d'un abonnement, puis une publication populaire.
  const max = Math.max(recentFollowing.length, popular.length);

  for (let i = 0; i < max; i += 1) {
    if (recentFollowing[i]) pushUnique(recentFollowing[i]);
    if (popular[i]) pushUnique(popular[i]);
  }

  // Compléter avec les publications les plus récentes restantes.
  newest.forEach(pushUnique);

  return result;
}

function Avatar({ uri, size = 38, ring = false, active = false }) {
  const body = <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  if (!ring) return <View style={{ position: 'relative' }}>{body}{active && <View style={styles.activeDot} />}</View>;
  return (
    <LinearGradient colors={[COLORS.pink, '#ff8a00', COLORS.cyan]} style={{ width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, padding: 2.5 }}>
      <View style={{ flex: 1, borderRadius: 999, padding: 2, backgroundColor: COLORS.bg }}>{body}</View>
    </LinearGradient>
  );
}

function Verified() {
  return <Ionicons name="checkmark-circle" size={14} color={COLORS.blue} style={{ marginLeft: 4 }} />;
}

function AppLogo({ compact = false }) {
  return (
    <View style={styles.logoRow}>
      <Text style={[styles.logoText, compact && { fontSize: 18 }]}>LOLITAS</Text>
      <Text
        style={[
          styles.logoText,
          { color: COLORS.pink, marginLeft: 5 },
          compact && { fontSize: 18 },
        ]}
      >
        OF THE WORLD
      </Text>
    </View>
  );
}

function AuthBackgroundVideo() {
  const player = useVideoPlayer(require('./kidflix-login-bg-compressed.mp4'), (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <View style={styles.authBackgroundVideoWrap} pointerEvents="none">
      <VideoView
        player={player}
        style={styles.authBackgroundVideo}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />
    </View>
  );
}


function LTWSplashScreen({ onFinish }) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const imageScale = useRef(new Animated.Value(1)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const [percent, setPercent] = useState(0);

  const progressDuration = 2800;
  const barWidth = SCREEN_WIDTH - 88;

  useEffect(() => {
    const startedAt = Date.now();

    const percentTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const next = Math.min(100, Math.round((elapsed / progressDuration) * 100));
      setPercent(next);
    }, 55);

    const pulseAnimation = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(imageScale, {
            toValue: 1.028,
            duration: 900,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(imageScale, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glowPulse, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowPulse, {
            toValue: 0,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    pulseAnimation.start();

    Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: progressDuration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.delay(120),
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: 380,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onFinish?.();
    });

    return () => {
      clearInterval(percentTimer);
      pulseAnimation.stop();
    };
  }, [glowPulse, imageScale, onFinish, progress, splashOpacity]);

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, barWidth],
  });

  const glowOpacity = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.22, 0.62],
  });

  const glowScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.14],
  });

  return (
    <Animated.View style={[styles.ltwSplashRoot, { opacity: splashOpacity }]}>
      <StatusBar hidden translucent backgroundColor="transparent" />

      <Animated.Image
        source={require('./ltw-splash.png')}
        resizeMode="cover"
        style={[
          StyleSheet.absoluteFillObject,
          styles.ltwSplashImage,
          { transform: [{ scale: imageScale }] },
        ]}
      />

      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'transparent', 'rgba(15,0,10,.36)', 'rgba(7,0,5,.88)']}
        locations={[0, 0.69, 0.84, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={[
          styles.ltwLoadingArea,
          { bottom: Math.max(insets.bottom, 12) + 28 },
        ]}
      >
        <View style={styles.ltwProgressTrack}>
          <Animated.View
            style={[
              styles.ltwProgressFill,
              { width: progressWidth },
            ]}
          >
            <View style={styles.ltwProgressShine} />
          </Animated.View>
        </View>

        <View style={styles.ltwLoadingTextRow}>
          <Text style={styles.ltwLoadingText}>Chargement...</Text>
          <Text style={styles.ltwLoadingPercent}>{percent}%</Text>
        </View>

        <Animated.View
          style={[
            styles.ltwPulseHeart,
            {
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        >
          <Ionicons name="heart" size={24} color="#ff4f9f" />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function AuthScreen({ onEnter }) {
  const [mode, setMode] = useState('login');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const signup = mode === 'signup';

  const submitMember = async () => {
    if (loading) return;
    setAuthError('');
    setLoading(true);

    try {
      const result = signup
        ? await createLtwAccount(user, pass)
        : await signInLtwAccount(user, pass);

      onEnter?.('member', result?.profile || null);
    } catch (error) {
      setAuthError(firebaseErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const submitGuest = async () => {
    if (loading) return;
    setAuthError('');
    setLoading(true);

    try {
      await continueAsLtwGuest();
      onEnter?.('guest', null);
    } catch (error) {
      setAuthError(firebaseErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.authRoot}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <AuthBackgroundVideo />
      <LinearGradient
        colors={[
          'rgba(5,5,7,.28)',
          'rgba(21,11,20,.22)',
          'rgba(6,21,26,.20)',
          'rgba(0,0,0,.34)',
        ]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.authGlowPink} />
      <View style={styles.authGlowCyan} />
      <KeyboardAvoidingView style={styles.authInner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.authBrandWrap}>
          <Image
            source={require('./lolitas-sexy-logo.png')}
            style={styles.authScriptLogo}
            resizeMode="contain"
          />
          <Text style={styles.authSub}>Partage tes moments. Découvre les leurs.</Text>
        </View>

        <View style={styles.authCard}>
          <Text style={styles.authTitle}>{signup ? 'Créer un compte' : 'Connexion'}</Text>

          <TextInput
            value={user}
            onChangeText={(value) => {
              setUser(value);
              if (authError) setAuthError('');
            }}
            placeholder="Email ou pseudo"
            placeholderTextColor="#777780"
            style={styles.authInput}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          <View style={styles.passwordRow}>
            <TextInput
              value={pass}
              onChangeText={(value) => {
                setPass(value);
                if (authError) setAuthError('');
              }}
              placeholder="Mot de passe"
              placeholderTextColor="#777780"
              style={[styles.authInput, { flex: 1, marginBottom: 0, paddingRight: 50 }]}
              secureTextEntry={!show}
              editable={!loading}
              onSubmitEditing={submitMember}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShow(!show)} disabled={loading}>
              <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color="#c7c7cc" />
            </TouchableOpacity>
          </View>

          {!!authError && (
            <View style={styles.authErrorBox}>
              <Ionicons name="alert-circle-outline" size={17} color="#ff6b87" />
              <Text style={styles.authErrorText}>{authError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, loading && { opacity: 0.7 }]}
            onPress={submitMember}
            disabled={loading}
          >
            <LinearGradient
              colors={[COLORS.pink, '#ff4d86', COLORS.cyan]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryButtonGradient}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {signup ? 'Créer mon compte' : 'Se connecter'}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setMode(signup ? 'login' : 'signup');
              setAuthError('');
            }}
            disabled={loading}
          >
            <Text style={styles.authSwitch}>
              {signup
                ? 'Déjà membre ? Se connecter'
                : 'Pas encore de compte ? S’inscrire'}
            </Text>
          </TouchableOpacity>

          <View style={styles.authSeparator}>
            <View style={styles.sepLine} />
            <Text style={styles.sepText}>OU</Text>
            <View style={styles.sepLine} />
          </View>

          <TouchableOpacity
            style={[styles.guestButton, loading && { opacity: 0.7 }]}
            onPress={submitGuest}
            disabled={loading}
          >
            <Ionicons name="eye-outline" size={18} color={COLORS.text} />
            <Text style={styles.guestButtonText}>Continuer en visiteur</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function TopHomeHeader({ onNotifications, onMessages }) {
  return (
    <View style={styles.topHeader}>
      <AppLogo compact />
      <View style={styles.topHeaderActions}>
        <TouchableOpacity onPress={onNotifications} style={styles.headerIconBtn}>
          <Ionicons name="heart-outline" size={27} color="#fff" />
          <View style={styles.headerBadge} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onMessages} style={styles.headerIconBtn}>
          <Ionicons name="paper-plane-outline" size={27} color="#fff" />
          <View style={styles.headerCount}><Text style={styles.headerCountText}>3</Text></View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StoriesBar({ onOpen, onCreate, ownStory, onOpenOwn, ownAvatar = ME.avatar }) {
  const list = [{ id: 'me', name: 'Votre story', avatar: ownAvatar, mine: true }, ...USERS.slice(0, 5).map((u) => ({ ...u }))];
  return (
    <View style={styles.storiesWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesContent}>
        {list.map((s, i) => (
          <TouchableOpacity key={s.id} style={styles.storyItem} onPress={() => s.mine ? (ownStory ? onOpenOwn() : onCreate()) : onOpen(Math.max(0, i - 1))}>
            <View style={styles.storyAvatarWrap}>
              <Avatar uri={s.avatar} size={66} ring={!s.mine || !!ownStory} />
              {s.mine && !ownStory && <View style={styles.storyAdd}><Ionicons name="add" color="#fff" size={15} /></View>}
            </View>
            <Text numberOfLines={1} style={styles.storyName}>{s.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}


function decodeEmbedEntities(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function externalMediaType(uri = '', hintedType = '') {
  const value = String(uri).trim();

  if (hintedType === 'image' || /\.(jpe?g|png|webp|gif|avif|bmp)(?:\?|#|$)/i.test(value)) {
    return 'image';
  }

  if (hintedType === 'video' || /\.(mp4|m4v|mov|webm|3gp|m3u8)(?:\?|#|$)/i.test(value)) {
    return 'video';
  }

  return 'embed';
}

function parseExternalPublicationCode(code = '', mode = 'embed') {
  const raw = String(code || '').trim();
  if (!raw) return [];

  const found = [];
  const add = (uri, hintedType = '') => {
    const clean = decodeEmbedEntities(uri)
      .replace(/^['"]|['"]$/g, '')
      .trim();

    if (!/^https?:\/\//i.test(clean)) return;
    if (found.some((x) => x.uri === clean)) return;

    found.push({
      uri: clean,
      type: externalMediaType(clean, hintedType),
    });
  };

  if (mode === 'bbcode') {
    const bbPatterns = [
      { re: /\[img(?:=[^\]]+)?\]([\s\S]*?)\[\/img\]/gi, type: 'image' },
      { re: /\[video(?:=[^\]]+)?\]([\s\S]*?)\[\/video\]/gi, type: 'video' },
      { re: /\[media(?:=[^\]]+)?\]([\s\S]*?)\[\/media\]/gi, type: '' },
      { re: /\[iframe(?:=[^\]]+)?\]([\s\S]*?)\[\/iframe\]/gi, type: 'embed' },
    ];

    bbPatterns.forEach(({ re, type }) => {
      let match;
      while ((match = re.exec(raw))) add(match[1], type);
    });

    const urlAttribute = /\[url=(https?:\/\/[^\]\s]+)\]/gi;
    let urlMatch;
    while ((urlMatch = urlAttribute.exec(raw))) add(urlMatch[1], '');
  } else {
    const htmlPatterns = [
      { re: /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, type: 'image' },
      { re: /<video\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, type: 'video' },
      { re: /<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, type: 'video' },
      { re: /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, type: 'embed' },
      { re: /<embed\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, type: 'embed' },
    ];

    htmlPatterns.forEach(({ re, type }) => {
      let match;
      while ((match = re.exec(raw))) add(match[1], type);
    });
  }

  // Supporte aussi une ou plusieurs URL directes collées sur des lignes séparées.
  const rawUrls = raw.match(/https?:\/\/[^\s<>"'\]]+/gi) || [];
  rawUrls.forEach((url) => add(url, ''));

  return found.slice(0, 10);
}

function EmbeddedMedia({ uri, style, interactive = false }) {
  if (!uri) return null;

  return (
    <View style={[style, { backgroundColor: '#000', overflow: 'hidden' }]}>
      <WebView
        source={{ uri }}
        style={StyleSheet.absoluteFillObject}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        bounces={false}
        pointerEvents={interactive ? 'auto' : 'none'}
        setSupportMultipleWindows={false}
        originWhitelist={['http://*', 'https://*']}
      />
    </View>
  );
}

function mediaTypeFromUri(uri = '') {
  return /\.(mp4|m4v|mov|webm|3gp)(?:\?|$)/i.test(uri) ? 'video' : 'image';
}

function VideoMedia({ uri, style, contentFit = 'cover', autoplay = true, muted = false, controls = false, loop = true }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop;
    p.muted = muted;
    if (autoplay) p.play();
  });
  useEffect(() => {
    player.muted = muted;
    if (autoplay) player.play();
    else player.pause();
  }, [autoplay, muted, player]);

  if (controls) {
    return (
      <VideoView
        player={player}
        style={style}
        contentFit={contentFit}
        nativeControls
      />
    );
  }

  return (
    <View style={style} pointerEvents="none">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit={contentFit}
        nativeControls={false}
      />
    </View>
  );
}

function CreateMediaPreview({ uri, type }) {
  if (!uri) return null;
  if (type === 'video') {
    return <VideoMedia uri={uri} style={styles.composePreview} contentFit="cover" autoplay muted controls />;
  }
  if (type === 'embed') {
    return <EmbeddedMedia uri={uri} style={styles.composePreview} interactive />;
  }
  return <Image source={{ uri }} style={styles.composePreview} resizeMode="cover" />;
}

function CreateMediaPreviewCarousel({ media = [], mediaTypes = [] }) {
  const [index, setIndex] = useState(0);
  if (!media.length) return null;
  return (
    <View style={styles.composePreviewWrap}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / (SCREEN_WIDTH - 32)))}
      >
        {media.map((uri, i) => {
          const type = mediaTypes[i] || mediaTypeFromUri(uri);
          return (
            <View key={`${uri}-${i}`} style={styles.composePreviewPage}>
              {type === 'video'
                ? <VideoMedia uri={uri} style={styles.composePreview} contentFit="cover" autoplay={i === index} muted controls />
                : type === 'embed'
                  ? <EmbeddedMedia uri={uri} style={styles.composePreview} interactive={i === index} />
                  : <Image source={{ uri }} style={styles.composePreview} resizeMode="cover" />}
            </View>
          );
        })}
      </ScrollView>
      {media.length > 1 && (
        <>
          <View style={styles.composeCountPill}>
            <Text style={styles.composeCountText}>{index + 1}/{media.length}</Text>
          </View>
          <View style={styles.composeDotRow}>
            {media.map((_, i) => <View key={i} style={[styles.mediaDot, i === index && styles.mediaDotActive]} />)}
          </View>
        </>
      )}
    </View>
  );
}

function StoryMediaContent({ media }) {
  if (!media?.uri) return null;
  if (media.type === 'video') {
    return <VideoMedia uri={media.uri} style={StyleSheet.absoluteFillObject} contentFit="cover" autoplay muted={false} controls={false} />;
  }
  return <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />;
}

function MediaCarousel({ media, mediaTypes = [], onDoubleTap, onOpen, isActive = false }) {
  const [idx, setIdx] = useState(0);
  const [mutedByIndex, setMutedByIndex] = useState({});
  const lastTap = useRef(0);
  const singleTapTimer = useRef(null);

  useEffect(() => () => {
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
  }, []);

  const onPress = (index) => {
    const now = Date.now();

    if (now - lastTap.current < 300) {
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      onDoubleTap?.();
      lastTap.current = 0;
      return;
    }

    lastTap.current = now;
    singleTapTimer.current = setTimeout(() => {
      onOpen?.(index);
      singleTapTimer.current = null;
    }, 260);
  };

  const currentType = mediaTypes[idx] || mediaTypeFromUri(media[idx]);
  const currentMediaHeight = (currentType === 'video' || currentType === 'embed')
    ? Math.min(SCREEN_WIDTH * 1.52, 620)
    : Math.min(SCREEN_WIDTH * 1.16, 480);

  return (
    <View style={[styles.postMediaWrap, { height: currentMediaHeight }]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
      >
        {media.map((uri, i) => {
          const type = mediaTypes[i] || mediaTypeFromUri(uri);
          return (
            <View
              key={`${uri}-${i}`}
              style={{ width: SCREEN_WIDTH, height: currentMediaHeight, backgroundColor: '#000' }}
            >
              {type === 'video'
                ? <VideoMedia
                    uri={uri}
                    style={{ width: SCREEN_WIDTH, height: currentMediaHeight }}
                    contentFit="cover"
                    autoplay={isActive && i === idx}
                    muted={mutedByIndex[i] !== false}
                    controls={false}
                  />
                : type === 'embed'
                  ? <EmbeddedMedia
                      uri={uri}
                      style={{ width: SCREEN_WIDTH, height: currentMediaHeight }}
                      interactive={false}
                    />
                  : <Image
                      source={{ uri }}
                      style={{ width: SCREEN_WIDTH, height: currentMediaHeight }}
                      resizeMode="cover"
                    />}

              <Pressable
                style={StyleSheet.absoluteFillObject}
                onPress={() => onPress(i)}
              />

              {type === 'video' && (
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={styles.feedSoundButton}
                  onPress={() =>
                    setMutedByIndex((prev) => ({
                      ...prev,
                      [i]: prev[i] === false ? true : false,
                    }))
                  }
                >
                  <Ionicons
                    name={mutedByIndex[i] === false ? 'volume-high' : 'volume-mute'}
                    size={17}
                    color="#fff"
                  />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
      {media.length > 1 && <View style={styles.carouselPill}><Text style={styles.carouselPillText}>{idx + 1}/{media.length}</Text></View>}
      {media.length > 1 && <View style={styles.dotRow}>{media.map((_, i) => <View key={i} style={[styles.mediaDot, i === idx && styles.mediaDotActive]} />)}</View>}
    </View>
  );
}

function PostCard({ post, onToggleLike, onToggleSave, onComments, onShare, onMenu, onOpenUser, onOpenPost, onOpenHashtag, isActive = false }) {
  return (
    <View style={styles.postCard}>
      <View style={styles.postMediaFrame}>
        <MediaCarousel
          media={post.media}
          mediaTypes={post.mediaTypes || []}
          onDoubleTap={() => !post.liked && onToggleLike(post.id)}
          onOpen={(index) => onOpenPost?.(post, index)}
          isActive={isActive}
        />

        <View style={styles.postHeaderOverlay}>
          <TouchableOpacity style={styles.postUserRow} onPress={() => onOpenUser(post.owner)}>
            <Avatar uri={post.owner.avatar} size={36} ring />
            <View style={{ marginLeft: 10 }}>
              <View style={styles.nameVerifiedRow}>
                <Text style={styles.postUserNameOverlay}>{post.owner.name}</Text>
                {post.owner.verified && <Verified />}
              </View>
              <Text style={styles.postSubOverlay}>Marseille • {post.time}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => onMenu(post)} style={styles.postOverlayMenuBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.postActions}>
        <View style={styles.postActionsLeft}>
          <TouchableOpacity onPress={() => onToggleLike(post.id)} style={styles.iconHit}>
            <Ionicons name={post.liked ? 'heart' : 'heart-outline'} size={29} color={post.liked ? COLORS.red : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onComments(post)} style={styles.iconHit}><Ionicons name="chatbubble-outline" size={27} color="#fff" /></TouchableOpacity>
          <TouchableOpacity onPress={() => onShare(post)} style={styles.iconHit}><Ionicons name="paper-plane-outline" size={27} color="#fff" /></TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => onToggleSave(post.id)} style={styles.iconHit}><Ionicons name={post.saved ? 'bookmark' : 'bookmark-outline'} size={28} color="#fff" /></TouchableOpacity>
      </View>
      <View style={styles.postTextArea}>
        <Text style={styles.likesText}>{compactNumber(post.likes)} J’aime</Text>
        <HashtagCaption
          handle={post.owner.handle}
          text={post.caption}
          onHashtagPress={onOpenHashtag}
          style={styles.captionText}
        />
        <TouchableOpacity onPress={() => onComments(post)}>
          <Text style={styles.viewComments}>{post.comments.length ? `Afficher les ${post.comments.length} commentaires` : 'Ajouter un commentaire...'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function HomeScreen(props) {
  const { refreshing, onRefresh } = useKidflixRefresh(850, props.onRemoteRefresh);

  const homeFeed = useMemo(
    () => buildHomeFeed(props.posts || [], props.followingIds || []),
    [props.posts, props.followingIds]
  );

  const [activePostId, setActivePostId] = useState(homeFeed?.[0]?.id || null);

  useEffect(() => {
    if (!homeFeed.length) {
      setActivePostId(null);
      return;
    }

    if (!homeFeed.some((post) => post.id === activePostId)) {
      setActivePostId(homeFeed[0].id);
    }
  }, [homeFeed, activePostId]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 65,
    minimumViewTime: 120,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const visiblePosts = viewableItems
      .filter((entry) => entry.isViewable && entry.item?.id)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    setActivePostId(visiblePosts[0]?.item?.id || null);
  }).current;

  return (
    <View style={styles.screenRoot}>
      <TopHomeHeader onNotifications={props.onNotifications} onMessages={props.onMessages} />

      <FlatList
        data={homeFeed}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            {...props}
            isActive={item.id === activePostId}
          />
        )}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        ListHeaderComponent={
          <StoriesBar
            onOpen={props.onStory}
            onCreate={props.onCreateStory}
            ownStory={props.ownStory}
            onOpenOwn={props.onOpenOwnStory}
            ownAvatar={props.ownAvatar}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            {...refreshControlProps}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 18 }}
      />
    </View>
  );
}

function ExploreScreen({ onOpenMedia, onOpenUser, onOpenHashtag, posts = [], isGuest = false, onRemoteRefresh }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Pour vous');
  const { refreshing, onRefresh } = useKidflixRefresh(850, onRemoteRefresh);
  const cats = ['Pour vous', 'Tendances', 'Voyage', 'Mode', 'Nature', 'Musique'];
  const dynamicPostItems = posts.map((post) => {
    const firstUri = post.media?.[0] || post.image || post.video || '';
    const firstType = post.mediaTypes?.[0] || post.type || mediaTypeFromUri(firstUri);

    return {
      id: `post-${post.id}`,
      image: firstUri,
      uri: firstUri,
      type: firstType,
      category: 'Pour vous',
      tags: `${post.owner?.name || ''} ${post.owner?.handle || ''} ${post.caption || ''}`.toLowerCase(),
      sourcePost: post,
      mediaIndex: 0,
      hasMultipleMedia: (post.media || []).length > 1,
    };
  });

  const exploreItems = [...dynamicPostItems, ...EXPLORE_ITEMS];

  // Classement automatique Explorer :
  // 1 like = 1 point
  // 1 commentaire = 4 points
  // Les commentaires pèsent davantage car ils demandent plus d'engagement.
  const getExploreEngagement = (entry) => {
    const post = entry.sourcePost;

    const likes = Number(post?.likes || entry.likes || 0) || 0;

    const comments = Array.isArray(post?.comments)
      ? post.comments.length
      : Array.isArray(entry.comments)
        ? entry.comments.length
        : Number(entry.comments || 0) || 0;

    return {
      likes,
      comments,
      score: likes + comments * 4,
    };
  };

  const rankedExploreItems = exploreItems
    .map((entry, originalIndex) => ({
      ...entry,
      _originalIndex: originalIndex,
      _engagement: getExploreEngagement(entry),
    }))
    .sort((a, b) => {
      // Plus gros score d'engagement en premier.
      if (b._engagement.score !== a._engagement.score) {
        return b._engagement.score - a._engagement.score;
      }

      // En cas d'égalité : plus de commentaires, puis plus de likes.
      if (b._engagement.comments !== a._engagement.comments) {
        return b._engagement.comments - a._engagement.comments;
      }

      if (b._engagement.likes !== a._engagement.likes) {
        return b._engagement.likes - a._engagement.likes;
      }

      // Sinon garder l'ordre d'origine.
      return a._originalIndex - b._originalIndex;
    });

  const qq = q.trim().toLowerCase();
  const filtered = rankedExploreItems.filter(
    (x) => !qq || String(x.tags || '').includes(qq)
  );

  const toViewerItem = (entry) => {
    if (entry.sourcePost) {
      const post = entry.sourcePost;
      const index = entry.mediaIndex || 0;
      const uri = post.media?.[index];
      const type = post.mediaTypes?.[index] || mediaTypeFromUri(uri);

      return {
        ...post,
        image: uri,
        video: type === 'video' ? uri : undefined,
        type,
        media: post.media || [],
        mediaTypes: post.mediaTypes || [],
        initialIndex: index,
      };
    }

    const uri = entry.image || entry.uri;
    const type = entry.type || mediaTypeFromUri(uri);

    return {
      id: entry.id,
      image: uri,
      video: type === 'video' ? uri : undefined,
      type,
      media: [uri].filter(Boolean),
      mediaTypes: [type],
      initialIndex: 0,
      owner: ME,
      caption: entry.tags || 'Publication Lolitas of the World',
      likes: 0,
      comments: [],
    };
  };

  const verticalFeed = filtered.map(toViewerItem);

  const searchableUsers = isGuest ? USERS : [ME, ...USERS];
  const matchingUsers = qq
    ? searchableUsers.filter((u) =>
        `${u.name} ${u.handle}`.toLowerCase().includes(qq.replace(/^@/, ''))
      ).slice(0, 5)
    : [];

  const hashtagPool = Array.from(
    new Set(
      [
        ...posts.flatMap((post) =>
          String(post.caption || '').match(/#[\p{L}\p{N}_.-]+/gu) || []
        ),
        ...EXPLORE_ITEMS.flatMap((entry) =>
          String(entry.tags || '').match(/#[\p{L}\p{N}_.-]+/gu) || []
        ),
        '#voyage',
        '#photo',
        '#video',
        '#nature',
        '#mode',
        '#musique',
      ].map((tag) => String(tag).toLowerCase())
    )
  );

  const matchingHashtags = qq
    ? hashtagPool
        .filter((tag) => tag.includes(qq.startsWith('#') ? qq : `#${qq}`) || tag.includes(qq))
        .slice(0, 6)
    : [];

  return (
    <View style={styles.screenRoot}>
      <View style={styles.exploreHeader}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={19} color={COLORS.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Rechercher" placeholderTextColor={COLORS.muted} style={styles.searchInput} />
          {!!q && <TouchableOpacity onPress={() => setQ('')}><Ionicons name="close-circle" size={18} color="#777" /></TouchableOpacity>}
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {cats.map((c) => <TouchableOpacity key={c} onPress={() => setCat(c)} style={[styles.chip, cat === c && styles.chipActive]}><Text style={[styles.chipText, cat === c && styles.chipTextActive]}>{c}</Text></TouchableOpacity>)}
      </ScrollView>

      {!!q.trim() && (matchingUsers.length > 0 || matchingHashtags.length > 0) && (
        <View style={styles.exploreSearchResults}>
          {matchingUsers.map((user) => (
            <TouchableOpacity
              key={`user-${user.id}`}
              style={styles.exploreSearchRow}
              onPress={() => onOpenUser?.(user)}
            >
              <Avatar uri={user.avatar} size={40} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.exploreSearchName}>{user.name}</Text>
                <Text style={styles.exploreSearchSub}>{user.handle}</Text>
              </View>
              <Ionicons name="person-outline" size={20} color="#aaa" />
            </TouchableOpacity>
          ))}

          {matchingHashtags.map((tag) => (
            <TouchableOpacity
              key={`tag-${tag}`}
              style={styles.exploreSearchRow}
              onPress={() => onOpenHashtag?.(tag)}
            >
              <View style={styles.hashtagSearchIcon}>
                <Text style={styles.hashtagSearchIconText}>#</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.exploreSearchName}>{tag}</Text>
                <Text style={styles.exploreSearchSub}>Hashtag</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color="#777" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={filtered}
        numColumns={3}
        keyExtractor={(x) => x.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            {...refreshControlProps}
          />
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={[styles.exploreTile, index % 7 === 0 && styles.exploreTileTall]}
            onPress={() => {
              const opened = verticalFeed[index];
              onOpenMedia({
                ...opened,
                exploreFeed: verticalFeed,
                exploreIndex: index,
                fromExplore: true,
              });
            }}
          >
            {item.type === 'video' ? (
              <>
                <VideoMedia
                  uri={item.image || item.uri}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  autoplay={false}
                  muted
                  controls={false}
                />
                <View style={styles.tileReelIcon}>
                  <Ionicons name="play" size={16} color="#fff" />
                </View>
              </>
            ) : item.type === 'embed' ? (
              <>
                <EmbeddedMedia
                  uri={item.image || item.uri}
                  style={StyleSheet.absoluteFillObject}
                  interactive={false}
                />
                <View style={styles.tileReelIcon}>
                  <Ionicons name="code-slash-outline" size={15} color="#fff" />
                </View>
              </>
            ) : (
              <Image
                source={{ uri: item.image || item.uri }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
            )}

            {!!item.hasMultipleMedia && (
              <View style={styles.tileCarouselIcon}>
                <Ionicons name="copy-outline" size={14} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 18 }}
      />
    </View>
  );
}

function ReelCard({ reel, active, onOpenUser, onCreate, pageHeight }) {
  const player = useVideoPlayer(reel.video, (p) => { p.loop = true; p.muted = false; });
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [muted, setMuted] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [comments, setComments] = useState([{ id: 'r-c1', name: 'Lina', text: 'Très propre 🔥' }]);
  const [likeBurst, setLikeBurst] = useState(false);
  const reelLastTap = useRef(0);
  const reelTapTimer = useRef(null);
  useEffect(() => {
    if (active) player.play(); else player.pause();
  }, [active, player]);
  useEffect(() => { player.muted = muted; }, [muted, player]);
  useEffect(() => () => {
    if (reelTapTimer.current) clearTimeout(reelTapTimer.current);
  }, []);

  const handleReelTap = () => {
    const now = Date.now();

    if (now - reelLastTap.current < 300) {
      if (reelTapTimer.current) {
        clearTimeout(reelTapTimer.current);
        reelTapTimer.current = null;
      }
      setLiked(true);
      setLikeBurst(true);
      setTimeout(() => setLikeBurst(false), 650);
      reelLastTap.current = 0;
      return;
    }

    reelLastTap.current = now;
    reelTapTimer.current = setTimeout(() => {
      setMuted((m) => !m);
      reelTapTimer.current = null;
    }, 260);
  };

  const reelCommentPost = { id: reel.id, comments };
  return (
    <View style={[styles.reelPage, { height: pageHeight }]}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={handleReelTap}>
        <VideoView player={player} style={StyleSheet.absoluteFillObject} contentFit="cover" nativeControls={false} />
        <LinearGradient colors={['transparent', 'transparent', 'rgba(0,0,0,.75)']} locations={[0, .55, 1]} style={StyleSheet.absoluteFillObject} />
      </Pressable>
      <View style={styles.reelTop}>
        <Text style={styles.reelTitle}>Reels</Text>
        <TouchableOpacity onPress={onCreate} style={styles.iconHit}><Ionicons name="camera-outline" size={28} color="#fff" /></TouchableOpacity>
      </View>
      <View style={styles.reelBottomInfo}>
        <View style={styles.reelUserRow}>
          <View style={styles.reelUserIdentity}>
            <TouchableOpacity onPress={() => onOpenUser(reel.user)}>
              <Avatar uri={reel.user.avatar} size={38} />
            </TouchableOpacity>

            <View style={styles.reelUserTextColumn}>
              <TouchableOpacity onPress={() => onOpenUser(reel.user)}>
                <Text style={styles.reelHandle}>{reel.user.handle}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.followMini} onPress={() => setFollow(!follow)}>
                <Text style={[styles.followMiniText, follow && styles.followMiniTextActive]}>
                  {follow ? 'Suivi(e)' : 'Suivre'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <Text style={styles.reelCaption} numberOfLines={2}>{reel.caption}</Text>
        <View style={styles.audioRow}><Ionicons name="musical-notes" size={15} color="#fff" /><Text style={styles.audioText}>Audio original • Lolitas of the World</Text></View>
      </View>
      <View style={styles.reelSideActions}>
        <ReelAction icon={liked ? 'heart' : 'heart-outline'} color={liked ? COLORS.red : '#fff'} label={reel.likes} onPress={() => setLiked(!liked)} />
        <ReelAction icon="chatbubble-outline" label={reel.comments} onPress={() => setCommentsOpen(true)} />
        <ReelAction icon="paper-plane-outline" label={reel.shares} onPress={() => Share.share({ message: `Regarde ce Reel Lolitas of the World de ${reel.user.handle} — ${reel.caption}` })} />
        <ReelAction icon={saved ? 'bookmark' : 'bookmark-outline'} color={saved ? COLORS.cyan : '#fff'} onPress={() => setSaved(!saved)} />
        <ReelAction icon="ellipsis-horizontal" onPress={() => setMenuOpen(true)} />
        <Image source={{ uri: reel.user.avatar }} style={styles.reelMiniCover} />
      </View>
      {muted && <View style={styles.muteBubble}><Ionicons name="volume-mute" size={19} color="#fff" /></View>}
      {likeBurst && (
        <View pointerEvents="none" style={styles.doubleTapHeart}>
          <Ionicons name="heart" size={92} color="#fff" />
        </View>
      )}
      <CommentsModal post={reelCommentPost} visible={commentsOpen} onClose={() => setCommentsOpen(false)} onAdd={(id, text) => setComments((x) => [...x, { id: String(Date.now()), name: ME.name, text }])} />
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.modalBackdropBottom} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.actionSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.sheetHandle} />
            <SheetAction icon={saved ? 'bookmark' : 'bookmark-outline'} label={saved ? 'Retirer des éléments enregistrés' : 'Enregistrer'} onPress={() => { setSaved(!saved); setMenuOpen(false); }} />
            <SheetAction icon="information-circle-outline" label="À propos de ce compte" onPress={() => { setMenuOpen(false); onOpenUser(reel.user); }} />
            <SheetAction icon="eye-off-outline" label="Ce Reel ne m’intéresse pas" onPress={() => { setMenuOpen(false); Alert.alert('Merci', 'Nous afficherons moins de contenus similaires dans cette démo.'); }} />
            <SheetAction icon="flag-outline" label="Signaler" danger onPress={() => { setMenuOpen(false); Alert.alert('Signalement envoyé', 'Le signalement local a été enregistré.'); }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}


function HashtagScreen({ hashtag, posts = [], onBack, onOpenMedia, onRemoteRefresh }) {
  const [tab, setTab] = useState('popular');
  const { refreshing, onRefresh } = useKidflixRefresh(850, onRemoteRefresh);

  const normalizedTag = normalizeHashtag(hashtag);
  const tagWord = normalizedTag.replace(/^#/, '');

  const matchingPosts = useMemo(() => {
    return posts.filter((post) =>
      extractHashtags(post.caption || '').includes(normalizedTag)
    );
  }, [posts, normalizedTag]);

  const sortedPosts = useMemo(() => {
    const copy = matchingPosts.slice();

    if (tab === 'recent') {
      return copy.sort((a, b) => postAgeMinutes(a) - postAgeMinutes(b));
    }

    return copy.sort((a, b) => {
      const scoreDiff = homePopularityScore(b) - homePopularityScore(a);
      if (scoreDiff !== 0) return scoreDiff;

      const commentDiff =
        (Array.isArray(b.comments) ? b.comments.length : 0) -
        (Array.isArray(a.comments) ? a.comments.length : 0);

      if (commentDiff !== 0) return commentDiff;

      return postAgeMinutes(a) - postAgeMinutes(b);
    });
  }, [matchingPosts, tab]);

  const viewerFeed = useMemo(
    () =>
      sortedPosts.map((post) => {
        const uri = post.media?.[0] || post.image || post.video || '';
        const type =
          post.mediaTypes?.[0] ||
          post.type ||
          mediaTypeFromUri(uri);

        return {
          ...post,
          image: uri,
          video: type === 'video' ? uri : undefined,
          type,
          media: post.media || [uri].filter(Boolean),
          mediaTypes:
            post.mediaTypes?.length
              ? post.mediaTypes
              : [type],
          initialIndex: 0,
        };
      }),
    [sortedPosts]
  );

  const renderTile = ({ item, index }) => {
    const uri = item.media?.[0] || item.image || item.video || '';
    const type =
      item.mediaTypes?.[0] ||
      item.type ||
      mediaTypeFromUri(uri);

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.hashtagGridTile}
        onPress={() => {
          const opened = viewerFeed[index];

          onOpenMedia?.({
            ...opened,
            exploreFeed: viewerFeed,
            exploreIndex: index,
            fromExplore: true,
          });
        }}
      >
        {type === 'video' ? (
          <>
            <VideoMedia
              uri={uri}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              autoplay={false}
              muted
              controls={false}
            />
            <View style={styles.tileReelIcon}>
              <Ionicons name="play" size={16} color="#fff" />
            </View>
          </>
        ) : type === 'embed' ? (
          <>
            <EmbeddedMedia
              uri={uri}
              style={StyleSheet.absoluteFillObject}
              interactive={false}
            />
            <View style={styles.tileReelIcon}>
              <Ionicons name="code-slash-outline" size={15} color="#fff" />
            </View>
          </>
        ) : (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
        )}

        {(item.media || []).length > 1 && (
          <View style={styles.tileCarouselIcon}>
            <Ionicons name="copy-outline" size={14} color="#fff" />
          </View>
        )}

        <LinearGradient
          pointerEvents="none"
          colors={['transparent', 'rgba(0,0,0,.58)']}
          style={styles.hashtagTileGradient}
        />

        <View pointerEvents="none" style={styles.hashtagTileStats}>
          <View style={styles.hashtagTileStat}>
            <Ionicons name="heart" size={12} color="#fff" />
            <Text style={styles.hashtagTileStatText}>
              {compactNumber(Number(item.likes || 0))}
            </Text>
          </View>

          <View style={styles.hashtagTileStat}>
            <Ionicons name="chatbubble" size={11} color="#fff" />
            <Text style={styles.hashtagTileStatText}>
              {Array.isArray(item.comments) ? item.comments.length : 0}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screenRoot}>
      <View style={styles.hashtagHeader}>
        <TouchableOpacity onPress={onBack} style={styles.hashtagBackButton}>
          <Ionicons name="chevron-back" size={30} color="#fff" />
        </TouchableOpacity>

        <View style={styles.hashtagHeaderTitleWrap}>
          <Text style={styles.hashtagHeaderTitle}>{normalizedTag}</Text>
          <Text style={styles.hashtagHeaderSub}>Hashtag</Text>
        </View>

        <View style={styles.hashtagHeaderSpacer} />
      </View>

      <FlatList
        data={sortedPosts}
        key={`hashtag-${tab}`}
        numColumns={3}
        keyExtractor={(item) => item.id}
        renderItem={renderTile}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            {...refreshControlProps}
          />
        }
        ListHeaderComponent={
          <>
            <View style={styles.hashtagHero}>
              <View style={styles.hashtagHeroIcon}>
                <Text style={styles.hashtagHeroHash}>#</Text>
              </View>

              <View style={styles.hashtagHeroInfo}>
                <Text style={styles.hashtagHeroName}>{normalizedTag}</Text>
                <Text style={styles.hashtagHeroCount}>
                  {matchingPosts.length}{' '}
                  {matchingPosts.length > 1 ? 'publications' : 'publication'}
                </Text>
              </View>
            </View>

            <View style={styles.hashtagTabs}>
              <TouchableOpacity
                style={[
                  styles.hashtagTab,
                  tab === 'popular' && styles.hashtagTabActive,
                ]}
                onPress={() => setTab('popular')}
              >
                <Ionicons
                  name="flame-outline"
                  size={18}
                  color={tab === 'popular' ? '#fff' : '#777'}
                />
                <Text
                  style={[
                    styles.hashtagTabText,
                    tab === 'popular' && styles.hashtagTabTextActive,
                  ]}
                >
                  Populaires
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.hashtagTab,
                  tab === 'recent' && styles.hashtagTabActive,
                ]}
                onPress={() => setTab('recent')}
              >
                <Ionicons
                  name="time-outline"
                  size={18}
                  color={tab === 'recent' ? '#fff' : '#777'}
                />
                <Text
                  style={[
                    styles.hashtagTabText,
                    tab === 'recent' && styles.hashtagTabTextActive,
                  ]}
                >
                  Récentes
                </Text>
              </TouchableOpacity>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.hashtagEmpty}>
            <View style={styles.hashtagEmptyIcon}>
              <Text style={styles.hashtagEmptyHash}>#</Text>
            </View>
            <Text style={styles.hashtagEmptyTitle}>
              Aucune publication pour {normalizedTag}
            </Text>
            <Text style={styles.hashtagEmptyText}>
              Les prochaines publications contenant {normalizedTag} apparaîtront ici automatiquement.
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          !sortedPosts.length
            ? { flexGrow: 1, paddingBottom: 24 }
            : { paddingBottom: 24 }
        }
      />
    </View>
  );
}

function ReelAction({ icon, label, onPress, color = '#fff' }) {
  return (
    <TouchableOpacity style={styles.reelAction} onPress={onPress}>
      <Ionicons name={icon} size={30} color={color} />
      {!!label && <Text style={styles.reelActionText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function ReelsScreen({ reels, onOpenUser, onCreate }) {
  const [active, setActive] = useState(0);
  const [pageHeight, setPageHeight] = useState(Math.max(1, SCREEN_HEIGHT - 180));
  return (
    <View
      style={{ flex: 1, backgroundColor: '#000' }}
      onLayout={(e) => {
        const h = Math.round(e.nativeEvent.layout.height);
        if (h > 0 && h !== pageHeight) setPageHeight(h);
      }}
    >
      <FlatList
        style={{ flex: 1 }}
        data={reels}
        pagingEnabled
        keyExtractor={(x) => x.id}
        showsVerticalScrollIndicator={false}
        snapToInterval={pageHeight}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
        onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.y / pageHeight))}
        renderItem={({ item, index }) => <ReelCard reel={item} active={active === index} onOpenUser={onOpenUser} onCreate={onCreate} pageHeight={pageHeight} />}
      />
    </View>
  );
}

function MessagesScreen({ chats, onOpenChat, onNewMessage }) {
  const [q, setQ] = useState('');
  const { refreshing, onRefresh } = useKidflixRefresh();
  const list = chats.filter((c) => c.user.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <View style={styles.screenRoot}>
      <View style={styles.messagesHeader}>
        <View>
          <Text style={styles.bigHeader}>Messages</Text>
          <Text style={styles.headerSub}>{ME.handle}</Text>
        </View>
        <TouchableOpacity onPress={onNewMessage} style={styles.iconRound}><Ionicons name="create-outline" size={25} color="#fff" /></TouchableOpacity>
      </View>
      <View style={[styles.searchBar, { marginHorizontal: 14, marginBottom: 12 }]}>
        <Ionicons name="search" size={19} color={COLORS.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Rechercher" placeholderTextColor={COLORS.muted} style={styles.searchInput} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleStrip}>
        {USERS.slice(0, 6).map((u, i) => (
          <TouchableOpacity key={u.id} style={styles.personBubble} onPress={() => onOpenChat({ id: `new-${u.id}`, user: u, preview: '', time: '', unread: 0 })}>
            <Avatar uri={u.avatar} size={61} active={i < 3} />
            <Text style={styles.personName} numberOfLines={1}>{u.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <FlatList
        data={list}
        keyExtractor={(x) => x.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            {...refreshControlProps}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.chatRow} onPress={() => onOpenChat(item)}>
            <Avatar uri={item.user.avatar} size={58} active />
            <View style={styles.chatTextBlock}>
              <Text style={styles.chatName}>{item.user.name}</Text>
              <Text style={[styles.chatPreview, item.unread > 0 && { color: '#fff', fontWeight: '700' }]} numberOfLines={1}>{item.preview} · {item.time}</Text>
            </View>
            {item.unread > 0 ? <View style={styles.unreadDot}><Text style={styles.unreadText}>{item.unread}</Text></View> : <TouchableOpacity onPress={() => onOpenChat(item)} style={styles.iconHit}><Ionicons name="camera-outline" size={25} color="#ddd" /></TouchableOpacity>}
          </TouchableOpacity>
        )}
        contentContainerStyle={{ paddingBottom: 18 }}
      />
    </View>
  );
}

function ChatScreen({ chat, onBack }) {
  const [messages, setMessages] = useState([
    { id: '1', mine: false, text: 'Salut 👋' },
    { id: '2', mine: true, text: 'Salut ! Ça va ?' },
    { id: '3', mine: false, text: 'Oui, regarde ce que je viens de publier 😄' },
  ]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [callMode, setCallMode] = useState(null);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [voicePlaying, setVoicePlaying] = useState(null);
  const send = () => {
    const value = text.trim();
    if (!value) return;
    setMessages((m) => [...m, { id: String(Date.now()), mine: true, text: value }]);
    setText('');
    setTyping(true);
    setTimeout(() => setTyping(false), 1200);
  };
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: .8 });
    if (!r.canceled && r.assets?.[0]?.uri) setMessages((m) => [...m, { id: String(Date.now()), mine: true, image: r.assets[0].uri }]);
  };
  const camera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Caméra', 'Autorise la caméra pour prendre une photo.');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: .8 });
    if (!r.canceled && r.assets?.[0]?.uri) setMessages((m) => [...m, { id: String(Date.now()), mine: true, image: r.assets[0].uri }]);
  };
  const sendHeart = () => setMessages((m) => [...m, { id: String(Date.now()), mine: true, text: '❤️' }]);
  const sendVoice = () => setMessages((m) => [...m, { id: String(Date.now()), mine: true, voice: true, duration: '0:08' }]);
  const react = (id) => setMessages((arr) => arr.map((m) => m.id === id ? { ...m, reaction: m.reaction === '❤️' ? null : '❤️' } : m));
  return (
    <KeyboardAvoidingView style={styles.screenRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={onBack} style={styles.iconHit}><Ionicons name="chevron-back" size={30} color="#fff" /></TouchableOpacity>
        <Avatar uri={chat.user.avatar} size={36} />
        <View style={{ flex: 1, marginLeft: 10 }}><Text style={styles.chatHeaderName}>{chat.user.name}</Text><Text style={styles.chatHeaderSub}>En ligne</Text></View>
        <TouchableOpacity style={styles.iconHit} onPress={() => setCallMode('audio')}><Ionicons name="call-outline" size={25} color="#fff" /></TouchableOpacity>
        <TouchableOpacity style={styles.iconHit} onPress={() => setCallMode('video')}><Ionicons name="videocam-outline" size={27} color="#fff" /></TouchableOpacity>
      </View>
      <FlatList
        data={messages}
        keyExtractor={(x) => x.id}
        renderItem={({ item }) => (
          <View style={[styles.messageLine, item.mine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
            {!item.mine && <Image source={{ uri: chat.user.avatar }} style={styles.messageAvatar} />}
            <View>
              <Pressable onLongPress={() => react(item.id)} onPress={() => item.voice && setVoicePlaying(voicePlaying === item.id ? null : item.id)}>
                {item.image ? <Image source={{ uri: item.image }} style={styles.messageImage} /> : item.voice ? <View style={[styles.messageBubble, item.mine ? styles.messageMine : styles.messageOther, styles.voiceBubble]}><Ionicons name={voicePlaying === item.id ? 'pause' : 'play'} size={18} color="#fff" /><View style={styles.voiceWave}>{[1,2,3,4,5,6,7,8,9].map((x) => <View key={x} style={[styles.voiceBar,{height:8+(x%4)*4}]} />)}</View><Text style={styles.messageText}>{item.duration}</Text></View> : <View style={[styles.messageBubble, item.mine ? styles.messageMine : styles.messageOther]}><Text style={styles.messageText}>{item.text}</Text></View>}
              </Pressable>
              {!!item.reaction && <View style={[styles.messageReaction, item.mine ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}><Text>{item.reaction}</Text></View>}
            </View>
          </View>
        )}
        ListFooterComponent={typing ? <Text style={styles.typingText}>{chat.user.name} écrit…</Text> : null}
        contentContainerStyle={styles.messagesList}
      />
      <View style={styles.chatComposer}>
        <TouchableOpacity style={styles.composerRound} onPress={camera}><Ionicons name="camera" size={22} color="#fff" /></TouchableOpacity>
        <View style={styles.composerInputWrap}>
          <TextInput value={text} onChangeText={setText} placeholder="Message…" placeholderTextColor={COLORS.muted} style={styles.composerInput} multiline />
          <TouchableOpacity onPress={pick}><Ionicons name="image-outline" size={22} color="#fff" /></TouchableOpacity>
          <TouchableOpacity onPress={sendVoice}><Ionicons name="mic-outline" size={22} color="#fff" /></TouchableOpacity>
        </View>
        {text.trim() ? <TouchableOpacity onPress={send}><Text style={styles.sendText}>Envoyer</Text></TouchableOpacity> : <TouchableOpacity onPress={sendHeart}><Ionicons name="heart" size={25} color={COLORS.pink} /></TouchableOpacity>}
      </View>

      <Modal visible={!!callMode} animationType="fade" onRequestClose={() => setCallMode(null)}>
        <LinearGradient colors={['#111827','#08080b','#000']} style={styles.callScreen}>
          <View style={styles.callTop}><Text style={styles.callType}>{callMode === 'video' ? 'Appel vidéo Lolitas of the World' : 'Appel audio Lolitas of the World'}</Text></View>
          <Avatar uri={chat.user.avatar} size={128} ring />
          <Text style={styles.callName}>{chat.user.name}</Text>
          <Text style={styles.callStatus}>Connexion…</Text>
          {callMode === 'video' && cameraOn && <View style={styles.callPreview}><Ionicons name="videocam" size={44} color="#fff" /><Text style={styles.callPreviewText}>Aperçu caméra local</Text></View>}
          <View style={styles.callControls}>
            <CallButton icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Réactiver' : 'Muet'} active={muted} onPress={() => setMuted(!muted)} />
            <CallButton icon={speaker ? 'volume-high' : 'volume-medium'} label="Haut-parleur" active={speaker} onPress={() => setSpeaker(!speaker)} />
            {callMode === 'video' && <CallButton icon={cameraOn ? 'videocam' : 'videocam-off'} label="Caméra" active={!cameraOn} onPress={() => setCameraOn(!cameraOn)} />}
            <CallButton icon="call" label="Raccrocher" danger onPress={() => setCallMode(null)} />
          </View>
          <Text style={styles.callNote}>Démo locale : l’interface d’appel fonctionne. Une vraie communication audio/vidéo nécessite un service temps réel.</Text>
        </LinearGradient>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function CallButton({ icon, label, active, danger, onPress }) {
  return <TouchableOpacity style={styles.callButtonWrap} onPress={onPress}><View style={[styles.callButton, active && { backgroundColor:'#fff' }, danger && { backgroundColor:COLORS.red }]}><Ionicons name={icon} size={25} color={active ? '#000' : '#fff'} /></View><Text style={styles.callButtonLabel}>{label}</Text></TouchableOpacity>;
}

function ProfileScreen({ profile, posts, onEdit, onSettings, onOpenMedia, onCreate, ownStory, onOpenOwnStory, onRemoteRefresh }) {
  const [tab, setTab] = useState('grid');
  const [switcher, setSwitcher] = useState(false);
  const { refreshing, onRefresh } = useKidflixRefresh(850, onRemoteRefresh);
  const [people, setPeople] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const myMedia = [
    { uri: profile.banner, type: 'image', owner: profile, caption: 'Publication Lolitas of the World', likes: 0, comments: [] },
    { uri: 'https://picsum.photos/id/1060/600/800', type: 'image', owner: profile, caption: 'Publication Lolitas of the World', likes: 0, comments: [] },
    { uri: 'https://picsum.photos/id/1062/600/800', type: 'image', owner: profile, caption: 'Publication Lolitas of the World', likes: 0, comments: [] },
    { uri: 'https://picsum.photos/id/1067/600/800', type: 'image', owner: profile, caption: 'Publication Lolitas of the World', likes: 0, comments: [] },
    { uri: 'https://picsum.photos/id/1069/600/800', type: 'image', owner: profile, caption: 'Publication Lolitas of the World', likes: 0, comments: [] },
    { uri: 'https://picsum.photos/id/1074/600/800', type: 'image', owner: profile, caption: 'Publication Lolitas of the World', likes: 0, comments: [] },
    ...posts.filter((p) => p.owner.id === 'me').map((p) => ({
      uri: p.media?.[0],
      type: p.mediaTypes?.[0] || mediaTypeFromUri(p.media?.[0] || ''),
      media: p.media || [],
      mediaTypes: p.mediaTypes || [],
      owner: p.owner,
      caption: p.caption,
      likes: p.likes,
      comments: p.comments,
      postId: p.id,
    })),
  ].filter((x) => x?.uri);
  const openLink = async () => {
    const url = /^https?:\/\//i.test(profile.link || '') ? profile.link : `https://${profile.link}`;
    try { await Linking.openURL(url); } catch { Alert.alert('Lien', url); }
  };
  const shareProfile = () => Share.share({ message: `${profile.name} sur Lolitas of the World — ${profile.handle} — ${profile.link}` });
  return (
    <ScrollView
      style={styles.screenRoot}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 18 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          {...refreshControlProps}
        />
      }
    >
      <View style={styles.profileTopBar}>
        <TouchableOpacity style={styles.profileHandleRow} onPress={() => setSwitcher(true)}><Ionicons name="lock-closed-outline" size={14} color="#fff" /><Text style={styles.profileTopHandle}>{profile.handle.replace('@', '')}</Text><Ionicons name="chevron-down" size={17} color="#fff" /></TouchableOpacity>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity style={styles.iconHit} onPress={onSettings}><Ionicons name="menu" size={30} color="#fff" /></TouchableOpacity>
        </View>
      </View>
      <Image source={{ uri: profile.banner }} style={styles.profileBanner} />
      <View style={styles.profileInfoWrap}>
        <View style={styles.profileStatsRow}>
          <TouchableOpacity activeOpacity={ownStory ? 0.72 : 1} onPress={ownStory ? onOpenOwnStory : undefined}><Avatar uri={profile.avatar} size={86} ring={!!ownStory} /></TouchableOpacity>
          <Stat n={String(Math.max(24, posts.filter((p)=>p.owner.id==='me').length))} label="publications" onPress={() => setTab('grid')} />
          <Stat n="12,8 k" label="followers" onPress={() => setPeople('Followers')} />
          <Stat n="529" label="suivis" onPress={() => setPeople('Suivis')} />
        </View>
        <Text style={styles.profileName}>{profile.name}</Text>
        <Text style={styles.profileBio}>{profile.bio}</Text>
        <TouchableOpacity onPress={openLink}><Text style={styles.profileLink}>{profile.link}</Text></TouchableOpacity>
        <View style={styles.profileButtonsRow}>
          <TouchableOpacity style={styles.profileBtn} onPress={onEdit}><Text style={styles.profileBtnText}>Modifier le profil</Text></TouchableOpacity>
          <TouchableOpacity style={styles.profileBtn} onPress={shareProfile}><Text style={styles.profileBtnText}>Partager le profil</Text></TouchableOpacity>
          <TouchableOpacity style={styles.profileSmallBtn} onPress={() => setPeople('Suggestions')}><Ionicons name="person-add-outline" size={17} color="#fff" /></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlightsRow}>
          {['Nouveau', 'Voyages', 'Behind', 'Moments'].map((x, i) => (
            <TouchableOpacity key={x} style={styles.highlightItem} onPress={() => i === 0 ? onCreate() : setHighlight({ id:`h-${i}`, image:`https://picsum.photos/id/${1080+i}/900/1400` })}><View style={styles.highlightCircle}>{i === 0 ? <Ionicons name="add" size={28} color="#fff" /> : <Image source={{ uri: `https://picsum.photos/id/${1080 + i}/180/180` }} style={StyleSheet.absoluteFillObject} />}</View><Text style={styles.highlightLabel}>{x}</Text></TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={styles.profileTabs}>
        <ProfileTab icon="grid-outline" active={tab === 'grid'} onPress={() => setTab('grid')} />
        <ProfileTab icon="person-outline" active={tab === 'tagged'} onPress={() => setTab('tagged')} />
      </View>
      <View style={styles.profileGrid}>
        {myMedia.map((m, i) => <TouchableOpacity key={`${m.uri}-${i}`} onPress={() => onOpenMedia({ id: m.postId || `mine-${i}`, image: m.uri, video: m.type === 'video' ? m.uri : undefined, type: m.type, media: m.media?.length ? m.media : [m.uri], mediaTypes: m.mediaTypes?.length ? m.mediaTypes : [m.type], owner: m.owner || profile, caption: m.caption || 'Publication Lolitas of the World', likes: m.likes || 0, comments: m.comments || [] })} style={styles.profileGridTile}>{m.type === 'video' ? <><VideoMedia uri={m.uri} style={StyleSheet.absoluteFillObject} contentFit="cover" autoplay={false} muted controls={false} /><Ionicons name="play" size={20} color="#fff" style={styles.gridOverlayIcon} /></> : m.type === 'embed' ? <><EmbeddedMedia uri={m.uri} style={StyleSheet.absoluteFillObject} interactive={false} /><Ionicons name="code-slash-outline" size={18} color="#fff" style={styles.gridOverlayIcon} /></> : <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />}{m.media?.length > 1 && <Ionicons name="copy-outline" size={19} color="#fff" style={styles.gridCarouselIcon} />}{tab === 'tagged' && <Ionicons name="person" size={17} color="#fff" style={styles.gridOverlayIcon} />}</TouchableOpacity>)}
      </View>

      <Modal visible={switcher} transparent animationType="fade" onRequestClose={() => setSwitcher(false)}>
        <Pressable style={styles.centerModalBackdrop} onPress={() => setSwitcher(false)}>
          <Pressable style={styles.accountSwitcher} onPress={(e)=>e.stopPropagation?.()}>
            <Text style={styles.dialogTitle}>Comptes</Text>
            <TouchableOpacity style={styles.accountRow} onPress={() => setSwitcher(false)}><Avatar uri={profile.avatar} size={44} /><View style={{flex:1,marginLeft:10}}><Text style={styles.accountName}>{profile.handle}</Text><Text style={styles.accountSub}>Compte actuel</Text></View><Ionicons name="checkmark-circle" size={22} color={COLORS.blue}/></TouchableOpacity>
            <TouchableOpacity style={styles.accountRow} onPress={() => { setSwitcher(false); Alert.alert('Ajouter un compte','L’écran de connexion permet d’ajouter un autre compte dans cette démo.'); }}><View style={styles.addAccountCircle}><Ionicons name="add" size={24} color="#fff"/></View><Text style={[styles.accountName,{marginLeft:10}]}>Ajouter un compte</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <PeopleModal visible={!!people} title={people || ''} onClose={() => setPeople(null)} />
      <MediaViewer item={highlight} visible={!!highlight} onClose={() => setHighlight(null)} />
    </ScrollView>
  );
}

function Stat({ n, label, onPress }) {
  const body = <View style={styles.stat}><Text style={styles.statN}>{n}</Text><Text style={styles.statLabel}>{label}</Text></View>;
  return onPress ? <TouchableOpacity onPress={onPress}>{body}</TouchableOpacity> : body;
}

function PeopleModal({ visible, title, onClose }) {
  const [following, setFollowing] = useState({});
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><SafeAreaView style={styles.screenRoot}><View style={styles.simpleHeader}><TouchableOpacity onPress={onClose} style={styles.iconHit}><Ionicons name="chevron-back" size={30} color="#fff"/></TouchableOpacity><Text style={styles.simpleHeaderTitle}>{title}</Text><View style={{width:40}}/></View><FlatList data={USERS} keyExtractor={(x)=>x.id} renderItem={({item})=><View style={styles.peopleRow}><Avatar uri={item.avatar} size={48}/><View style={{flex:1,marginLeft:11}}><Text style={styles.chatName}>{item.name}</Text><Text style={styles.chatPreview}>{item.handle}</Text></View><TouchableOpacity style={[styles.followButtonSmall, following[item.id] && {backgroundColor:'#333'}]} onPress={()=>setFollowing((m)=>({...m,[item.id]:!m[item.id]}))}><Text style={styles.followButtonSmallText}>{following[item.id]?'Suivi(e)':'Suivre'}</Text></TouchableOpacity></View>} /></SafeAreaView></Modal>;
}

function ProfileTab({ icon, active, onPress }) {
  return <TouchableOpacity style={[styles.profileTab, active && styles.profileTabActive]} onPress={onPress}><Ionicons name={icon} size={24} color={active ? '#fff' : '#85858c'} /></TouchableOpacity>;
}

function OtherProfileScreen({ user, onBack, onMessage, isFollowing = false, onToggleFollow }) {
  const [follow, setFollow] = useState(false);
  const [menu, setMenu] = useState(false);
  const [media, setMedia] = useState(null);
  const [people, setPeople] = useState(null);
  const imgs = [1003, 1011, 1019, 1024, 1033, 1040, 1048, 1052, 1067];
  return (
    <ScrollView style={styles.screenRoot} contentContainerStyle={{ paddingBottom: 80 }}>
      <View style={styles.simpleHeader}><TouchableOpacity onPress={onBack} style={styles.iconHit}><Ionicons name="chevron-back" size={30} color="#fff" /></TouchableOpacity><Text style={styles.simpleHeaderTitle}>{user.handle}</Text><TouchableOpacity style={styles.iconHit} onPress={() => setMenu(true)}><Ionicons name="ellipsis-horizontal" size={24} color="#fff" /></TouchableOpacity></View>
      <View style={styles.otherProfileHead}>
        <Avatar uri={user.avatar} size={88} ring />
        <Stat n="37" label="publications" /><Stat n="18,3 k" label="followers" onPress={()=>setPeople('Followers')} /><Stat n="418" label="suivis" onPress={()=>setPeople('Suivis')} />
      </View>
      <View style={{ paddingHorizontal: 16 }}><View style={styles.nameVerifiedRow}><Text style={styles.profileName}>{user.name}</Text>{user.verified && <Verified />}</View><Text style={styles.profileBio}>Créatrice digitale • photos • vidéo</Text></View>
      <View style={styles.otherButtons}>
        <TouchableOpacity
          style={[styles.followButton, isFollowing && styles.followingButton]}
          onPress={() => onToggleFollow?.(user.id)}
        >
          <Text style={styles.followButtonText}>
            {isFollowing ? 'Suivi(e)' : 'Suivre'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.profileBtn} onPress={onMessage}><Text style={styles.profileBtnText}>Message</Text></TouchableOpacity>
      </View>
      <View style={styles.profileGrid}>{imgs.map((id) => <TouchableOpacity key={id} onPress={()=>setMedia({id:`other-${id}`,image:`https://picsum.photos/id/${id}/600/800`})} style={styles.profileGridTile}><Image source={{ uri: `https://picsum.photos/id/${id}/600/800` }} style={StyleSheet.absoluteFillObject} /></TouchableOpacity>)}</View>
      <Modal visible={menu} transparent animationType="slide" onRequestClose={()=>setMenu(false)}><Pressable style={styles.modalBackdropBottom} onPress={()=>setMenu(false)}><Pressable style={styles.actionSheet} onPress={(e)=>e.stopPropagation?.()}><View style={styles.sheetHandle}/><SheetAction icon="share-social-outline" label="Partager ce profil" onPress={()=>{setMenu(false);Share.share({message:`${user.name} sur Lolitas of the World — ${user.handle}`})}}/><SheetAction icon="information-circle-outline" label="À propos de ce compte" onPress={()=>{setMenu(false);Alert.alert('À propos',`${user.name}\n${user.handle}\nCompte de démonstration Kidflix.`)}}/><SheetAction icon="ban-outline" label="Bloquer" danger onPress={()=>{setMenu(false);Alert.alert('Compte bloqué',`${user.name} a été bloqué localement.`)}}/><SheetAction icon="flag-outline" label="Signaler" danger onPress={()=>{setMenu(false);Alert.alert('Signalement envoyé','Merci pour ton signalement.')}}/></Pressable></Pressable></Modal>
      <PeopleModal visible={!!people} title={people||''} onClose={()=>setPeople(null)}/>
      <MediaViewer item={media} visible={!!media} onClose={()=>setMedia(null)}/>
    </ScrollView>
  );
}

function InstagramReelsTabIcon({ active }) {
  return (
    <View style={[styles.igReelsIcon, active && styles.igReelsIconActive]}>
      <View style={styles.igReelsClapper}>
        <View style={styles.igReelsSlash} />
        <View style={[styles.igReelsSlash, { left: 9 }]} />
        <View style={[styles.igReelsSlash, { left: 18 }]} />
      </View>
      <Ionicons name="play" size={12} color={active ? '#000' : '#fff'} style={{ marginTop: 4 }} />
    </View>
  );
}

function KidflixCreateTabIcon() {
  return (
    <View style={styles.kidflixCreateWrap}>
      <View style={styles.kidflixCreateCyan} />
      <View style={styles.kidflixCreatePink} />
      <View style={styles.kidflixCreateFront}>
        <Ionicons name="add" size={25} color="#000" />
      </View>
    </View>
  );
}

function BottomNav({ route, onRoute, onCreate, profile, bottomInset = 0, isGuest = false, onRestrictedAccess }) {
  return (
    <View style={[styles.bottomNav, { height: 58 + bottomInset, paddingBottom: bottomInset }]}>
      <TouchableOpacity style={styles.navBtn} onPress={() => onRoute('home')}>
        <Ionicons name={route === 'home' ? 'home' : 'home-outline'} size={29} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.navBtn} onPress={onCreate} activeOpacity={0.78}>
        <KidflixCreateTabIcon />
      </TouchableOpacity>

      <TouchableOpacity style={styles.navBtn} onPress={() => onRoute('explore')}>
        <Ionicons name="search-outline" size={31} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navBtn}
        onPress={() => isGuest ? onRestrictedAccess?.('profil') : onRoute('profile')}
      >
        {isGuest ? (
          <Ionicons name="person-circle-outline" size={31} color="#fff" />
        ) : (
          <Image
            source={{ uri: profile.avatar }}
            style={[styles.navAvatarInstagram, route === 'profile' && styles.navAvatarInstagramActive]}
          />
        )}
      </TouchableOpacity>
    </View>
  );
}

function CommentsModal({ post, visible, onClose, onAdd }) {
  const [text, setText] = useState('');
  const [liked, setLiked] = useState({});
  if (!post) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdropBottom} onPress={onClose}>
        <Pressable style={styles.sheetLarge} onPress={(e)=>e.stopPropagation?.()}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetTitleRow}><View style={{width:38}}/><Text style={styles.sheetTitleInline}>Commentaires</Text><TouchableOpacity style={styles.iconHit} onPress={onClose}><Ionicons name="close" size={24} color="#fff"/></TouchableOpacity></View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            {post.comments.length ? post.comments.map((c) => <View key={c.id} style={styles.commentRow}><Avatar uri={USERS.find((u) => u.name === c.name)?.avatar || ME.avatar} size={35} /><View style={{ flex: 1, marginLeft: 10 }}><Text style={styles.commentAuthor}>{c.name}</Text><Text style={styles.commentText}>{c.text}</Text></View><TouchableOpacity onPress={()=>setLiked((m)=>({...m,[c.id]:!m[c.id]}))}><Ionicons name={liked[c.id]?'heart':'heart-outline'} size={18} color={liked[c.id]?COLORS.red:'#aaa'} /></TouchableOpacity></View>) : <View style={styles.emptyState}><Ionicons name="chatbubble-ellipses-outline" size={43} color="#777" /><Text style={styles.emptyTitle}>Aucun commentaire</Text><Text style={styles.emptyText}>Sois le premier à commenter.</Text></View>}
          </ScrollView>
          <View style={styles.commentComposer}><Avatar uri={ME.avatar} size={34} /><TextInput value={text} onChangeText={setText} placeholder="Ajouter un commentaire…" placeholderTextColor={COLORS.muted} style={styles.commentInput} /><TouchableOpacity onPress={() => { if (text.trim()) { onAdd(post.id, text.trim()); setText(''); } }}><Text style={styles.sendText}>Publier</Text></TouchableOpacity></View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StoryViewer({ visible, index, onClose, own = false, customMedia = null }) {
  const [idx, setIdx] = useState(index || 0);
  const [reply, setReply] = useState('');
  const [storyLiked, setStoryLiked] = useState(false);
  const [storyLikeBurst, setStoryLikeBurst] = useState(false);
  const storyLastTap = useRef(0);
  const storyTapTimer = useRef(null);

  useEffect(() => {
    setIdx(index || 0);
    setReply('');
    setStoryLiked(false);
  }, [index, visible]);

  useEffect(() => () => {
    if (storyTapTimer.current) clearTimeout(storyTapTimer.current);
  }, []);
  const storyMedia = own && customMedia?.uri
    ? [customMedia]
    : STORY_MEDIA.map((uri) => ({ uri, type: 'image' }));
  const currentMedia = storyMedia[idx % storyMedia.length];
  const user = own ? ME : USERS[idx % USERS.length];
  const sendReply = () => {
    if (!reply.trim()) return Share.share({ message: `Story Lolitas of the World de ${user.handle}` });
    Alert.alert('Message envoyé', `Ton message a été envoyé à ${user.name}.`);
    setReply('');
  };

  const likeStory = () => {
    setStoryLiked(true);
    setStoryLikeBurst(true);
    setTimeout(() => setStoryLikeBurst(false), 650);
  };

  const handleStoryTap = (direction) => {
    const now = Date.now();

    if (now - storyLastTap.current < 300) {
      if (storyTapTimer.current) {
        clearTimeout(storyTapTimer.current);
        storyTapTimer.current = null;
      }
      likeStory();
      storyLastTap.current = 0;
      return;
    }

    storyLastTap.current = now;
    storyTapTimer.current = setTimeout(() => {
      if (direction === 'prev') {
        setIdx((x) => Math.max(0, x - 1));
      } else {
        setIdx((x) => x >= storyMedia.length - 1 ? x : x + 1);
        if (idx >= storyMedia.length - 1) onClose();
      }
      storyTapTimer.current = null;
    }, 260);
  };
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.storyViewer}>
        <StoryMediaContent media={currentMedia} />
        <LinearGradient colors={['rgba(0,0,0,.65)', 'transparent', 'rgba(0,0,0,.45)']} style={StyleSheet.absoluteFillObject} />
        <View style={styles.storyBars}>{storyMedia.map((_, i) => <View key={i} style={styles.storyBarTrack}><View style={[styles.storyBarFill, { width: i <= idx ? '100%' : '0%' }]} /></View>)}</View>
        <View style={styles.storyViewerHeader}><Avatar uri={user.avatar} size={35} /><Text style={styles.storyViewerName}>{user.handle}</Text><Text style={styles.storyViewerTime}>12 min</Text><View style={{ flex: 1 }} /><TouchableOpacity onPress={()=>Share.share({message:`Story Lolitas of the World de ${user.handle}`})} style={styles.iconHit}><Ionicons name="paper-plane-outline" size={23} color="#fff"/></TouchableOpacity><TouchableOpacity onPress={onClose}><Ionicons name="close" size={30} color="#fff" /></TouchableOpacity></View>
        <View style={styles.storyTapZones}>
          <Pressable style={{ flex: 1 }} onPress={() => handleStoryTap('prev')} />
          <Pressable style={{ flex: 2 }} onPress={() => handleStoryTap('next')} />
        </View>
        {storyLikeBurst && (
          <View pointerEvents="none" style={styles.doubleTapHeart}>
            <Ionicons name="heart" size={92} color="#fff" />
          </View>
        )}
        <View style={styles.storyReply}>
          <TextInput value={reply} onChangeText={setReply} placeholder="Envoyer un message" placeholderTextColor="#ddd" style={styles.storyReplyInput} />
          <TouchableOpacity onPress={() => setStoryLiked((v) => !v)}>
            <Ionicons name={storyLiked ? 'heart' : 'heart-outline'} size={28} color={storyLiked ? COLORS.red : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={sendReply}><Ionicons name="paper-plane-outline" size={26} color="#fff" /></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}


function PublicationViewerVideo({ uri, active = true, style }) {
  const insets = useSafeAreaInsets();
  const [progress, setProgress] = useState(0);
  const [trackWidth, setTrackWidth] = useState(1);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    if (active) p.play();
  });

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  useEffect(() => {
    const timer = setInterval(() => {
      const duration = Number(player.duration || 0);
      const current = Number(player.currentTime || 0);
      setProgress(duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0);
    }, 120);

    return () => clearInterval(timer);
  }, [player]);

  const seekFromPress = (event) => {
    const x = Number(event?.nativeEvent?.locationX || 0);
    const ratio = Math.max(0, Math.min(1, x / Math.max(1, trackWidth)));
    const duration = Number(player.duration || 0);

    if (duration > 0) {
      try {
        player.currentTime = duration * ratio;
      } catch (e) {}
      setProgress(ratio);
    }
  };

  return (
    <View style={style}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit="contain"
        nativeControls={false}
      />

      <Pressable
        style={[
          styles.publicationProgressTouch,
          { bottom: Math.max(insets.bottom, 28) + 54 },
        ]}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width || 1)}
        onPress={seekFromPress}
      >
        <View style={styles.publicationProgressTrack}>
          <View style={[styles.publicationProgressFill, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}


function ExploreSwipePage({ item, active, pageHeight, onClose, profile, onOpenHashtag }) {
  const insets = useSafeAreaInsets();
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [follow, setFollow] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [localComments, setLocalComments] = useState([]);
  const [mediaIndex, setMediaIndex] = useState(Math.max(0, Number(item?.initialIndex || 0)));
  const horizontalRef = useRef(null);

  useEffect(() => {
    const start = Math.max(0, Number(item?.initialIndex || 0));
    setMediaIndex(start);
    requestAnimationFrame(() => {
      horizontalRef.current?.scrollTo({
        x: start * SCREEN_WIDTH,
        y: 0,
        animated: false,
      });
    });
  }, [item?.id, item?.initialIndex]);

  const media = Array.isArray(item?.media) && item.media.length
    ? item.media
    : [item?.video || item?.image].filter(Boolean);

  const types = Array.isArray(item?.mediaTypes) && item.mediaTypes.length
    ? item.mediaTypes
    : media.map((uri, i) =>
        i === 0 && item?.type ? item.type : mediaTypeFromUri(uri)
      );

  const owner = item?.owner || profile || ME;
  const caption = item?.caption || 'Publication Lolitas of the World';
  const baseComments = Array.isArray(item?.comments) ? item.comments : [];
  const commentCount = baseComments.length + localComments.length;
  const baseLikes = typeof item?.likes === 'number'
    ? item.likes
    : Number(item?.likes || 0);

  const fakePost = {
    id: item?.id || 'explore-viewer',
    comments: [...baseComments, ...localComments],
  };

  return (
    <View style={[styles.exploreSwipePage, { height: pageHeight }]}>
      <ScrollView
        ref={horizontalRef}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setMediaIndex(
            Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
          )
        }
      >
        {media.map((uri, i) => {
          const type = types[i] || mediaTypeFromUri(uri);

          return (
            <View
              key={`${item?.id || 'x'}-${i}`}
              style={[styles.mediaReelSlide, { height: pageHeight }]}
            >
              {type === 'video' ? (
                <PublicationViewerVideo
                  uri={uri}
                  active={active && i === mediaIndex}
                  style={StyleSheet.absoluteFillObject}
                />
              ) : type === 'embed' ? (
                <EmbeddedMedia
                  uri={uri}
                  style={StyleSheet.absoluteFillObject}
                  interactive={active && i === mediaIndex}
                />
              ) : (
                <Image
                  source={{ uri }}
                  style={StyleSheet.absoluteFillObject}
                  resizeMode="contain"
                />
              )}
            </View>
          );
        })}
      </ScrollView>

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,.18)', 'transparent', 'rgba(0,0,0,.76)']}
        locations={[0, .48, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {media.length > 1 && (
        <View pointerEvents="none" style={styles.mediaReelCarouselPill}>
          <Text style={styles.mediaReelCarouselPillText}>
            {mediaIndex + 1}/{media.length}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.mediaReelTop,
          { top: Math.max(insets.top, 24) + 10 },
        ]}
      >
        <TouchableOpacity onPress={onClose} style={styles.mediaReelBack}>
          <Ionicons name="chevron-back" size={32} color="#fff" />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.publicationBottomInfo,
          { bottom: Math.max(insets.bottom, 28) + 74 },
        ]}
      >
        <View style={styles.publicationUserLine}>
          <Avatar uri={owner.avatar || ME.avatar} size={34} />

          <Text style={styles.publicationHandle} numberOfLines={1}>
            {owner.handle || '@lolitasoftheworld'}
          </Text>

          <TouchableOpacity
            onPress={() => setFollow(!follow)}
            style={styles.publicationFollowTap}
          >
            <Text
              style={[
                styles.publicationFollowText,
                follow && styles.publicationFollowTextActive,
              ]}
            >
              {follow ? 'Suivi(e)' : 'Suivre'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.publicationAudioLine}>
          <Ionicons
            name={
              types[mediaIndex] === 'video'
                ? 'musical-note'
                : 'images-outline'
            }
            size={13}
            color="#fff"
          />
          <Text style={styles.publicationAudioText} numberOfLines={1}>
            {types[mediaIndex] === 'video'
              ? 'Audio original • Lolitas of the World'
              : types[mediaIndex] === 'embed'
                ? 'Publication embed • Lolitas of the World'
                : 'Publication photo • Lolitas of the World'}
          </Text>
        </View>

        <HashtagCaption
          text={caption}
          onHashtagPress={onOpenHashtag}
          style={styles.publicationCaption}
          numberOfLines={1}
        />
        <Text style={styles.publicationMore}>Voir plus</Text>
      </View>

      <View
        style={[
          styles.publicationSideActions,
          { bottom: Math.max(insets.bottom, 28) + 76 },
        ]}
      >
        <ReelAction
          icon={liked ? 'heart' : 'heart-outline'}
          color={liked ? COLORS.red : '#fff'}
          label={String(baseLikes + (liked ? 1 : 0))}
          onPress={() => setLiked(!liked)}
        />

        <ReelAction
          icon="chatbubble-outline"
          label={String(commentCount)}
          onPress={() => setCommentsOpen(true)}
        />

        <ReelAction
          icon="repeat-outline"
          label={reposted ? '1' : '0'}
          onPress={() => setReposted(!reposted)}
        />

        <ReelAction
          icon="paper-plane-outline"
          label=""
          onPress={() =>
            Share.share({
              message: `Regarde cette publication Lolitas of the World de ${
                owner.handle || '@lolitasoftheworld'
              } — ${caption}`,
            })
          }
        />

        <ReelAction
          icon={saved ? 'bookmark' : 'bookmark-outline'}
          label=""
          onPress={() => setSaved(!saved)}
        />

        <ReelAction
          icon="ellipsis-horizontal"
          onPress={() => setMenuOpen(true)}
        />

        <Image
          source={{ uri: owner.avatar || ME.avatar }}
          style={styles.publicationMiniCover}
        />
      </View>

      <View
        style={[
          styles.publicationQuickComment,
          { bottom: Math.max(insets.bottom, 28) + 8 },
        ]}
      >
        <TextInput
          value={commentDraft}
          onChangeText={setCommentDraft}
          placeholder="Ajoutez un commentaire..."
          placeholderTextColor="rgba(255,255,255,.78)"
          style={styles.publicationQuickCommentInput}
          returnKeyType="send"
          onSubmitEditing={() => {
            const value = commentDraft.trim();
            if (!value) return;

            setLocalComments((x) => [
              ...x,
              {
                id: String(Date.now()),
                name: ME.name,
                text: value,
              },
            ]);
            setCommentDraft('');
          }}
        />
      </View>

      <CommentsModal
        post={fakePost}
        visible={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        onAdd={(id, value) =>
          setLocalComments((x) => [
            ...x,
            {
              id: String(Date.now()),
              name: ME.name,
              text: value,
            },
          ])
        }
      />

      <Modal
        visible={menuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          style={styles.modalBackdropBottom}
          onPress={() => setMenuOpen(false)}
        >
          <Pressable
            style={styles.actionSheet}
            onPress={(e) => e.stopPropagation?.()}
          >
            <View style={styles.sheetHandle} />

            <SheetAction
              icon="share-social-outline"
              label="Partager"
              onPress={() => {
                setMenuOpen(false);
                Share.share({
                  message: `Publication Lolitas of the World de ${
                    owner.handle || '@lolitasoftheworld'
                  }`,
                });
              }}
            />

            <SheetAction
              icon={saved ? 'bookmark' : 'bookmark-outline'}
              label={
                saved
                  ? 'Retirer des éléments enregistrés'
                  : 'Enregistrer'
              }
              onPress={() => {
                setSaved(!saved);
                setMenuOpen(false);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ExploreSwipeViewer({ item, visible, onClose, profile, onOpenHashtag }) {
  const listRef = useRef(null);
  const [pageHeight, setPageHeight] = useState(SCREEN_HEIGHT);
  const [activeIndex, setActiveIndex] = useState(
    Math.max(0, Number(item?.exploreIndex || 0))
  );

  const feed = Array.isArray(item?.exploreFeed)
    ? item.exploreFeed
    : [item].filter(Boolean);

  useEffect(() => {
    if (!visible) return;

    const start = Math.max(
      0,
      Math.min(feed.length - 1, Number(item?.exploreIndex || 0))
    );

    setActiveIndex(start);

    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        offset: start * pageHeight,
        animated: false,
      });
    });
  }, [visible, item?.exploreIndex, pageHeight]);

  if (!visible || !feed.length) return null;

  return (
    <View
      style={styles.mediaReelModal}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h && Math.abs(h - pageHeight) > 2) {
          setPageHeight(h);
        }
      }}
    >
      <StatusBar hidden translucent backgroundColor="transparent" />

      <FlatList
        ref={listRef}
        data={feed}
        keyExtractor={(entry, index) =>
          `${entry?.id || 'explore'}-${index}`
        }
        renderItem={({ item: entry, index }) => (
          <ExploreSwipePage
            item={entry}
            active={index === activeIndex}
            pageHeight={pageHeight}
            onClose={onClose}
            profile={profile}
            onOpenHashtag={onOpenHashtag}
          />
        )}
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={pageHeight}
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        initialNumToRender={3}
        windowSize={5}
        nestedScrollEnabled
        onMomentumScrollEnd={(e) => {
          const next = Math.round(
            e.nativeEvent.contentOffset.y / Math.max(1, pageHeight)
          );
          setActiveIndex(
            Math.max(0, Math.min(feed.length - 1, next))
          );
        }}
        getItemLayout={(data, index) => ({
          length: pageHeight,
          offset: pageHeight * index,
          index,
        })}
      />
    </View>
  );
}

function MediaViewer({ item, visible, onClose, profile, currentRoute, onNavigate, onCreate, onOpenHashtag }) {
  if (item?.fromExplore && Array.isArray(item?.exploreFeed)) {
    return (
      <ExploreSwipeViewer
        item={item}
        visible={visible}
        onClose={onClose}
        profile={profile}
        onOpenHashtag={onOpenHashtag}
      />
    );
  }

  const insets = useSafeAreaInsets();
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [follow, setFollow] = useState(false);
  const [comments, setComments] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [localComments, setLocalComments] = useState([]);
  const [mediaIndex, setMediaIndex] = useState(0);
  const viewerScrollRef = useRef(null);
  useEffect(() => {
    if (!visible) {
      setLiked(false);
      setSaved(false);
      setFollow(false);
      setMenu(false);
      setComments(false);
      setReposted(false);
      setCommentDraft('');
      setLocalComments([]);
      setMediaIndex(0);
    }
  }, [visible]);
  useEffect(() => {
    const startIndex = Math.max(0, Number(item?.initialIndex || 0));
    setMediaIndex(startIndex);
    if (visible && viewerScrollRef.current) {
      requestAnimationFrame(() => {
        viewerScrollRef.current?.scrollTo({ x: startIndex * SCREEN_WIDTH, y: 0, animated: false });
      });
    }
  }, [item?.id, item?.initialIndex, visible]);
  if (!item) return null;

  const viewerMedia = Array.isArray(item.media) && item.media.length
    ? item.media
    : [item.video || item.image].filter(Boolean);
  const viewerTypes = Array.isArray(item.mediaTypes) && item.mediaTypes.length
    ? item.mediaTypes
    : viewerMedia.map((uri, i) => i === 0 && item.type ? item.type : mediaTypeFromUri(uri));

  const owner = item.owner || profile || ME;
  const caption = item.caption || 'Publication Lolitas of the World';
  const baseComments = Array.isArray(item.comments) ? item.comments : [];
  const commentCount = baseComments.length + localComments.length;
  const baseLikes = typeof item.likes === 'number' ? item.likes : Number(item.likes || 0);
  const fakePost = { id: item.id || 'viewer', comments: [...baseComments, ...localComments] };
  if (!visible) return null;

  return (
    <View style={styles.mediaReelModal}>
      <StatusBar hidden translucent backgroundColor="transparent" />
      <View style={styles.mediaReelSafe}>
        <View style={styles.mediaReelStage}>
            <ScrollView
              ref={viewerScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setMediaIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
            >
              {viewerMedia.map((uri, i) => {
                const type = viewerTypes[i] || mediaTypeFromUri(uri);
                return (
                  <View key={`${uri}-${i}`} style={styles.mediaReelSlide}>
                    {type === 'video'
                      ? <PublicationViewerVideo
                          uri={uri}
                          active={i === mediaIndex}
                          style={StyleSheet.absoluteFillObject}
                        />
                      : type === 'embed'
                        ? <EmbeddedMedia
                            uri={uri}
                            style={StyleSheet.absoluteFillObject}
                            interactive={i === mediaIndex}
                          />
                        : <Image
                            source={{ uri }}
                            style={StyleSheet.absoluteFillObject}
                            resizeMode="contain"
                          />}
                  </View>
                );
              })}
            </ScrollView>

            <LinearGradient
              pointerEvents="none"
              colors={['rgba(0,0,0,.24)', 'transparent', 'rgba(0,0,0,.78)']}
              locations={[0, .48, 1]}
              style={StyleSheet.absoluteFillObject}
            />

            {viewerMedia.length > 1 && (
              <View pointerEvents="none" style={styles.mediaReelCarouselPill}>
                <Text style={styles.mediaReelCarouselPillText}>{mediaIndex + 1}/{viewerMedia.length}</Text>
              </View>
            )}

            <View style={[styles.mediaReelTop, { top: Math.max(insets.top, 24) + 10 }]}>
              <TouchableOpacity onPress={onClose} style={styles.mediaReelBack}>
                <Ionicons name="chevron-back" size={32} color="#fff" />
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              <View style={{ width: 44 }} />
            </View>

            <View
              style={[
                styles.publicationBottomInfo,
                { bottom: Math.max(insets.bottom, 28) + 74 },
              ]}
            >
              <View style={styles.publicationUserLine}>
                <Avatar uri={owner.avatar || profile?.avatar || ME.avatar} size={34} />

                <Text style={styles.publicationHandle} numberOfLines={1}>
                  {owner.handle || '@lolitasoftheworld'}
                </Text>

                <TouchableOpacity
                  onPress={() => setFollow(!follow)}
                  style={styles.publicationFollowTap}
                >
                  <Text style={[styles.publicationFollowText, follow && styles.publicationFollowTextActive]}>
                    {follow ? 'Suivi(e)' : 'Suivre'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.publicationAudioLine}>
                <Ionicons
                  name={viewerTypes[mediaIndex] === 'video' ? 'musical-note' : viewerTypes[mediaIndex] === 'embed' ? 'code-slash-outline' : 'images-outline'}
                  size={13}
                  color="#fff"
                />
                <Text style={styles.publicationAudioText} numberOfLines={1}>
                  {viewerTypes[mediaIndex] === 'video' ? 'Audio original • Lolitas of the World' : viewerTypes[mediaIndex] === 'embed' ? 'Publication embed • Lolitas of the World' : 'Publication photo • Lolitas of the World'}
                </Text>
              </View>

              <HashtagCaption
                text={caption}
                onHashtagPress={onOpenHashtag}
                style={styles.publicationCaption}
                numberOfLines={1}
              />
              <Text style={styles.publicationMore}>Voir plus</Text>
            </View>

            <View
              style={[
                styles.publicationSideActions,
                { bottom: Math.max(insets.bottom, 28) + 76 },
              ]}
            >
              <ReelAction
                icon={liked ? 'heart' : 'heart-outline'}
                color={liked ? COLORS.red : '#fff'}
                label={String(baseLikes + (liked ? 1 : 0))}
                onPress={() => setLiked(!liked)}
              />

              <ReelAction
                icon="chatbubble-outline"
                label={String(commentCount)}
                onPress={() => setComments(true)}
              />

              <ReelAction
                icon="repeat-outline"
                color={reposted ? '#fff' : '#fff'}
                label={reposted ? '1' : '0'}
                onPress={() => setReposted(!reposted)}
              />

              <ReelAction
                icon="paper-plane-outline"
                label=""
                onPress={() => Share.share({
                  message: `Regarde cette publication Lolitas of the World de ${owner.handle || '@lolitasoftheworld'} — ${caption}`
                })}
              />

              <ReelAction
                icon={saved ? 'bookmark' : 'bookmark-outline'}
                color="#fff"
                label=""
                onPress={() => setSaved(!saved)}
              />

              <ReelAction icon="ellipsis-horizontal" onPress={() => setMenu(true)} />

              <Image
                source={{ uri: owner.avatar || profile?.avatar || ME.avatar }}
                style={styles.publicationMiniCover}
              />
            </View>

            <View
              style={[
                styles.publicationQuickComment,
                { bottom: Math.max(insets.bottom, 28) + 8 },
              ]}
            >
              <TextInput
                value={commentDraft}
                onChangeText={setCommentDraft}
                placeholder="Ajoutez un commentaire..."
                placeholderTextColor="rgba(255,255,255,.78)"
                style={styles.publicationQuickCommentInput}
                returnKeyType="send"
                onSubmitEditing={() => {
                  const value = commentDraft.trim();
                  if (!value) return;
                  setLocalComments((x) => [
                    ...x,
                    { id: String(Date.now()), name: ME.name, text: value },
                  ]);
                  setCommentDraft('');
                }}
              />
            </View>

            <CommentsModal
              post={fakePost}
              visible={comments}
              onClose={() => setComments(false)}
              onAdd={(id, value) => setLocalComments((x) => [...x, { id: String(Date.now()), name: ME.name, text: value }])}
            />

            <Modal visible={menu} transparent animationType="slide" onRequestClose={() => setMenu(false)}>
              <Pressable style={styles.modalBackdropBottom} onPress={() => setMenu(false)}>
                <Pressable style={styles.actionSheet} onPress={(e) => e.stopPropagation?.()}>
                  <View style={styles.sheetHandle} />
                  <SheetAction
                    icon="share-social-outline"
                    label="Partager"
                    onPress={() => {
                      setMenu(false);
                      Share.share({ message: `Publication Lolitas of the World de ${owner.handle || '@lolitasoftheworld'}` });
                    }}
                  />
                  <SheetAction
                    icon={saved ? 'bookmark' : 'bookmark-outline'}
                    label={saved ? 'Retirer des éléments enregistrés' : 'Enregistrer'}
                    onPress={() => {
                      setSaved(!saved);
                      setMenu(false);
                    }}
                  />
                  <SheetAction
                    icon="flag-outline"
                    label="Signaler"
                    danger
                    onPress={() => {
                      setMenu(false);
                      Alert.alert('Signalement envoyé', 'Merci.');
                    }}
                  />
                </Pressable>
              </Pressable>
            </Modal>
        </View>
      </View>
    </View>
  );
}

function SheetMenu({ visible, post, onClose, onHide, onDelete }) {
  const [qr, setQr] = useState(false);
  const copyLink = async () => { await Clipboard.setStringAsync('https://lolitasoftheworld.app/post/' + (post?.id || '')); Alert.alert('Lien copié','Le lien Kidflix a été copié.'); };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdropBottom} onPress={onClose}>
        <Pressable style={styles.actionSheet} onPress={(e)=>e.stopPropagation?.()}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetQuickRow}>
            <QuickAction icon="bookmark-outline" label="Enregistrer" onPress={()=>Alert.alert('Enregistré','Publication ajoutée aux éléments enregistrés.')} />
            <QuickAction icon="qr-code-outline" label="QR code" onPress={()=>setQr(true)} />
            <QuickAction icon="link-outline" label="Lien" onPress={copyLink} />
          </View>
          <SheetAction icon="star-outline" label="Ajouter aux favoris" onPress={()=>Alert.alert('Favoris','Publication ajoutée aux favoris.')} />
          <SheetAction icon="person-remove-outline" label="Ne plus suivre" onPress={()=>Alert.alert('Abonnement','Tu ne suis plus ce compte dans cette démo.')} />
          <SheetAction icon="eye-off-outline" label="Masquer" onPress={() => { onHide(post?.id); onClose(); }} />
          <SheetAction icon="information-circle-outline" label="Pourquoi cette publication ?" onPress={()=>Alert.alert('Pourquoi cette publication ?','Lolitas of the World te la propose à partir de tes interactions locales et de la récence du contenu.')} />
          {post?.owner?.id === 'me' && <SheetAction icon="trash-outline" label="Supprimer" danger onPress={() => { onDelete(post.id); onClose(); }} />}
          <SheetAction icon="flag-outline" label="Signaler" danger onPress={()=>{onClose();Alert.alert('Signalement envoyé','Merci pour ton signalement.')}} />
        </Pressable>
      </Pressable>
      <Modal visible={qr} transparent animationType="fade" onRequestClose={()=>setQr(false)}><Pressable style={styles.centerModalBackdrop} onPress={()=>setQr(false)}><Pressable style={styles.qrCard} onPress={(e)=>e.stopPropagation?.()}><Text style={styles.dialogTitle}>QR Lolitas of the World</Text><View style={styles.qrGrid}>{Array.from({length:81}).map((_,i)=><View key={i} style={[styles.qrCell,{backgroundColor:((i*7+i%5)%3===0||i%11===0)?'#000':'#fff'}]}/>)}</View><Text style={styles.qrCaption}>Publication {post?.id}</Text><TouchableOpacity style={styles.dialogPrimary} onPress={()=>setQr(false)}><Text style={styles.dialogPrimaryText}>Fermer</Text></TouchableOpacity></Pressable></Pressable></Modal>
    </Modal>
  );
}

function QuickAction({ icon, label, onPress }) { return <TouchableOpacity style={styles.quickAction} onPress={onPress}><View style={styles.quickCircle}><Ionicons name={icon} size={24} color="#fff" /></View><Text style={styles.quickLabel}>{label}</Text></TouchableOpacity>; }
function SheetAction({ icon, label, danger, onPress }) { return <TouchableOpacity style={styles.sheetAction} onPress={onPress}><Ionicons name={icon} size={23} color={danger ? COLORS.red : '#fff'} /><Text style={[styles.sheetActionText, danger && { color: COLORS.red }]}>{label}</Text></TouchableOpacity>; }

function ShareSheet({ visible, post, onClose }) {
  const [q, setQ] = useState('');
  const users = USERS.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
  const text = `Publication Lolitas of the World${post?.owner?.handle ? ` de ${post.owner.handle}` : ''}${post?.caption ? ` — ${post.caption}` : ''}`;
  const copy = async()=>{await Clipboard.setStringAsync(text);Alert.alert('Copié','Le contenu a été copié.');};
  const external = async(label)=>{await Share.share({message:`${text}\nPartagé via ${label}`});};
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdropBottom} onPress={onClose}><Pressable style={styles.shareSheet} onPress={(e)=>e.stopPropagation?.()}><View style={styles.sheetHandle} /><View style={styles.searchBar}><Ionicons name="search" size={18} color={COLORS.muted} /><TextInput value={q} onChangeText={setQ} placeholder="Rechercher" placeholderTextColor={COLORS.muted} style={styles.searchInput} /></View><View style={styles.shareGrid}>{users.map((u) => <TouchableOpacity key={u.id} style={styles.sharePerson} onPress={() => { Alert.alert('Envoyé', `Publication envoyée à ${u.name}`); onClose(); }}><Avatar uri={u.avatar} size={58} /><Text style={styles.sharePersonName}>{u.name}</Text></TouchableOpacity>)}</View><View style={styles.shareExternalRow}><QuickAction icon="link-outline" label="Copier" onPress={copy} /><QuickAction icon="logo-whatsapp" label="WhatsApp" onPress={()=>external('WhatsApp')} /><QuickAction icon="chatbubble-outline" label="SMS" onPress={()=>external('SMS')} /><QuickAction icon="ellipsis-horizontal" label="Plus" onPress={()=>external('Plus')} /></View></Pressable></Pressable>
    </Modal>
  );
}

function NotificationsModal({ visible, onClose }) {
  const data = [
    ['heart', COLORS.red, 'Lina a aimé votre publication', '2 min'],
    ['person-add', COLORS.blue, 'Maya a commencé à vous suivre', '18 min'],
    ['chatbubble', COLORS.cyan, 'Noa a commenté : Magnifique 🔥', '1 h'],
    ['at', COLORS.pink, 'Eden vous a mentionné dans une story', '3 h'],
  ];
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screenRoot}><View style={styles.simpleHeader}><TouchableOpacity onPress={onClose} style={styles.iconHit}><Ionicons name="chevron-back" size={30} color="#fff" /></TouchableOpacity><Text style={styles.simpleHeaderTitle}>Notifications</Text><TouchableOpacity style={styles.iconHit} onPress={()=>Alert.alert('Notifications','Toutes les notifications sont considérées comme lues.')}><Ionicons name="checkmark-done" size={24} color="#fff"/></TouchableOpacity></View><ScrollView>{data.map((x, i) => <TouchableOpacity key={i} style={styles.notificationRow} onPress={()=>Alert.alert('Notification',x[2])}><View style={[styles.notificationIcon, { backgroundColor: `${x[1]}22` }]}><Ionicons name={x[0]} size={21} color={x[1]} /></View><Text style={styles.notificationText}>{x[2]}</Text><Text style={styles.notificationTime}>{x[3]}</Text></TouchableOpacity>)}</ScrollView></SafeAreaView>
    </Modal>
  );
}

function EditProfileModal({ visible, profile, onClose, onSave }) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile, visible]);
  const pick = async (key) => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: .85 });
    if (!r.canceled && r.assets?.[0]?.uri) setDraft((d) => ({ ...d, [key]: r.assets[0].uri }));
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screenRoot}><View style={styles.simpleHeader}><TouchableOpacity onPress={onClose}><Text style={styles.cancelText}>Annuler</Text></TouchableOpacity><Text style={styles.simpleHeaderTitle}>Modifier le profil</Text><TouchableOpacity onPress={() => { onSave(draft); onClose(); }}><Text style={styles.doneText}>Terminé</Text></TouchableOpacity></View><ScrollView contentContainerStyle={{ padding: 18 }}><View style={styles.editAvatarSection}><Avatar uri={draft.avatar} size={94} /><TouchableOpacity onPress={() => pick('avatar')}><Text style={styles.changePhoto}>Modifier la photo ou l’avatar</Text></TouchableOpacity></View><TouchableOpacity onPress={() => pick('banner')} style={styles.editBanner}><Image source={{ uri: draft.banner }} style={StyleSheet.absoluteFillObject} /><View style={styles.editBannerOverlay}><Ionicons name="image-outline" size={24} color="#fff" /><Text style={styles.editBannerText}>Changer la bannière</Text></View></TouchableOpacity><EditField label="Nom" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} /><EditField label="Nom d’utilisateur" value={draft.handle} onChange={(v) => setDraft((d) => ({ ...d, handle: v }))} /><EditField label="Bio" value={draft.bio} onChange={(v) => setDraft((d) => ({ ...d, bio: v }))} multiline /><EditField label="Lien" value={draft.link} onChange={(v) => setDraft((d) => ({ ...d, link: v }))} /></ScrollView></SafeAreaView>
    </Modal>
  );
}

function EditField({ label, value, onChange, multiline }) { return <View style={styles.editField}><Text style={styles.editLabel}>{label}</Text><TextInput value={value} onChangeText={onChange} style={[styles.editInput, multiline && { minHeight: 72, textAlignVertical: 'top' }]} multiline={multiline} placeholderTextColor={COLORS.muted} /></View>; }

function formatGalleryDuration(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function GalleryMediaTile({ asset, selectedOrder, onPress }) {
  const isVideo = asset?.mediaType === 'video';
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={styles.galleryTile}
      onPress={() => onPress(asset)}
    >
      {isVideo ? (
        <VideoMedia
          uri={asset.uri}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          autoplay={false}
          muted
          controls={false}
        />
      ) : (
        <Image
          source={{ uri: asset.uri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      )}

      {isVideo && (
        <View style={styles.galleryVideoMeta}>
          <Ionicons name="videocam" size={13} color="#fff" />
          <Text style={styles.galleryVideoDuration}>
            {formatGalleryDuration(asset.duration)}
          </Text>
        </View>
      )}

      {!!selectedOrder && (
        <View style={styles.gallerySelectedBadge}>
          <Text style={styles.gallerySelectedBadgeText}>{selectedOrder}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function CreateModal({ visible, onClose, onPublish, isGuest = false }) {
  const [step, setStep] = useState('choose');
  const [uri, setUri] = useState('');
  const [selectedMedia, setSelectedMedia] = useState([]);
  const [selectedMediaTypes, setSelectedMediaTypes] = useState([]);
  const [caption, setCaption] = useState('');
  const [kind, setKind] = useState('post');
  const [mediaType, setMediaType] = useState('image');
  const [setting, setSetting] = useState(null);
  const [tagged, setTagged] = useState({});
  const [location, setLocation] = useState('');
  const [music, setMusic] = useState('Audio original');
  const [advanced, setAdvanced] = useState({ comments:true, likes:true, remix:true });
  const [liveOpen, setLiveOpen] = useState(false);

  const [galleryAssets, setGalleryAssets] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [previewAsset, setPreviewAsset] = useState(null);
  const [externalMode, setExternalMode] = useState('embed');
  const [externalCode, setExternalCode] = useState('');
  const [removedExternalMedia, setRemovedExternalMedia] = useState([]);

  const parsedExternalMedia = useMemo(
    () => parseExternalPublicationCode(externalCode, externalMode),
    [externalCode, externalMode]
  );

  const visibleExternalMedia = useMemo(
    () =>
      parsedExternalMedia.filter(
        (media) => !removedExternalMedia.includes(media.uri)
      ),
    [parsedExternalMedia, removedExternalMedia]
  );

  useEffect(() => {
    if (!visible) {
      setStep('choose');
      setUri('');
      setSelectedMedia([]);
      setSelectedMediaTypes([]);
      setCaption('');
      setKind('post');
      setMediaType('image');
      setSetting(null);
      setTagged({});
      setLocation('');
      setMusic('Audio original');
      setGalleryAssets([]);
      setSelectedAssets([]);
      setPreviewAsset(null);
      setMultiSelect(false);
      setGalleryError('');
      setExternalMode('embed');
      setExternalCode('');
      setRemovedExternalMedia([]);
    }
  }, [visible]);

  const loadPhoneGallery = async () => {
    setGalleryLoading(true);
    setGalleryError('');

    try {
      let permission;
      try {
        permission = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
      } catch (e) {
        permission = await MediaLibrary.requestPermissionsAsync();
      }

      if (!permission?.granted && permission?.accessPrivileges !== 'limited') {
        setGalleryError("Autorise Lolitas of the World à accéder à tes photos et vidéos.");
        setGalleryAssets([]);
        return;
      }

      const page = await MediaLibrary.getAssetsAsync({
        first: 120,
        mediaType: ['photo', 'video'],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });

      const assets = page?.assets || [];
      setGalleryAssets(assets);

      if (assets.length) {
        setPreviewAsset((current) => current || assets[0]);
        setSelectedAssets((current) => current.length ? current : [assets[0]]);
      } else {
        setGalleryError("Aucun média trouvé dans la galerie.");
      }
    } catch (e) {
      console.warn('Galerie Lolitas of the World:', e);
      setGalleryError("Impossible de charger la galerie sur cet appareil.");
    } finally {
      setGalleryLoading(false);
    }
  };

  const openPublicationGallery = async () => {
    setKind('post');
    setStep('gallery');
    setSelectedAssets([]);
    setPreviewAsset(null);
    setMultiSelect(false);
    await loadPhoneGallery();
  };

  const openPublicationForCurrentUser = () => {
    if (!isGuest) {
      openPublicationGallery();
      return;
    }

    Alert.alert(
      'Conseil pour les visiteurs',
      "En mode visiteur, une photo ou vidéo choisie directement sur ton téléphone peut ne plus être disponible après un rechargement ou une nouvelle session. Pour garder un média hébergé en ligne et réutilisable, Lolitas of the World recommande plutôt une publication iframe / embed ou BBCode avec une URL publique. Tu peux quand même continuer avec ta galerie.",
      [
        {
          text: 'Galerie',
          onPress: openPublicationGallery,
        },
        {
          text: 'Iframe / embed',
          onPress: () => openExternalPublication('embed'),
        },
        {
          text: 'BBCode',
          onPress: () => openExternalPublication('bbcode'),
        },
      ],
      { cancelable: true }
    );
  };

  const fallbackSystemPicker = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: .9,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      orderedSelection: true,
    });

    if (!r.canceled && r.assets?.length) {
      const assets = r.assets.slice(0, 10);
      const uris = assets.map((asset) => asset.uri).filter(Boolean);
      const types = assets.map((asset) =>
        asset.type === 'video' || asset.mimeType?.startsWith?.('video/')
          ? 'video'
          : mediaTypeFromUri(asset.uri)
      );

      setSelectedMedia(uris);
      setSelectedMediaTypes(types);
      setUri(uris[0] || '');
      setMediaType(types[0] || 'image');
      setKind('post');
      setStep('edit');
    }
  };

  const pickStory = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: .9,
      allowsMultipleSelection: false,
    });

    if (!r.canceled && r.assets?.length) {
      const asset = r.assets[0];
      const type =
        asset.type === 'video' || asset.mimeType?.startsWith?.('video/')
          ? 'video'
          : mediaTypeFromUri(asset.uri);

      setUri(asset.uri);
      setMediaType(type);
      setSelectedMedia([asset.uri]);
      setSelectedMediaTypes([type]);
      setKind('story');
      setStep('compose');
    }
  };

  const selectGalleryAsset = (asset) => {
    if (!asset) return;
    setPreviewAsset(asset);

    if (!multiSelect) {
      setSelectedAssets([asset]);
      return;
    }

    setSelectedAssets((current) => {
      const exists = current.some((x) => x.id === asset.id);

      if (exists) {
        const next = current.filter((x) => x.id !== asset.id);
        return next.length ? next : [asset];
      }

      if (current.length >= 10) {
        Alert.alert('Maximum 10 médias', 'Tu peux publier jusqu’à 10 photos ou vidéos à la fois.');
        return current;
      }

      return [...current, asset];
    });
  };

  const openExternalPublication = (mode) => {
    setKind('post');
    setExternalMode(mode);
    setExternalCode('');
    setRemovedExternalMedia([]);
    setStep('external-code');
  };

  const publishExternalPublication = () => {
    if (!visibleExternalMedia.length) {
      Alert.alert(
        'Aucun média sélectionné',
        externalMode === 'bbcode'
          ? 'Colle du BBCode contenant [img], [video], [media] ou garde au moins un média.'
          : 'Colle un iframe/embed, une balise image/vidéo ou garde au moins un média.'
      );
      return;
    }

    const media = visibleExternalMedia.map((x) => x.uri);
    const mediaTypes = visibleExternalMedia.map((x) => x.type);

    onPublish(
      media,
      '',
      'post',
      {
        sourceFormat: externalMode,
        rawCode: externalCode,
        tagged: [],
        location: '',
        music: 'Audio original',
        advanced,
        mediaType: mediaTypes[0] || 'embed',
        mediaTypes,
      }
    );

    onClose();
  };

  const publishSelectedFromGallery = () => {
    const assets = selectedAssets.length
      ? selectedAssets
      : previewAsset
        ? [previewAsset]
        : [];

    if (!assets.length) {
      Alert.alert('Sélectionne un média', 'Choisis au moins une photo ou une vidéo.');
      return;
    }

    const uris = assets.map((asset) => asset.uri).filter(Boolean);
    const types = assets.map((asset) =>
      asset.mediaType === 'video' ? 'video' : 'image'
    );

    onPublish(
      uris,
      '',
      'post',
      {
        tagged: [],
        location: '',
        music: 'Audio original',
        advanced,
        mediaType: types[0] || 'image',
        mediaTypes: types,
      }
    );

    onClose();
  };

  const publishNow = () => {
    const mediaToPublish = selectedMedia.length
      ? selectedMedia
      : [uri].filter(Boolean);

    const mediaTypesToPublish = selectedMediaTypes.length
      ? selectedMediaTypes
      : [mediaType];

    onPublish(
      mediaToPublish,
      caption,
      kind,
      {
        tagged:Object.keys(tagged).filter(k=>tagged[k]),
        location,
        music,
        advanced,
        mediaType:mediaTypesToPublish[0],
        mediaTypes:mediaTypesToPublish,
      }
    );

    onClose();
  };

  const headerBack = () => {
    if (step === 'choose') return onClose();
    if (step === 'gallery') return setStep('choose');
    if (step === 'external-code') return setStep('choose');
    if (step === 'compose' && kind === 'story') return setStep('choose');
    setStep('choose');
  };

  const headerTitle =
    step === 'gallery' ? 'Nouvelle publication'
    : step === 'external-code'
      ? (externalMode === 'bbcode' ? 'Publication BBCode' : 'Publication iframe / embed')
      : step === 'compose' && kind === 'story' ? 'Story'
      : 'Créer';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={headerBack}>
      <SafeAreaView style={styles.screenRoot}>
        <View style={styles.simpleHeader}>
          <TouchableOpacity onPress={headerBack} style={styles.iconHit}>
            <Ionicons
              name={step === 'choose' ? 'close' : 'chevron-back'}
              size={29}
              color="#fff"
            />
          </TouchableOpacity>

          <Text style={styles.simpleHeaderTitle}>{headerTitle}</Text>
          <View style={{ width: 40 }} />
        </View>

        {step === 'choose' && (
          <View style={styles.createOptions}>
            <CreateOption
              icon="images-outline"
              title="Publication"
              sub="Photo ou vidéo dans le fil"
              onPress={openPublicationForCurrentUser}
            />

            <CreateOption
              icon="code-slash-outline"
              title="Publication iframe / embed"
              sub="Colle un embed, iframe ou une URL"
              onPress={() => openExternalPublication('embed')}
            />

            <CreateOption
              icon="code-working-outline"
              title="Publication BBCode"
              sub="Colle du BBCode image ou vidéo"
              onPress={() => openExternalPublication('bbcode')}
            />

            <CreateOption
              icon="add-circle-outline"
              title="Story"
              sub="Visible pendant 24 h"
              onPress={pickStory}
            />
            <CreateOption
              icon="radio-outline"
              title="Live"
              sub="Diffusion en direct"
              onPress={() => setLiveOpen(true)}
            />
          </View>
        )}

        {step === 'external-code' && (
          <KeyboardAvoidingView
            style={styles.externalPublishScreen}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              contentContainerStyle={styles.externalPublishContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.externalPublishHelp}>
                {externalMode === 'bbcode'
                  ? 'Colle un ou plusieurs codes [img], [video], [media] ou des URL publiques.'
                  : 'Colle un ou plusieurs <iframe>, <embed>, <img>, <video> ou des URL publiques.'}
              </Text>

              <TextInput
                value={externalCode}
                onChangeText={(value) => {
                  setExternalCode(value);
                  const stillPresent = parseExternalPublicationCode(value, externalMode).map(
                    (media) => media.uri
                  );
                  setRemovedExternalMedia((current) =>
                    current.filter((uri) => stillPresent.includes(uri))
                  );
                }}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={
                  externalMode === 'bbcode'
                    ? '[img]https://.../photo.jpg[/img]\\n[video]https://.../video.mp4[/video]'
                    : '<iframe src="https://..."></iframe>\\n<img src="https://.../photo.jpg">'
                }
                placeholderTextColor="#64646d"
                style={styles.externalCodeInput}
              />

              <View style={styles.externalDetectedHeader}>
                <Text style={styles.externalDetectedTitle}>
                  Médias détectés
                </Text>
                <Text style={styles.externalDetectedCount}>
                  {visibleExternalMedia.length}/10
                </Text>
              </View>

              {!!visibleExternalMedia.length && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.externalPreviewRow}
                >
                  {visibleExternalMedia.map((media, index) => (
                    <View key={`${media.uri}-${index}`} style={styles.externalPreviewTile}>
                      {media.type === 'video' ? (
                        <VideoMedia
                          uri={media.uri}
                          style={StyleSheet.absoluteFillObject}
                          contentFit="cover"
                          autoplay={false}
                          muted
                          controls={false}
                        />
                      ) : media.type === 'embed' ? (
                        <EmbeddedMedia
                          uri={media.uri}
                          style={StyleSheet.absoluteFillObject}
                          interactive={false}
                        />
                      ) : (
                        <Image
                          source={{ uri: media.uri }}
                          style={StyleSheet.absoluteFillObject}
                          resizeMode="cover"
                        />
                      )}

                      <View style={styles.externalTypeBadge}>
                        <Ionicons
                          name={
                            media.type === 'video'
                              ? 'videocam'
                              : media.type === 'embed'
                                ? 'code-slash'
                                : 'image'
                          }
                          size={13}
                          color="#fff"
                        />
                      </View>

                      <TouchableOpacity
                        style={styles.externalRemoveButton}
                        activeOpacity={0.8}
                        onPress={() =>
                          setRemovedExternalMedia((current) => [
                            ...new Set([...current, media.uri]),
                          ])
                        }
                      >
                        <Ionicons name="close" size={17} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}

              <Text style={styles.externalPublishNote}>
                Les URL directes d’images et vidéos utilisent le même affichage que les publications Lolitas of the World. Les iframes génériques sont affichées dans un lecteur web intégré. Appuie sur × pour retirer une vignette générée automatiquement avant de publier.
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.publishButton,
                !visibleExternalMedia.length && { opacity: 0.45 },
              ]}
              disabled={!visibleExternalMedia.length}
              onPress={publishExternalPublication}
            >
              <Text style={styles.publishText}>Publier</Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        )}

        {step === 'gallery' && (
          <View style={styles.galleryScreen}>
            <View style={styles.galleryPreview}>
              {previewAsset ? (
                previewAsset.mediaType === 'video' ? (
                  <VideoMedia
                    uri={previewAsset.uri}
                    style={StyleSheet.absoluteFillObject}
                    contentFit="contain"
                    autoplay
                    muted
                    controls={false}
                  />
                ) : (
                  <Image
                    source={{ uri: previewAsset.uri }}
                    style={StyleSheet.absoluteFillObject}
                    resizeMode="contain"
                  />
                )
              ) : (
                <View style={styles.galleryEmptyPreview}>
                  {galleryLoading ? (
                    <ActivityIndicator size="large" color="#fff" />
                  ) : (
                    <Ionicons name="images-outline" size={54} color="#555" />
                  )}
                </View>
              )}
            </View>

            <View style={styles.galleryToolbar}>
              <TouchableOpacity style={styles.galleryRecent}>
                <Text style={styles.galleryRecentText}>Récent</Text>
                <Ionicons name="chevron-down" size={16} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.galleryMultiButton, multiSelect && styles.galleryMultiButtonActive]}
                onPress={() => {
                  setMultiSelect((v) => !v);
                  if (multiSelect && selectedAssets.length > 1) {
                    setSelectedAssets(selectedAssets.slice(0, 1));
                  }
                }}
              >
                <Ionicons
                  name={multiSelect ? 'checkmark-circle' : 'copy-outline'}
                  size={17}
                  color="#fff"
                />
                <Text style={styles.galleryMultiText}>Sélectionner</Text>
              </TouchableOpacity>
            </View>

            {galleryError ? (
              <View style={styles.galleryPermissionBox}>
                <Text style={styles.galleryPermissionText}>{galleryError}</Text>

                <TouchableOpacity
                  style={styles.galleryRetryButton}
                  onPress={loadPhoneGallery}
                >
                  <Text style={styles.galleryRetryText}>Réessayer</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.gallerySystemButton}
                  onPress={fallbackSystemPicker}
                >
                  <Text style={styles.gallerySystemText}>Ouvrir la galerie système</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={galleryAssets}
                numColumns={3}
                keyExtractor={(asset) => asset.id}
                renderItem={({ item }) => {
                  const order = selectedAssets.findIndex((x) => x.id === item.id);
                  return (
                    <GalleryMediaTile
                      asset={item}
                      selectedOrder={order >= 0 ? order + 1 : 0}
                      onPress={selectGalleryAsset}
                    />
                  );
                }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.galleryGridContent}
              />
            )}

            <TouchableOpacity
              style={[
                styles.galleryNextButton,
                !selectedAssets.length && styles.galleryNextButtonDisabled,
              ]}
              disabled={!selectedAssets.length}
              onPress={publishSelectedFromGallery}
            >
              <Text style={styles.galleryNextText}>Suivant</Text>
            </TouchableOpacity>
          </View>
        )}


        {step === 'compose' && (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <CreateMediaPreviewCarousel
                media={selectedMedia.length ? selectedMedia : [uri].filter(Boolean)}
                mediaTypes={selectedMediaTypes.length ? selectedMediaTypes : [mediaType]}
              />

              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Écrire une légende…"
                placeholderTextColor={COLORS.muted}
                style={styles.captionInput}
                multiline
              />

              <CreateSetting
                icon="location-outline"
                label="Ajouter un lieu"
                value={location}
                onPress={()=>setSetting('location')}
              />

              <CreateSetting
                icon="musical-notes-outline"
                label="Ajouter de la musique"
                value={music !== 'Audio original' ? music : ''}
                onPress={()=>setSetting('music')}
              />
            </ScrollView>

            <TouchableOpacity style={styles.publishButton} onPress={publishNow}>
              <Text style={styles.publishText}>
                {kind === 'story' ? 'Ajouter à la story' : 'Partager'}
              </Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>

      <Modal
        visible={!!setting}
        animationType="slide"
        onRequestClose={()=>setSetting(null)}
      >
        <SafeAreaView style={styles.screenRoot}>
          <View style={styles.simpleHeader}>
            <TouchableOpacity
              onPress={()=>setSetting(null)}
              style={styles.iconHit}
            >
              <Ionicons name="chevron-back" size={30} color="#fff"/>
            </TouchableOpacity>

            <Text style={styles.simpleHeaderTitle}>
              {setting==='tag'
                ? 'Identifier des personnes'
                : setting==='location'
                  ? 'Ajouter un lieu'
                  : setting==='music'
                    ? 'Ajouter de la musique'
                    : 'Paramètres avancés'}
            </Text>

            <TouchableOpacity onPress={()=>setSetting(null)}>
              <Text style={styles.doneText}>Terminé</Text>
            </TouchableOpacity>
          </View>

          {setting==='tag' && (
            <FlatList
              data={USERS}
              keyExtractor={(x)=>x.id}
              renderItem={({item})=>(
                <TouchableOpacity
                  style={styles.peopleRow}
                  onPress={()=>setTagged((m)=>({...m,[item.id]:!m[item.id]}))}
                >
                  <Avatar uri={item.avatar} size={46}/>
                  <View style={{flex:1,marginLeft:10}}>
                    <Text style={styles.chatName}>{item.name}</Text>
                    <Text style={styles.chatPreview}>{item.handle}</Text>
                  </View>
                  <Ionicons
                    name={tagged[item.id]?'checkmark-circle':'ellipse-outline'}
                    size={25}
                    color={tagged[item.id]?COLORS.blue:'#777'}
                  />
                </TouchableOpacity>
              )}
            />
          )}

          {setting==='location' && (
            <View style={{padding:18}}>
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder="Rechercher ou saisir un lieu"
                placeholderTextColor={COLORS.muted}
                style={styles.authInput}
              />
              {['Marseille, France','Paris, France','Nice, France','Lyon, France'].map(x=>(
                <TouchableOpacity
                  key={x}
                  style={styles.sheetAction}
                  onPress={()=>{setLocation(x);setSetting(null)}}
                >
                  <Ionicons name="location-outline" size={23} color="#fff"/>
                  <Text style={styles.sheetActionText}>{x}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {setting==='music' && (
            <View style={{padding:16}}>
              {['Audio original','Midnight Drive','Summer Motion','City Lights','Soft Piano'].map(x=>(
                <TouchableOpacity
                  key={x}
                  style={styles.sheetAction}
                  onPress={()=>{setMusic(x);setSetting(null)}}
                >
                  <Ionicons
                    name="musical-note"
                    size={23}
                    color={music===x?COLORS.pink:'#fff'}
                  />
                  <Text style={styles.sheetActionText}>{x}</Text>
                  {music===x&&(
                    <Ionicons name="checkmark" size={20} color={COLORS.pink}/>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {setting==='advanced' && (
            <View style={{padding:16}}>
              <ToggleRow
                label="Autoriser les commentaires"
                value={advanced.comments}
                onValueChange={(v)=>setAdvanced(a=>({...a,comments:v}))}
              />
              <ToggleRow
                label="Afficher le nombre de J’aime"
                value={advanced.likes}
                onValueChange={(v)=>setAdvanced(a=>({...a,likes:v}))}
              />
              <ToggleRow
                label="Autoriser les remix"
                value={advanced.remix}
                onValueChange={(v)=>setAdvanced(a=>({...a,remix:v}))}
              />
            </View>
          )}
        </SafeAreaView>
      </Modal>

      <LiveModal visible={liveOpen} onClose={()=>setLiveOpen(false)} />
    </Modal>
  );
}


function CreateOption({ icon, title, sub, onPress }) { return <TouchableOpacity style={styles.createOption} onPress={onPress}><View style={styles.createOptionIcon}><Ionicons name={icon} size={27} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.createOptionTitle}>{title}</Text><Text style={styles.createOptionSub}>{sub}</Text></View><Ionicons name="chevron-forward" size={22} color="#777" /></TouchableOpacity>; }
function CreateSetting({ icon, label, value, onPress }) { return <TouchableOpacity style={styles.createSetting} onPress={onPress}><Ionicons name={icon} size={23} color="#fff" /><Text style={styles.createSettingText}>{label}</Text>{!!value&&<Text style={styles.settingValue} numberOfLines={1}>{value}</Text>}<Ionicons name="chevron-forward" size={20} color="#777" /></TouchableOpacity>; }
function ToggleRow({label,value,onValueChange}){return <View style={styles.toggleRow}><Text style={styles.toggleLabel}>{label}</Text><Switch value={value} onValueChange={onValueChange} trackColor={{false:'#3a3a40',true:COLORS.blue}} thumbColor="#fff"/></View>}

function LiveModal({visible,onClose}){
  const [live,setLive]=useState(false); const [mic,setMic]=useState(true); const [cam,setCam]=useState(true); const [flip,setFlip]=useState(false);
  useEffect(()=>{if(!visible){setLive(false);setMic(true);setCam(true)}},[visible]);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><View style={styles.liveScreen}><LinearGradient colors={flip?['#233','#000']:['#32122b','#071a1f','#000']} style={StyleSheet.absoluteFillObject}/><SafeAreaView style={{flex:1}}><View style={styles.liveHeader}><TouchableOpacity onPress={onClose} style={styles.iconHit}><Ionicons name="close" size={30} color="#fff"/></TouchableOpacity><View style={[styles.liveBadge,live&&{backgroundColor:COLORS.red}]}><Text style={styles.liveBadgeText}>{live?'EN DIRECT':'APERÇU'}</Text></View><TouchableOpacity onPress={()=>setFlip(!flip)} style={styles.iconHit}><Ionicons name="camera-reverse-outline" size={28} color="#fff"/></TouchableOpacity></View><View style={styles.liveCenter}><Ionicons name={cam?'videocam':'videocam-off'} size={72} color="#fff"/><Text style={styles.liveTitle}>{live?'Tu es en direct':'Prêt à lancer ton Live ?'}</Text><Text style={styles.liveSub}>{live?'12 spectateurs • démo locale':'L’interface Live est interactive dans Expo Go.'}</Text></View><View style={styles.liveControls}><CallButton icon={mic?'mic':'mic-off'} label="Micro" active={!mic} onPress={()=>setMic(!mic)}/><CallButton icon={cam?'videocam':'videocam-off'} label="Caméra" active={!cam} onPress={()=>setCam(!cam)}/><TouchableOpacity style={[styles.goLiveButton,live&&{backgroundColor:'#333'}]} onPress={()=>setLive(!live)}><Text style={styles.goLiveText}>{live?'Arrêter':'Démarrer le Live'}</Text></TouchableOpacity></View></SafeAreaView></View></Modal>
}

function SettingsModal({ visible, onClose, onLogout, posts }) {
  const [detail,setDetail]=useState(null);
  const [privateAccount,setPrivateAccount]=useState(false);
  const [notif,setNotif]=useState({likes:true,messages:true,follows:true});
  const [theme,setTheme]=useState('Noir OLED');
  const [blocked,setBlocked]=useState([USERS[5]]);
  const savedCount=(posts||[]).filter(p=>p.saved).length;
  const open=(name)=>setDetail(name);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screenRoot}><View style={styles.simpleHeader}><TouchableOpacity onPress={onClose} style={styles.iconHit}><Ionicons name="chevron-back" size={30} color="#fff" /></TouchableOpacity><Text style={styles.simpleHeaderTitle}>Paramètres</Text><View style={{ width: 40 }} /></View><ScrollView contentContainerStyle={{ padding: 16 }}><Text style={styles.settingsSection}>Votre compte</Text><SheetAction icon="person-circle-outline" label="Espace Comptes" onPress={()=>open('accounts')} /><SheetAction icon="bookmark-outline" label={`Enregistré (${savedCount})`} onPress={()=>open('saved')} /><SheetAction icon="archive-outline" label="Archive" onPress={()=>open('archive')} /><SheetAction icon="time-outline" label="Votre activité" onPress={()=>open('activity')} /><Text style={styles.settingsSection}>Qui peut voir votre contenu</Text><SheetAction icon="lock-closed-outline" label="Confidentialité du compte" onPress={()=>open('privacy')} /><SheetAction icon="star-outline" label="Amis proches" onPress={()=>open('closefriends')} /><SheetAction icon="ban-outline" label={`Comptes bloqués (${blocked.length})`} onPress={()=>open('blocked')} /><Text style={styles.settingsSection}>Application</Text><SheetAction icon="notifications-outline" label="Notifications" onPress={()=>open('notifications')} /><SheetAction icon="moon-outline" label={`Thème : ${theme}`} onPress={()=>open('theme')} /><SheetAction icon="information-circle-outline" label="À propos" onPress={()=>open('about')} /><TouchableOpacity style={styles.logoutButton} onPress={onLogout}><Text style={styles.logoutText}>Se déconnecter</Text></TouchableOpacity></ScrollView></SafeAreaView>
      <Modal visible={!!detail} animationType="slide" onRequestClose={()=>setDetail(null)}><SafeAreaView style={styles.screenRoot}><View style={styles.simpleHeader}><TouchableOpacity onPress={()=>setDetail(null)} style={styles.iconHit}><Ionicons name="chevron-back" size={30} color="#fff"/></TouchableOpacity><Text style={styles.simpleHeaderTitle}>{({accounts:'Espace Comptes',saved:'Enregistré',archive:'Archive',activity:'Votre activité',privacy:'Confidentialité',closefriends:'Amis proches',blocked:'Comptes bloqués',notifications:'Notifications',theme:'Thème',about:'À propos'})[detail]||''}</Text><View style={{width:40}}/></View><ScrollView contentContainerStyle={{padding:16}}>
        {detail==='accounts'&&<><View style={styles.accountRow}><Avatar uri={ME.avatar} size={48}/><View style={{flex:1,marginLeft:10}}><Text style={styles.accountName}>{ME.handle}</Text><Text style={styles.accountSub}>Compte Lolitas of the World connecté</Text></View><Ionicons name="checkmark-circle" size={22} color={COLORS.blue}/></View><SheetAction icon="add-circle-outline" label="Ajouter un compte" onPress={()=>Alert.alert('Ajouter un compte','Déconnecte-toi puis utilise l’écran de connexion pour tester un autre compte.')} /></>}
        {detail==='saved'&&<View style={styles.emptyState}><Ionicons name="bookmark" size={46} color={COLORS.cyan}/><Text style={styles.emptyTitle}>{savedCount} publication(s) enregistrée(s)</Text><Text style={styles.emptyText}>Les favoris locaux de cette session apparaissent ici.</Text></View>}
        {detail==='archive'&&<View style={styles.emptyState}><Ionicons name="archive-outline" size={46} color="#888"/><Text style={styles.emptyTitle}>Archive</Text><Text style={styles.emptyText}>Aucun élément archivé pour le moment.</Text></View>}
        {detail==='activity'&&<><InfoRow label="J’aime cette session" value={String((posts||[]).filter(p=>p.liked).length)}/><InfoRow label="Éléments enregistrés" value={String(savedCount)}/><InfoRow label="Publications visibles" value={String((posts||[]).length)}/></>}
        {detail==='privacy'&&<ToggleRow label="Compte privé" value={privateAccount} onValueChange={setPrivateAccount}/>} 
        {detail==='closefriends'&&USERS.map(u=><ToggleUser key={u.id} user={u}/>)}
        {detail==='blocked'&&blocked.map(u=><View key={u.id} style={styles.peopleRow}><Avatar uri={u.avatar} size={46}/><View style={{flex:1,marginLeft:10}}><Text style={styles.chatName}>{u.name}</Text><Text style={styles.chatPreview}>{u.handle}</Text></View><TouchableOpacity style={styles.followButtonSmall} onPress={()=>setBlocked(x=>x.filter(v=>v.id!==u.id))}><Text style={styles.followButtonSmallText}>Débloquer</Text></TouchableOpacity></View>)}
        {detail==='notifications'&&<><ToggleRow label="J’aime et commentaires" value={notif.likes} onValueChange={v=>setNotif(n=>({...n,likes:v}))}/><ToggleRow label="Messages" value={notif.messages} onValueChange={v=>setNotif(n=>({...n,messages:v}))}/><ToggleRow label="Nouveaux followers" value={notif.follows} onValueChange={v=>setNotif(n=>({...n,follows:v}))}/></>}
        {detail==='theme'&&['Noir OLED','Sombre','Système'].map(x=><TouchableOpacity key={x} style={styles.sheetAction} onPress={()=>{setTheme(x);setDetail(null)}}><Ionicons name="moon-outline" size={23} color={theme===x?COLORS.cyan:'#fff'}/><Text style={styles.sheetActionText}>{x}</Text>{theme===x&&<Ionicons name="checkmark" size={20} color={COLORS.cyan}/>}</TouchableOpacity>)}
        {detail==='about'&&<View style={styles.aboutCard}><AppLogo/><Text style={styles.aboutText}>Lolitas of the World Expo Reconstruction\nVersion 2.0 — boutons interactifs\nInterface locale de démonstration.</Text><TouchableOpacity style={styles.dialogPrimary} onPress={()=>Share.share({message:'Lolitas of the World Expo Reconstruction'})}><Text style={styles.dialogPrimaryText}>Partager Lolitas of the World</Text></TouchableOpacity></View>}
      </ScrollView></SafeAreaView></Modal>
    </Modal>
  );
}
function InfoRow({label,value}){return <View style={styles.infoRow}><Text style={styles.toggleLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>}
function ToggleUser({user}){const [v,setV]=useState(false);return <View style={styles.peopleRow}><Avatar uri={user.avatar} size={46}/><View style={{flex:1,marginLeft:10}}><Text style={styles.chatName}>{user.name}</Text><Text style={styles.chatPreview}>{user.handle}</Text></View><Switch value={v} onValueChange={setV} trackColor={{false:'#3a3a40',true:COLORS.blue}} thumbColor="#fff"/></View>}

function KidflixApp() {
  const insets = useSafeAreaInsets();
  const [showSplash, setShowSplash] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [sessionMode, setSessionMode] = useState('member');
  const [route, setRoute] = useState('home');
  const [profile, setProfile] = useState(ME);
  const [posts, setPosts] = useState(INITIAL_POSTS);
  const [followingIds, setFollowingIds] = useState(['u1', 'u5']);
  const [myStoryMedia, setMyStoryMedia] = useState(null);
  const [chats, setChats] = useState(INITIAL_CHATS);
  const [activeChat, setActiveChat] = useState(null);
  const [otherProfile, setOtherProfile] = useState(null);
  const [commentsPost, setCommentsPost] = useState(null);
  const [story, setStory] = useState({ visible: false, index: 0 });
  const [media, setMedia] = useState(null);
  const [menuPost, setMenuPost] = useState(null);
  const [sharePost, setSharePost] = useState(null);
  const [notifications, setNotifications] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [create, setCreate] = useState(false);
  const [settings, setSettings] = useState(false);
  const [selectedHashtag, setSelectedHashtag] = useState(null);
  const [remotePostsLoaded, setRemotePostsLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    const unsubscribe = observeLtwAuth(async (firebaseUser) => {
      if (!mounted) return;

      try {
        if (!firebaseUser) {
          setEntered(false);
          setSessionMode('member');
          return;
        }

        if (firebaseUser.isAnonymous) {
          setSessionMode('guest');
          setEntered(true);
          setRoute('home');
          return;
        }

        const cloudProfile = await loadOrCreateLtwProfile(firebaseUser);
        if (!mounted) return;

        if (cloudProfile) {
          setProfile((current) => ({
            ...current,
            ...cloudProfile,
            id: cloudProfile.id || firebaseUser.uid,
          }));
        }

        setSessionMode('member');
        setEntered(true);
        setRoute('home');
      } catch (error) {
        console.warn('Restauration Firebase impossible :', error?.message || error);
      } finally {
        if (mounted) setAuthReady(true);
      }
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const loadRemotePosts = useCallback(async () => {
    try {
      const separator = REMOTE_POSTS_URL.includes('?') ? '&' : '?';
      const requestUrl = `${REMOTE_POSTS_URL}${separator}t=${Date.now()}`;

      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const remotePosts = normalizeRemotePosts(payload);

      setPosts((current) => mergeRemotePosts(current, remotePosts));
      setRemotePostsLoaded(true);

      return remotePosts;
    } catch (error) {
      console.warn(
        `Impossible de charger ${REMOTE_POSTS_URL} :`,
        error?.message || error
      );

      // Une panne du JSON distant ne bloque jamais l'application.
      setRemotePostsLoaded(true);
      return [];
    }
  }, []);

  useEffect(() => {
    loadRemotePosts();
  }, [loadRemotePosts]);

  if (showSplash) {
    return <LTWSplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (!authReady) {
    return (
      <View style={styles.firebaseBootScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <ActivityIndicator size="large" color={COLORS.pink} />
        <Text style={styles.firebaseBootText}>Connexion sécurisée…</Text>
      </View>
    );
  }

  if (!entered) {
    return (
      <AuthScreen
        onEnter={(mode, cloudProfile) => {
          if (cloudProfile) {
            setProfile((current) => ({
              ...current,
              ...cloudProfile,
            }));
          }

          setSessionMode(mode);
          setEntered(true);
          setRoute('home');
        }}
      />
    );
  }

  const isGuest = sessionMode === 'guest';
  void remotePostsLoaded;
  const currentIdentity = isGuest ? GUEST_USER : profile;

  const requireAccount = (feature) => {
    Alert.alert(
      'Compte requis',
      `${feature === 'messagerie' ? 'La messagerie' : 'Le profil'} est réservé aux utilisateurs qui ont un compte.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Se connecter',
          onPress: () => {
            setActiveChat(null);
            setOtherProfile(null);
            setRoute('home');
            setEntered(false);
          },
        },
      ]
    );
  };

  const navigateRoute = (nextRoute) => {
    setSelectedHashtag(null);

    if (isGuest && nextRoute === 'messages') {
      requireAccount('messagerie');
      return;
    }
    if (isGuest && nextRoute === 'profile') {
      requireAccount('profil');
      return;
    }
    setRoute(nextRoute);
  };

  const toggleLike = (id) => setPosts((arr) => arr.map((p) => p.id === id ? { ...p, liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) } : p));
  const toggleSave = (id) => setPosts((arr) => arr.map((p) => p.id === id ? { ...p, saved: !p.saved } : p));
  const addComment = (id, text) => {
    setPosts((arr) => arr.map((p) => p.id === id ? { ...p, comments: [...p.comments, { id: String(Date.now()), name: currentIdentity.name, text }] } : p));
    setCommentsPost((p) => p ? { ...p, comments: [...p.comments, { id: String(Date.now()), name: currentIdentity.name, text }] } : p);
  };
  const publish = (mediaInput, caption, kind = 'post', meta = {}) => {
    const mediaUris = (Array.isArray(mediaInput) ? mediaInput : [mediaInput]).filter(Boolean);
    if (!mediaUris.length) return;
    const mediaTypes = Array.isArray(meta.mediaTypes) && meta.mediaTypes.length
      ? meta.mediaTypes
      : mediaUris.map((uri, i) => i === 0 && meta.mediaType ? meta.mediaType : mediaTypeFromUri(uri));
    const firstUri = mediaUris[0];
    const firstType = mediaTypes[0] || mediaTypeFromUri(firstUri);

    if (kind === 'story') {
      setMyStoryMedia({ uri: firstUri, type: firstType });
      setStory({ visible: true, index: 0, own: true });
      return;
    }
    setPosts((arr) => [{
      id: `p-${Date.now()}`,
      owner: isGuest ? { ...GUEST_USER } : { ...profile, id: 'me' },
      media: mediaUris,
      mediaTypes,
      caption: caption || 'Nouvelle publication',
      liked: false,
      likes: 0,
      saved: false,
      comments: [],
      time: 'À l’instant',
      createdAt: Date.now(),
      meta,
    }, ...arr]);
    setRoute('home');
  };
  const hidePost = (id) => setPosts((arr) => arr.filter((p) => p.id !== id));
  const deletePost = hidePost;

  const openHashtag = (tag) => {
    const normalized = normalizeHashtag(tag);
    if (!normalized) return;

    setMedia(null);
    setOtherProfile(null);
    setActiveChat(null);
    setSelectedHashtag(normalized);
  };

  const openUser = (u) => {
    if (u.id === 'me' || u.id === 'guest') {
      if (isGuest) {
        requireAccount('profil');
        return;
      }
      setRoute('profile');
      return;
    }
    setOtherProfile(u);
  };

  const toggleFollowing = (userId) => {
    if (isGuest) {
      Alert.alert(
        'Compte requis',
        'Tu dois avoir un compte pour ajouter des abonnements.'
      );
      return;
    }

    setFollowingIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    );
  };

  const openMessageWith = (u) => {
    if (isGuest) {
      requireAccount('messagerie');
      return;
    }

    const existing =
      chats.find((c) => c.user.id === u.id) ||
      { id: `new-${u.id}`, user: u, preview: '', time: '', unread: 0 };

    setOtherProfile(null);
    setActiveChat(existing);
  };

  const common = {
    onToggleLike: toggleLike,
    onToggleSave: toggleSave,
    onComments: (p) => setCommentsPost(p),
    onShare: (p) => setSharePost(p),
    onMenu: (p) => setMenuPost(p),
    onOpenUser: openUser,
    onOpenHashtag: openHashtag,
    onRemoteRefresh: loadRemotePosts,
  };

  let content = null;
  if (selectedHashtag) content = (
    <HashtagScreen
      hashtag={selectedHashtag}
      posts={posts}
      onBack={() => setSelectedHashtag(null)}
      onOpenMedia={setMedia}
      onRemoteRefresh={loadRemotePosts}
    />
  );
  else if (activeChat) content = <ChatScreen chat={activeChat} onBack={() => setActiveChat(null)} />;
  else if (otherProfile) content = (
    <OtherProfileScreen
      user={otherProfile}
      onBack={() => setOtherProfile(null)}
      onMessage={() => openMessageWith(otherProfile)}
      isFollowing={followingIds.includes(otherProfile.id)}
      onToggleFollow={toggleFollowing}
    />
  );
  else if (route === 'home') content = <HomeScreen
    posts={posts}
    followingIds={followingIds}
    {...common}
    onOpenPost={(post, index = 0) => {
      const uri = post.media?.[index];
      const type = post.mediaTypes?.[index] || mediaTypeFromUri(uri);
      setMedia({
        ...post,
        image: uri,
        video: type === 'video' ? uri : undefined,
        type,
        media: post.media || [],
        mediaTypes: post.mediaTypes || [],
        initialIndex: index,
      });
    }}
    onNotifications={() => setNotifications(true)}
    onMessages={() => navigateRoute('messages')}
    onStory={(i) => setStory({ visible: true, index: i, own: false })}
    onCreateStory={() => setCreate(true)}
    ownStory={myStoryMedia}
    ownAvatar={currentIdentity.avatar}
    onOpenOwnStory={() => setStory({ visible: true, index: 0, own: true })}
  />;
  else if (route === 'explore') content = (
    <ExploreScreen
      posts={posts}
      onOpenMedia={setMedia}
      onOpenUser={openUser}
      onOpenHashtag={openHashtag}
      isGuest={isGuest}
      onRemoteRefresh={loadRemotePosts}
    />
  );
  else if (route === 'messages' && !isGuest) content = <MessagesScreen chats={chats} onOpenChat={setActiveChat} onNewMessage={() => Alert.alert('Nouveau message', 'Choisis un profil dans la rangée supérieure.')} />;
  else if (route === 'profile' && !isGuest) content = <ProfileScreen profile={profile} posts={posts} onEdit={() => setEditProfile(true)} onSettings={() => setSettings(true)} onOpenMedia={setMedia} onCreate={() => setCreate(true)} ownStory={myStoryMedia} onOpenOwnStory={() => setStory({ visible: true, index: 0, own: true })} onRemoteRefresh={loadRemotePosts} />;

  const mainEdges = activeChat || otherProfile
    ? ['top', 'left', 'right', 'bottom']
    : ['top', 'left', 'right'];

  const immersiveViewer = !!media;

  return (
    <View style={styles.appRoot}>
      <StatusBar
        hidden={immersiveViewer}
        barStyle="light-content"
        backgroundColor="#000"
        translucent={false}
      />

      <SafeAreaView
        edges={mainEdges}
        style={[styles.safeRoot, media && styles.contentHiddenBehindViewer]}
        pointerEvents={media ? 'none' : 'auto'}
      >
        {content}
      </SafeAreaView>

      {!activeChat && !otherProfile && !media && (
        <BottomNav
          route={route}
          onRoute={navigateRoute}
          onCreate={() => setCreate(true)}
          profile={profile}
          bottomInset={insets.bottom}
          isGuest={isGuest}
          onRestrictedAccess={requireAccount}
        />
      )}

      <CommentsModal post={commentsPost} visible={!!commentsPost} onClose={() => setCommentsPost(null)} onAdd={addComment} />
      <StoryViewer visible={story.visible} index={story.index} own={!!story.own} customMedia={myStoryMedia} onClose={() => setStory({ visible: false, index: 0, own: false })} />
      <MediaViewer
        item={media}
        visible={!!media}
        onClose={() => setMedia(null)}
        profile={profile}
        currentRoute={route}
        onNavigate={navigateRoute}
        onCreate={() => setCreate(true)}
        onOpenHashtag={openHashtag}
      />
      <SheetMenu visible={!!menuPost} post={menuPost} onClose={() => setMenuPost(null)} onHide={hidePost} onDelete={deletePost} />
      <ShareSheet visible={!!sharePost} post={sharePost} onClose={() => setSharePost(null)} />
      <NotificationsModal visible={notifications} onClose={() => setNotifications(false)} />
      <EditProfileModal visible={editProfile} profile={profile} onClose={() => setEditProfile(false)} onSave={setProfile} />
      <CreateModal
        visible={create}
        onClose={() => setCreate(false)}
        onPublish={publish}
        isGuest={isGuest}
      />
      <SettingsModal
        visible={settings}
        posts={posts}
        onClose={() => setSettings(false)}
        onLogout={async () => {
          setSettings(false);

          try {
            await signOutLtw();
            setProfile(ME);
            setSessionMode('member');
            setEntered(false);
            setRoute('home');
          } catch (error) {
            Alert.alert('Déconnexion', firebaseErrorMessage(error));
          }
        }}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <KidflixApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appRoot: { flex: 1, backgroundColor: COLORS.bg, position: 'relative' },

  firebaseBootScreen: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  firebaseBootText: {
    color: '#d8d8de',
    fontSize: 14,
    fontWeight: '700',
  },

  ltwSplashRoot: {
    flex: 1,
    backgroundColor: '#090006',
    overflow: 'hidden',
  },
  ltwSplashImage: {
    width: '100%',
    height: '100%',
  },
  ltwLoadingArea: {
    position: 'absolute',
    left: 44,
    right: 44,
    alignItems: 'center',
    paddingTop: 15,
    paddingBottom: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(10,0,7,.72)',
  },
  ltwProgressTrack: {
    width: '100%',
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,120,200,.96)',
    backgroundColor: 'rgba(45,0,27,.92)',
  },
  ltwProgressFill: {
    height: '100%',
    borderRadius: 10,
    backgroundColor: '#ff4f9f',
    overflow: 'hidden',
  },
  ltwProgressShine: {
    position: 'absolute',
    right: 0,
    top: -7,
    bottom: -7,
    width: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,.88)',
  },
  ltwLoadingTextRow: {
    width: '100%',
    marginTop: 10,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ltwLoadingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  ltwLoadingPercent: {
    color: '#ff9ccc',
    fontSize: 13,
    fontWeight: '900',
  },
  ltwPulseHeart: {
    marginTop: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safeRoot: { flex: 1, backgroundColor: COLORS.bg },
  reelsFullscreenRoot: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 20 },
  screenRoot: { flex: 1, backgroundColor: COLORS.bg },
  contentHiddenBehindViewer: { opacity: 0 },
  logoRow: { flexDirection: 'row', alignItems: 'baseline' },
  logoText: { color: '#fff', fontSize: 30, fontWeight: '1000', letterSpacing: -1.6 },
  activeDot: { position: 'absolute', right: 0, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.green, borderWidth: 2, borderColor: '#000' },
  nameVerifiedRow: { flexDirection: 'row', alignItems: 'center' },

  authRoot: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  authBackgroundVideoWrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  authBackgroundVideo: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ scale: 1.16 }],
  },
  authInner: { flex: 1, justifyContent: 'center', paddingHorizontal: 22, paddingTop: 34, paddingBottom: 34, gap: 46 },
  authGlowPink: { position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(255,46,110,.08)', top: 80, left: -100 },
  authGlowCyan: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(22,217,240,.08)', bottom: 90, right: -110 },
  authBrandWrap: { alignItems: 'center', marginTop: 0 },
  authScriptLogo: {
    width: '100%',
    height: 138,
    marginBottom: -10,
  },
  authSub: { color: 'rgba(230,230,236,.82)', marginTop: 10, fontSize: 14 },
  authCard: { backgroundColor: 'rgba(12,12,15,.32)', borderRadius: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,.10)', padding: 18 },
  authErrorBox: {
    marginTop: 12,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,59,92,.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,135,.28)',
  },
  authErrorText: {
    flex: 1,
    color: '#ff9aad',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  authTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 18 },
  authInput: { height: 52, borderRadius: 15, backgroundColor: 'rgba(23,23,27,.58)', borderWidth: 1, borderColor: 'rgba(255,255,255,.12)', paddingHorizontal: 15, color: '#fff', fontSize: 16, marginBottom: 11 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  eyeBtn: { position: 'absolute', right: 10, width: 40, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { borderRadius: 15, overflow: 'hidden', marginTop: 2 },
  primaryButtonGradient: { height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  authSwitch: { textAlign: 'center', color: '#d8d8dd', marginTop: 16, fontSize: 13.5 },
  authSeparator: { flexDirection: 'row', alignItems: 'center', marginVertical: 17 },
  sepLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,.18)' },
  sepText: { color: '#777780', fontSize: 11, marginHorizontal: 12, fontWeight: '700' },
  guestButton: { height: 48, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,.18)', backgroundColor: 'rgba(8,8,11,.28)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  guestButtonText: { color: '#fff', fontWeight: '700' },

  topHeader: { height: 55, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#202024' },
  topHeaderActions: { flexDirection: 'row', gap: 4 },
  headerIconBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerBadge: { position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.pink },
  headerCount: { position: 'absolute', top: 2, right: 1, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  headerCountText: { color: '#fff', fontSize: 10, fontWeight: '900' },

  storiesWrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1f1f23' },
  storiesContent: { paddingHorizontal: 10, paddingVertical: 11, gap: 12 },
  storyItem: { width: 72, alignItems: 'center' },
  storyAvatarWrap: { position: 'relative', height: 72, justifyContent: 'center' },
  storyAdd: { position: 'absolute', right: -1, bottom: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.blue, borderWidth: 2, borderColor: '#000', alignItems: 'center', justifyContent: 'center' },
  storyName: { color: '#ddd', fontSize: 11.5, marginTop: 5, width: 72, textAlign: 'center' },

  postCard: { backgroundColor: '#000', marginBottom: 10 },
  postHeader: { height: 56, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  postMediaFrame: { position: 'relative' },
  postHeaderOverlay: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    zIndex: 25,
  },
  postUserRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  postUserName: { color: '#fff', fontSize: 13.8, fontWeight: '800' },
  postUserNameOverlay: {
    color: '#fff',
    fontSize: 13.8,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  postSub: { color: '#aaa', fontSize: 10.5, marginTop: 2 },
  postSubOverlay: {
    color: 'rgba(255,255,255,.92)',
    fontSize: 10.5,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  postOverlayMenuBtn: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  iconHit: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  postMediaWrap: { width: SCREEN_WIDTH, height: Math.min(SCREEN_WIDTH * 1.16, 480), backgroundColor: '#111' },
  postImage: { width: SCREEN_WIDTH, height: Math.min(SCREEN_WIDTH * 1.16, 480) },
  carouselPill: { position: 'absolute', right: 12, top: 12, paddingHorizontal: 9, height: 25, borderRadius: 13, backgroundColor: 'rgba(0,0,0,.6)', alignItems: 'center', justifyContent: 'center' },
  carouselPillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  feedSoundButton: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(20,20,24,.72)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    elevation: 6,
  },
  dotRow: { position: 'absolute', bottom: 9, alignSelf: 'center', flexDirection: 'row', gap: 4 },
  mediaDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.5)' },
  mediaDotActive: { backgroundColor: COLORS.blue, width: 6, height: 6 },
  postActions: { height: 48, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  postActionsLeft: { flexDirection: 'row', alignItems: 'center' },
  postTextArea: { paddingHorizontal: 12, paddingBottom: 12 },
  likesText: { color: '#fff', fontSize: 13.5, fontWeight: '800', marginBottom: 7 },
  captionText: { color: '#fff', lineHeight: 19, fontSize: 13.5 },
  captionAuthor: { fontWeight: '800' },
  hashtagLinkText: {
    color: '#5f9cff',
    fontWeight: '800',
  },
  viewComments: { color: '#8d8d96', fontSize: 13, marginTop: 7 },

  exploreHeader: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 7 },
  exploreSearchResults: {
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: '#111114',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#242429',
  },
  exploreSearchRow: {
    minHeight: 58,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#26262b',
  },
  exploreSearchName: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '800',
  },
  exploreSearchSub: {
    color: '#8e8e98',
    fontSize: 11,
    marginTop: 2,
  },
  hashtagSearchIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#55555d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hashtagSearchIconText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  searchBar: { height: 40, backgroundColor: '#1b1b1f', borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 0 },
  chipsRow: { paddingHorizontal: 10, paddingBottom: 10, gap: 7 },
  chip: { height: 34, paddingHorizontal: 15, borderRadius: 10, borderWidth: 1, borderColor: '#37373d', alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  chipTextActive: { color: '#000' },
  exploreTile: { width: SCREEN_WIDTH / 3, height: SCREEN_WIDTH / 3 * 1.28, borderWidth: .6, borderColor: '#000', backgroundColor: '#17171a' },
  exploreTileTall: { height: SCREEN_WIDTH / 3 * 1.55 },

  hashtagHeader: {
    height: 56,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#202024',
  },
  hashtagBackButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hashtagHeaderTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  hashtagHeaderTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  hashtagHeaderSub: {
    color: '#777780',
    fontSize: 10.5,
    marginTop: 1,
  },
  hashtagHeaderSpacer: {
    width: 46,
  },
  hashtagHero: {
    minHeight: 118,
    paddingHorizontal: 18,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#09090b',
  },
  hashtagHeroIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 2,
    borderColor: '#35353b',
    backgroundColor: '#151518',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hashtagHeroHash: {
    color: '#fff',
    fontSize: 42,
    fontWeight: '900',
  },
  hashtagHeroInfo: {
    flex: 1,
    marginLeft: 18,
  },
  hashtagHeroName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  hashtagHeroCount: {
    color: '#9b9ba4',
    fontSize: 13,
    marginTop: 6,
  },
  hashtagTabs: {
    height: 52,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#25252a',
    backgroundColor: '#050506',
  },
  hashtagTab: {
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  hashtagTabActive: {
    borderBottomColor: '#fff',
  },
  hashtagTabText: {
    color: '#777780',
    fontSize: 13,
    fontWeight: '800',
  },
  hashtagTabTextActive: {
    color: '#fff',
  },
  hashtagGridTile: {
    width: SCREEN_WIDTH / 3,
    height: SCREEN_WIDTH / 3 * 1.28,
    borderWidth: 0.6,
    borderColor: '#000',
    backgroundColor: '#17171a',
    overflow: 'hidden',
  },
  hashtagTileGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 42,
  },
  hashtagTileStats: {
    position: 'absolute',
    left: 7,
    right: 7,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  hashtagTileStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  hashtagTileStatText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  hashtagEmpty: {
    flex: 1,
    minHeight: 320,
    paddingHorizontal: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hashtagEmptyIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 2,
    borderColor: '#34343a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  hashtagEmptyHash: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '900',
  },
  hashtagEmptyTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  hashtagEmptyText: {
    color: '#888891',
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },
  tileReelIcon: { position: 'absolute', right: 7, top: 7 },
  tileCarouselIcon: {
    position: 'absolute',
    left: 7,
    top: 7,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  reelPage: { width: SCREEN_WIDTH, backgroundColor: '#111', overflow: 'hidden' },
  reelTop: { position: 'absolute', left: 16, right: 16, top: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 30 },
  reelTitle: { color: '#fff', fontSize: 21, fontWeight: '900' },
  reelBottomInfo: { position: 'absolute', left: 14, right: 82, bottom: 18 },
  reelUserRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  reelUserIdentity: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  reelUserTextColumn: { marginLeft: 9, alignItems: 'flex-start', justifyContent: 'center' },
  reelHandle: { color: '#fff', fontWeight: '800', fontSize: 13.5 },
  followMini: { marginTop: 2, paddingVertical: 1, paddingHorizontal: 0, alignSelf: 'flex-start' },
  followMiniText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  followMiniTextActive: { color: 'rgba(255,255,255,.68)' },
  reelCaption: { color: '#fff', fontSize: 13.5, lineHeight: 18 },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  audioText: { color: '#fff', fontSize: 12 },
  reelSideActions: { position: 'absolute', right: 9, bottom: 18, alignItems: 'center', gap: 17 },
  reelAction: { alignItems: 'center', minWidth: 48 },
  reelActionText: { color: '#fff', fontSize: 11, marginTop: 4, fontWeight: '700' },
  reelMiniCover: { width: 34, height: 34, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  muteBubble: { position: 'absolute', alignSelf: 'center', top: '45%', width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,.6)', alignItems: 'center', justifyContent: 'center' },
  doubleTapHeart: { position: 'absolute', left: 0, right: 0, top: '39%', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  mediaReelModal: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 9999,
    elevation: 9999,
  },
  exploreSwipePage: {
    width: SCREEN_WIDTH,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  mediaReelSafe: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  mediaReelStage: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', overflow: 'hidden' },
  mediaReelSlide: { width: SCREEN_WIDTH, height: '100%', backgroundColor: '#111' },
  mediaReelCarouselPill: { position: 'absolute', top: 66, right: 14, minWidth: 46, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(0,0,0,.62)', alignItems: 'center', justifyContent: 'center' },
  mediaReelCarouselPillText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  mediaReelTop: { position: 'absolute', left: 8, right: 8, top: 8, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mediaReelBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mediaReelTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },

  publicationProgressTouch: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 20,
    justifyContent: 'flex-end',
    zIndex: 60,
  },
  publicationProgressTrack: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,.28)',
  },
  publicationProgressFill: {
    height: 2,
    backgroundColor: '#fff',
  },

  publicationBottomInfo: {
    position: 'absolute',
    left: 14,
    right: 88,
    zIndex: 45,
  },
  publicationUserLine: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  publicationHandle: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '900',
    marginLeft: 9,
    maxWidth: '56%',
    textShadowColor: 'rgba(0,0,0,.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  publicationFollowTap: {
    marginLeft: 10,
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  publicationFollowText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  publicationFollowTextActive: {
    color: 'rgba(255,255,255,.68)',
  },
  publicationAudioLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
    marginLeft: 43,
  },
  publicationAudioText: {
    color: '#fff',
    fontSize: 10.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  publicationCaption: {
    color: '#fff',
    fontSize: 12.5,
    marginTop: 8,
    fontWeight: '600',
  },
  publicationMore: {
    color: 'rgba(255,255,255,.82)',
    fontSize: 11,
    marginTop: 5,
    fontWeight: '600',
  },
  publicationSideActions: {
    position: 'absolute',
    right: 9,
    alignItems: 'center',
    gap: 13,
    zIndex: 45,
  },
  publicationMiniCover: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#fff',
    marginTop: 2,
  },
  publicationQuickComment: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(36,39,43,.92)',
    justifyContent: 'center',
    zIndex: 55,
  },
  publicationQuickCommentInput: {
    color: '#fff',
    fontSize: 12.5,
    paddingHorizontal: 16,
    paddingVertical: 0,
  },

  messagesHeader: { paddingHorizontal: 16, paddingTop: 11, paddingBottom: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bigHeader: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -.7 },
  headerSub: { color: '#8f8f98', fontSize: 12, marginTop: 2 },
  iconRound: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1a1a1e', alignItems: 'center', justifyContent: 'center' },
  peopleStrip: { paddingHorizontal: 14, paddingBottom: 14, gap: 15 },
  personBubble: { width: 68, alignItems: 'center' },
  personName: { color: '#ddd', fontSize: 11, marginTop: 5, width: 68, textAlign: 'center' },
  chatRow: { paddingHorizontal: 14, height: 78, flexDirection: 'row', alignItems: 'center' },
  chatTextBlock: { flex: 1, marginLeft: 12 },
  chatName: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  chatPreview: { color: '#8e8e98', marginTop: 4, fontSize: 13 },
  unreadDot: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '900' },

  chatHeader: { height: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#28282e', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5 },
  chatHeaderName: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  chatHeaderSub: { color: '#7e7e87', fontSize: 11, marginTop: 1 },
  messagesList: { paddingHorizontal: 12, paddingVertical: 16, gap: 6 },
  messageLine: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 3 },
  messageAvatar: { width: 26, height: 26, borderRadius: 13, marginRight: 7 },
  messageBubble: { maxWidth: SCREEN_WIDTH * .72, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 20 },
  messageMine: { backgroundColor: '#3797f0', borderBottomRightRadius: 6 },
  messageOther: { backgroundColor: '#26262c', borderBottomLeftRadius: 6 },
  messageText: { color: '#fff', fontSize: 15, lineHeight: 19 },
  messageImage: { width: 220, height: 280, borderRadius: 18 },
  typingText: { color: '#8e8e98', fontSize: 12, paddingVertical: 8, marginLeft: 36 },
  chatComposer: { minHeight: 58, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#242429' },
  composerRound: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#3797f0', alignItems: 'center', justifyContent: 'center' },
  composerInputWrap: { flex: 1, minHeight: 40, maxHeight: 90, borderRadius: 20, borderWidth: 1, borderColor: '#303036', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 9 },
  composerInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 7 },
  sendText: { color: '#4fa3ff', fontWeight: '800', fontSize: 14 },

  profileTopBar: { height: 54, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileHandleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileTopHandle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  profileBanner: { width: SCREEN_WIDTH, height: 164, opacity: .74 },
  profileInfoWrap: { paddingHorizontal: 14, marginTop: -86 },
  profileStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stat: { alignItems: 'center', minWidth: 74 },
  statN: { color: '#fff', fontSize: 16, fontWeight: '900' },
  statLabel: { color: '#d7d7dc', fontSize: 11.5, marginTop: 2 },
  profileName: { color: '#fff', fontSize: 14.5, fontWeight: '800', marginTop: 11 },
  profileBio: { color: '#f0f0f2', fontSize: 13, lineHeight: 18, marginTop: 4 },
  profileLink: { color: '#9fc5ff', fontSize: 13, marginTop: 4, fontWeight: '700' },
  profileButtonsRow: { flexDirection: 'row', gap: 7, marginTop: 13 },
  profileBtn: { flex: 1, height: 35, borderRadius: 8, backgroundColor: '#26262b', alignItems: 'center', justifyContent: 'center' },
  profileBtnText: { color: '#fff', fontSize: 12.2, fontWeight: '800' },
  profileSmallBtn: { width: 38, height: 35, borderRadius: 8, backgroundColor: '#26262b', alignItems: 'center', justifyContent: 'center' },
  highlightsRow: { paddingVertical: 16, gap: 16 },
  highlightItem: { width: 67, alignItems: 'center' },
  highlightCircle: { width: 61, height: 61, borderRadius: 31, borderWidth: 1, borderColor: '#48484e', backgroundColor: '#16161a', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  highlightLabel: { color: '#e0e0e4', fontSize: 10.5, marginTop: 5 },
  profileTabs: { height: 47, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#232327' },
  profileTab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileTabActive: { borderBottomWidth: 1.5, borderBottomColor: '#fff' },
  profileGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  profileGridTile: { width: SCREEN_WIDTH / 3, height: SCREEN_WIDTH / 3 * 1.13, borderWidth: .6, borderColor: '#000', backgroundColor: '#111' },
  gridOverlayIcon: { position: 'absolute', top: 7, right: 7 },
  gridCarouselIcon: { position: 'absolute', top: 7, right: 7, textShadowColor: '#000', textShadowRadius: 4 },

  simpleHeader: { height: 56, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#242429' },
  simpleHeaderTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  otherProfileHead: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  otherButtons: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginTop: 14, marginBottom: 16 },
  followButton: { flex: 1, height: 36, borderRadius: 8, backgroundColor: '#3797f0', alignItems: 'center', justifyContent: 'center' },
  followingButton: { backgroundColor: '#26262b' },
  followButtonText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },

  bottomNav: { width: '100%', minHeight: 58, backgroundColor: '#050506', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2b2b30', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  navBtn: { flex: 1, height: 58, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  navAvatar: { width: 27, height: 27, borderRadius: 14 },
  navAvatarActive: { borderWidth: 2, borderColor: '#fff' },
  navAvatarInstagram: { width: 29, height: 29, borderRadius: 15, borderWidth: 1, borderColor: '#3a3a3d' },
  navAvatarInstagramActive: { borderWidth: 2, borderColor: '#fff' },
  igReelsIcon: { width: 29, height: 27, borderRadius: 7, borderWidth: 2.2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  igReelsIconActive: { backgroundColor: '#fff' },
  igReelsClapper: { position: 'absolute', left: -1, right: -1, top: -1, height: 8, borderBottomWidth: 1.8, borderBottomColor: '#fff', overflow: 'hidden' },
  igReelsSlash: { position: 'absolute', top: -4, left: 1, width: 3, height: 14, backgroundColor: '#fff', transform: [{ rotate: '-28deg' }] },
  kidflixCreateWrap: { width: 44, height: 30, alignItems: 'center', justifyContent: 'center' },
  kidflixCreateCyan: { position: 'absolute', left: 0, top: 2, width: 37, height: 27, borderRadius: 8, backgroundColor: '#25F4EE' },
  kidflixCreatePink: { position: 'absolute', right: 0, top: 2, width: 37, height: 27, borderRadius: 8, backgroundColor: '#FE2C55' },
  kidflixCreateFront: { width: 38, height: 27, borderRadius: 8, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },

  modalBackdropBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)', justifyContent: 'flex-end' },
  sheetLarge: { height: SCREEN_HEIGHT * .72, backgroundColor: '#111114', borderTopLeftRadius: 25, borderTopRightRadius: 25, overflow: 'hidden' },
  sheetHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: '#5a5a60', alignSelf: 'center', marginTop: 8, marginBottom: 9 },
  sheetTitle: { color: '#fff', fontSize: 15.5, fontWeight: '900', textAlign: 'center', paddingBottom: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2b2b30' },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10 },
  commentAuthor: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
  commentText: { color: '#eee', fontSize: 13.5, marginTop: 3, lineHeight: 18 },
  commentComposer: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2a2a30', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 9 },
  commentInput: { flex: 1, color: '#fff', fontSize: 14.5 },
  emptyState: { alignItems: 'center', paddingVertical: 70 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 14 },
  emptyText: { color: '#888', fontSize: 13, marginTop: 5 },

  storyViewer: { flex: 1, backgroundColor: '#000' },
  storyBars: { position: 'absolute', top: 10, left: 9, right: 9, flexDirection: 'row', gap: 4, zIndex: 3 },
  storyBarTrack: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,.35)', overflow: 'hidden' },
  storyBarFill: { height: '100%', backgroundColor: '#fff' },
  storyViewerHeader: { position: 'absolute', top: 22, left: 12, right: 12, height: 50, flexDirection: 'row', alignItems: 'center', zIndex: 3 },
  storyViewerName: { color: '#fff', fontWeight: '800', marginLeft: 9, fontSize: 13 },
  storyViewerTime: { color: '#ddd', marginLeft: 8, fontSize: 12 },
  storyTapZones: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 1 },
  storyReply: { position: 'absolute', bottom: 20, left: 12, right: 12, height: 50, flexDirection: 'row', alignItems: 'center', gap: 13, zIndex: 3 },
  storyReplyInput: { flex: 1, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,.8)', paddingHorizontal: 16, color: '#fff' },

  mediaViewer: { flex: 1, backgroundColor: '#000' },
  viewerHeader: { height: 58, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerTitle: { color: '#fff', fontWeight: '900', fontSize: 16 },
  viewerImage: { flex: 1, width: SCREEN_WIDTH, backgroundColor: '#050505' },
  viewerActions: { height: 62, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 18 },

  actionSheet: { backgroundColor: '#151518', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 12, paddingBottom: 25 },
  sheetQuickRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12 },
  quickAction: { alignItems: 'center', width: 76 },
  quickCircle: { width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: '#38383d', alignItems: 'center', justifyContent: 'center' },
  quickLabel: { color: '#fff', fontSize: 11, marginTop: 6 },
  sheetAction: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#29292e' },
  sheetActionText: { color: '#fff', fontSize: 14.5, fontWeight: '600' },

  shareSheet: { backgroundColor: '#151518', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 14, maxHeight: SCREEN_HEIGHT * .72 },
  shareGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 },
  sharePerson: { width: '25%', alignItems: 'center', marginBottom: 18 },
  sharePersonName: { color: '#ddd', fontSize: 11, marginTop: 5 },
  shareExternalRow: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#303035', paddingTop: 15 },

  notificationRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#202024' },
  notificationIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  notificationText: { flex: 1, color: '#fff', fontSize: 13.5, lineHeight: 18, marginHorizontal: 11 },
  notificationTime: { color: '#83838d', fontSize: 11 },

  cancelText: { color: '#fff', fontSize: 14 },
  doneText: { color: '#4fa3ff', fontWeight: '800', fontSize: 14 },
  editAvatarSection: { alignItems: 'center', paddingVertical: 12 },
  changePhoto: { color: '#4fa3ff', fontSize: 13, fontWeight: '800', marginTop: 10 },
  editBanner: { height: 130, borderRadius: 15, overflow: 'hidden', marginVertical: 12, backgroundColor: '#222' },
  editBannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.35)', alignItems: 'center', justifyContent: 'center' },
  editBannerText: { color: '#fff', fontWeight: '800', marginTop: 5 },
  editField: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#323238', paddingVertical: 12 },
  editLabel: { color: '#8e8e98', fontSize: 11.5, marginBottom: 5 },
  editInput: { color: '#fff', fontSize: 15, paddingVertical: 2 },

  createOptions: { padding: 16 },
  externalPublishScreen: { flex: 1, backgroundColor: '#000' },
  externalPublishContent: { padding: 16, paddingBottom: 96 },
  externalPublishHelp: {
    color: '#e8e8ec',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  externalCodeInput: {
    minHeight: 180,
    maxHeight: 290,
    borderRadius: 16,
    backgroundColor: '#151518',
    borderWidth: 1,
    borderColor: '#2d2d32',
    color: '#fff',
    fontSize: 13,
    lineHeight: 19,
    padding: 14,
    textAlignVertical: 'top',
  },
  externalDetectedHeader: {
    marginTop: 18,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  externalDetectedTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  externalDetectedCount: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  externalPreviewRow: { gap: 8, paddingRight: 16 },
  externalPreviewTile: {
    width: 112,
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: '#27272c',
  },
  externalTypeBadge: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalRemoveButton: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(220,30,65,.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.75)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    elevation: 20,
  },
  externalPublishNote: {
    color: '#8f8f98',
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 14,
  },

  galleryScreen: { flex: 1, backgroundColor: '#000' },
  galleryPreview: {
    height: Math.min(SCREEN_WIDTH * 0.88, 360),
    backgroundColor: '#08080a',
    overflow: 'hidden',
  },
  galleryEmptyPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111114',
  },
  galleryToolbar: {
    height: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#242429',
  },
  galleryRecent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
  },
  galleryRecentText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  galleryMultiButton: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 17,
    backgroundColor: '#242428',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  galleryMultiButtonActive: {
    backgroundColor: '#34343a',
  },
  galleryMultiText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  galleryGridContent: {
    paddingBottom: 82,
  },
  galleryTile: {
    width: SCREEN_WIDTH / 3,
    height: SCREEN_WIDTH / 3,
    backgroundColor: '#17171a',
    borderWidth: 0.5,
    borderColor: '#000',
    overflow: 'hidden',
  },
  galleryVideoMeta: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,.42)',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  galleryVideoDuration: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  gallerySelectedBadge: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: COLORS.blue,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gallerySelectedBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  galleryNextButton: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#3797f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    zIndex: 30,
  },
  galleryNextButtonDisabled: {
    opacity: 0.42,
  },
  galleryNextText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  galleryPermissionBox: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  galleryPermissionText: {
    color: '#bbb',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
  },
  galleryRetryButton: {
    minWidth: 150,
    minHeight: 42,
    borderRadius: 11,
    backgroundColor: '#3797f0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  galleryRetryText: {
    color: '#fff',
    fontWeight: '900',
  },
  gallerySystemButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  gallerySystemText: {
    color: '#6fb6ff',
    fontWeight: '800',
  },

  createEditScreen: {
    flex: 1,
    backgroundColor: '#000',
    paddingBottom: 74,
  },
  createEditPreview: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#050506',
  },
  createEditTools: {
    height: 66,
    paddingHorizontal: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#242429',
  },
  createEditTool: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  createEditToolText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  createOption: { minHeight: 76, borderRadius: 16, backgroundColor: '#151518', borderWidth: 1, borderColor: '#29292e', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 10 },
  createOptionIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#222228', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  createOptionTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  createOptionSub: { color: '#8d8d96', fontSize: 11.5, marginTop: 3 },
  composePreviewWrap: { width: '100%', height: 250, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' },
  composePreviewPage: { width: SCREEN_WIDTH - 32, height: 250 },
  composePreview: { width: '100%', height: 250, borderRadius: 16, backgroundColor: '#111' },
  composeCountPill: { position: 'absolute', top: 10, right: 10, minWidth: 44, height: 26, paddingHorizontal: 9, borderRadius: 13, backgroundColor: 'rgba(0,0,0,.62)', alignItems: 'center', justifyContent: 'center' },
  composeCountText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  composeDotRow: { position: 'absolute', bottom: 9, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  captionInput: { minHeight: 90, marginTop: 14, color: '#fff', fontSize: 15, textAlignVertical: 'top', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#303035' },
  createSetting: { height: 54, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a2a2f' },
  createSettingText: { flex: 1, color: '#fff', fontSize: 14 },
  publishButton: { margin: 14, height: 50, borderRadius: 13, backgroundColor: '#3797f0', alignItems: 'center', justifyContent: 'center' },
  publishText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  settingsSection: { color: '#8d8d96', fontSize: 12, fontWeight: '800', marginTop: 18, marginBottom: 6 },
  logoutButton: { height: 52, justifyContent: 'center', marginTop: 20 },
  logoutText: { color: COLORS.red, fontSize: 15, fontWeight: '800' },

  voiceBubble: { minWidth: 150, flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceWave: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  voiceBar: { width: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,.78)' },
  messageReaction: { marginTop: -8, backgroundColor: '#222228', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2 },

  callScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  callTop: { position: 'absolute', top: 52, left: 0, right: 0, alignItems: 'center' },
  callType: { color: '#c6c6ce', fontSize: 13, fontWeight: '700' },
  callName: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 20 },
  callStatus: { color: '#aaaab3', fontSize: 14, marginTop: 7 },
  callPreview: { width: 210, height: 120, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.08)', marginTop: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#33343a' },
  callPreviewText: { color: '#c9c9d0', fontSize: 11, marginTop: 8 },
  callControls: { position: 'absolute', bottom: 88, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start' },
  callButtonWrap: { alignItems: 'center', width: 78 },
  callButton: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#303038', alignItems: 'center', justifyContent: 'center' },
  callButtonLabel: { color: '#fff', fontSize: 10, marginTop: 7, textAlign: 'center' },
  callNote: { position: 'absolute', bottom: 22, color: '#72727b', fontSize: 10, lineHeight: 14, textAlign: 'center', paddingHorizontal: 22 },

  centerModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.7)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  accountSwitcher: { width: '100%', maxWidth: 380, backgroundColor: '#17171b', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#303036' },
  dialogTitle: { color: '#fff', fontSize: 19, fontWeight: '900', textAlign: 'center', marginBottom: 12 },
  accountRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2c2c31' },
  accountName: { color: '#fff', fontSize: 14, fontWeight: '800' },
  accountSub: { color: '#8b8b95', fontSize: 11, marginTop: 3 },
  addAccountCircle: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#55555e', alignItems: 'center', justifyContent: 'center' },
  peopleRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#242429' },
  followButtonSmall: { minWidth: 82, height: 34, borderRadius: 9, backgroundColor: COLORS.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11 },
  followButtonSmallText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  sheetTitleRow: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2b2b30' },
  sheetTitleInline: { color: '#fff', fontSize: 15.5, fontWeight: '900', textAlign: 'center' },
  qrCard: { width: 300, backgroundColor: '#fff', borderRadius: 24, padding: 18, alignItems: 'center' },
  qrGrid: { width: 216, height: 216, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#fff', padding: 8, marginVertical: 8 },
  qrCell: { width: 22, height: 22 },
  qrCaption: { color: '#222', fontSize: 12, marginBottom: 12 },
  dialogPrimary: { minWidth: 140, height: 44, borderRadius: 12, backgroundColor: COLORS.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 12 },
  dialogPrimaryText: { color: '#fff', fontWeight: '900', fontSize: 13 },

  settingValue: { maxWidth: 120, color: '#96969f', fontSize: 11, marginRight: 4 },
  toggleRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a2a2f' },
  toggleLabel: { flex: 1, color: '#fff', fontSize: 14 },
  liveScreen: { flex: 1, backgroundColor: '#000' },
  liveHeader: { height: 62, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveBadge: { backgroundColor: '#33333a', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 6 },
  liveBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  liveCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  liveTitle: { color: '#fff', fontSize: 25, fontWeight: '900', marginTop: 14 },
  liveSub: { color: '#b0b0b8', fontSize: 12, marginTop: 7, textAlign: 'center', paddingHorizontal: 28 },
  liveControls: { paddingHorizontal: 18, paddingBottom: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  goLiveButton: { height: 50, borderRadius: 25, backgroundColor: COLORS.red, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  goLiveText: { color: '#fff', fontSize: 13, fontWeight: '900' },

  infoRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#29292e' },
  infoValue: { color: COLORS.cyan, fontSize: 16, fontWeight: '900' },
  aboutCard: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 18 },
  aboutText: { color: '#aaaab3', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 18 },
});
