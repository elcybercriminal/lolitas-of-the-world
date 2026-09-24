import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyByEW-1u5fhlZjEpwcmaMTjQahD-EIwSUM',
  authDomain: 'kidflix-953e1.firebaseapp.com',
  projectId: 'kidflix-953e1',
  storageBucket: 'kidflix-953e1.firebasestorage.app',
  messagingSenderId: '146973041352',
  appId: '1:146973041352:web:b3ede3adf7a12aac26fbfd',
};

export const SUPABASE_LTW_CONFIG = {
  url: 'https://rgcrbdesaeoirlhggmvk.supabase.co',
  publishableKey: 'sb_publishable_-fioaT_RrSlVjAB9EeIamA_9ETOZRaC',
  bucket: 'kidflix-media',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let authInstance;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error) {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const db = getFirestore(app);

const INTERNAL_EMAIL_DOMAIN = 'kidflix.invalid';

function clean(value = '') {
  return String(value ?? '').trim();
}

function slugIdentifier(value = '') {
  const source = clean(value).toLowerCase();

  return (
    source
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9._-]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || `user${Date.now()}`
  );
}

export function internalEmail(raw = '') {
  const value = clean(raw).toLowerCase();
  if (value.includes('@')) return value;
  return `${slugIdentifier(value)}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function normalizeHandle(raw = '') {
  const value = clean(raw).replace(/^@+/, '');
  const slug = slugIdentifier(value).replace(/\./g, '_');
  return `@${slug || 'utilisateur'}`;
}

function publicEmail(firebaseEmail = '') {
  const value = String(firebaseEmail || '');
  return value.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`) ? '' : value;
}

function profileForApp(data, uid) {
  const bannerValue = data?.banner?.url || data?.bannerUrl || data?.banner || null;

  return {
    id: uid,
    uid,
    name: data?.name || 'Utilisateur',
    handle: data?.handle || '@utilisateur',
    bio: data?.bio || '',
    link: data?.link || '',
    email: data?.email || '',
    avatar: data?.avatarUrl || data?.avatar || null,
    banner: bannerValue,
    bannerPosition: Number(data?.bannerPosition ?? 50),
    privateAccount: !!data?.privateAccount,
  };
}

export async function loadOrCreateLtwProfile(user, rawIdentifier = '') {
  if (!user || user.isAnonymous) return null;

  const ref = doc(db, 'profiles', user.uid);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) {
    return profileForApp(snapshot.data(), user.uid);
  }

  const identifier =
    clean(rawIdentifier) ||
    publicEmail(user.email || '').split('@')[0] ||
    'utilisateur';

  const baseName = identifier.includes('@')
    ? identifier.split('@')[0]
    : identifier;

  const cleanBase = clean(baseName) || 'utilisateur';
  const safeName = cleanBase.charAt(0).toUpperCase() + cleanBase.slice(1);

  const data = {
    uid: user.uid,
    name: safeName,
    handle: normalizeHandle(cleanBase),
    email: publicEmail(user.email || ''),
    bio: '',
    link: '',
    avatarUrl: null,
    banner: null,
    bannerPosition: 50,
    privateAccount: false,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };

  await setDoc(ref, data, { merge: true });
  return profileForApp(data, user.uid);
}

export async function createLtwAccount(identifier, password) {
  const raw = clean(identifier);

  if (!raw) {
    const error = new Error('Entre un email ou un pseudo.');
    error.code = 'ltw/missing-identifier';
    throw error;
  }

  if (String(password || '').length < 6) {
    const error = new Error('Le mot de passe doit contenir au moins 6 caractères.');
    error.code = 'auth/weak-password';
    throw error;
  }

  if (auth.currentUser?.isAnonymous) {
    await signOut(auth);
  }

  const credential = await createUserWithEmailAndPassword(
    auth,
    internalEmail(raw),
    password
  );

  const profile = await loadOrCreateLtwProfile(credential.user, raw);
  return { user: credential.user, profile };
}

export async function signInLtwAccount(identifier, password) {
  const raw = clean(identifier);

  if (!raw) {
    const error = new Error('Entre ton email ou ton pseudo.');
    error.code = 'ltw/missing-identifier';
    throw error;
  }

  if (!password) {
    const error = new Error('Entre ton mot de passe.');
    error.code = 'ltw/missing-password';
    throw error;
  }

  if (auth.currentUser?.isAnonymous) {
    await signOut(auth);
  }

  const credential = await signInWithEmailAndPassword(
    auth,
    internalEmail(raw),
    password
  );

  const profile = await loadOrCreateLtwProfile(credential.user, raw);
  return { user: credential.user, profile };
}

export async function continueAsLtwGuest() {
  if (auth.currentUser?.isAnonymous) {
    return auth.currentUser;
  }

  if (auth.currentUser && !auth.currentUser.isAnonymous) {
    await signOut(auth);
  }

  const credential = await signInAnonymously(auth);
  return credential.user;
}

export async function signOutLtw() {
  await signOut(auth);
}

export function observeLtwAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function firebaseErrorMessage(error) {
  const code = String(error?.code || '');

  const messages = {
    'ltw/missing-identifier': 'Entre un email ou un pseudo.',
    'ltw/missing-password': 'Entre ton mot de passe.',
    'auth/email-already-in-use': 'Cette adresse ou ce pseudo est déjà utilisé.',
    'auth/invalid-credential': 'Email/pseudo ou mot de passe incorrect.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/user-not-found': 'Compte introuvable.',
    'auth/weak-password': 'Mot de passe trop faible : 6 caractères minimum.',
    'auth/invalid-email': 'Adresse email ou pseudo invalide.',
    'auth/network-request-failed': 'Connexion Internet indisponible.',
    'auth/too-many-requests': 'Trop de tentatives. Réessaie un peu plus tard.',
    'auth/operation-not-allowed':
      'Active Email/Mot de passe et Authentification anonyme dans Firebase Authentication.',
  };

  return messages[code] || error?.message || 'Une erreur est survenue.';
}
