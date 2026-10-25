# FermPal

Carnet de fermentation maison pour Android — *a home fermentation notebook for Android*
(🇬🇧 English below).

Kéfir, kombucha, jun, ginger beer, sodas de plantes, kvas, bière, cidre, hydromel… FermPal garde le fil
de chaque bocal : stock d'ingrédients → recette (avec versions) → brassin, phase par phase → dégustation.
Rappels de fin de phase, liste de courses, calculateur de seconde fermentation, guide pH. En français,
anglais et italien.

**Projet personnel, sans support.** Je le maintiens pour mon propre usage et je le partage tel quel :
pas de réponse garantie aux questions ni aux demandes. Les forks sont bienvenus (licence GPL-3.0).

## Vie privée

- Le carnet vit **sur le téléphone** (SQLite). Pas de compte, pas de serveur, pas de statistiques.
- Deux fonctions **facultatives**, inactives tant qu'elles ne sont pas configurées dans Paramètres :
  - **Recette IA** : appelle Gemini (Google) avec **ta propre clé**, créée sur
    [aistudio.google.com/apikey](https://aistudio.google.com/apikey). La clé reste sur le téléphone.
  - **Copie dans kDrive** (Infomaniak) : copie automatique du carnet, avec ton propre jeton d'API.
- Sans elles, l'app ne fait **aucune requête réseau**. L'export en fichier (Paramètres → Exporter le
  carnet) fonctionne toujours.

## Installer

1. Sur le téléphone, ouvrir la [dernière release](../../releases/latest) et télécharger `fermpal.apk`.
2. L'ouvrir et autoriser l'installation depuis cette source. Les versions suivantes s'installent
   par-dessus : le carnet est conservé.

Empreinte SHA-256 du certificat de signature (pour vérifier un APK) :
`DA:F3:5A:68:3B:9C:81:BD:48:23:AD:2E:D6:C8:85:3A:B4:91:7C:C1:60:7C:4A:B7:D9:0E:4D:E7:14:C1:B8:A5`

## Construire

Node 22, Java 21 et le SDK Android.

```bash
npm install
npm test && npm run test:e2e   # couche données, puis l'app dans un navigateur (services simulés)
npm run dev                    # l'app dans le navigateur (moteur SQLite en wasm)
npm run apk -- --no-publish    # APK signé ; clé de publication dans .env.local (voir mobile/scripts/apk.sh)
```

Code : `mobile/` (React + Vite + Capacitor), logique partagée dans `lib/`, projet Android dans `android/`.

---

## English

A home fermentation notebook: ingredient stock → versioned recipes → batches, phase by phase → tastings,
with end-of-phase reminders, a shopping list, a second-fermentation calculator and a pH guide.
French, English and Italian.

**Personal project, no support.** I maintain it for my own use and share it as is — no guaranteed
answers to questions or requests. Forks are welcome (GPL-3.0).

- The notebook lives **on the phone**: no account, no server, no analytics.
- Optional: **AI recipes** via Gemini with **your own API key**, and an automatic **copy to kDrive**
  (Infomaniak) with your own token. Without them the app makes **no network request at all**.
- Install: download `fermpal.apk` from the [latest release](../../releases/latest); updates install
  over it and keep your notebook.
- Signing certificate SHA-256: see the fingerprint in the French section above.

## Licence

[GPL-3.0-or-later](LICENSE) © Fabrizio1305
