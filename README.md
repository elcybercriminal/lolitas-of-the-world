# Lolitas of the World

Projet Expo SDK 55 / React Native.

## Installation dans Codespaces

```bash
npm install
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

Le profil `preview` dans `eas.json` génère un APK Android installable directement.

## Firebase

Le projet utilise `firebase-ltw.js` pour Firebase Authentication et Firestore.

Dans Firebase Authentication, vérifier que ces fournisseurs sont activés :
- Email/Password
- Anonymous

## Publications JSON

`posts.json` est prévu pour GitHub Pages :
https://faroukabuanas13700.github.io/lolitas-of-the-world/posts.json
