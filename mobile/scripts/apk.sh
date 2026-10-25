#!/usr/bin/env bash
# Construit l'APK signé de FermPal sur le PC, puis le publie comme release GitHub
# (« latest » = dernier APK). Prérequis, une fois : Java 21 (~/.local/opt/jdk-21* ou
# JAVA_HOME), SDK Android (~/Android/Sdk ou ANDROID_HOME), et dans .env.local (jamais
# commité) la clé de publication : ANDROID_KEYSTORE_PATH (fichier PKCS12),
# ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS. `--no-publish` : construire seulement.
# Lancer les tests avant : npm test && npm run test:e2e.
set -euo pipefail
cd "$(dirname "$0")/../.."

publish=1
[[ "${1:-}" == "--no-publish" ]] && publish=0

[[ -r .env.local ]] && { set -a; . ./.env.local; set +a; }
: "${ANDROID_KEYSTORE_PATH:?clé de publication absente (.env.local)}"
: "${ANDROID_KEYSTORE_PASSWORD:?mot de passe de la clé absent (.env.local)}"
: "${ANDROID_KEY_ALIAS:?alias de la clé absent (.env.local)}"
export ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS

export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/.local/opt/jdk-21* 2>/dev/null | tail -1)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
[[ -x "$JAVA_HOME/bin/java" ]] || { echo "Java 21 introuvable (JAVA_HOME)"; exit 1; }
[[ -d "$ANDROID_HOME/platforms" ]] || { echo "SDK Android introuvable (ANDROID_HOME)"; exit 1; }
export PATH="$JAVA_HOME/bin:$PATH"

sha=$(git rev-parse --short HEAD)
if (( publish )) && [[ -n "$(git status --porcelain)" ]]; then
  echo "Modifications non commitées : commiter avant de publier (l'APK doit correspondre à un commit)."
  exit 1
fi

# Minutes depuis le 01/01/2026 : toujours croissant, chaque APK s'installe par-dessus le précédent.
export ANDROID_VERSION_CODE=$(( ($(date -u +%s) - 1767225600) / 60 ))
export ANDROID_VERSION_NAME="2.0.$ANDROID_VERSION_CODE"

npm run -s sync
npm run -s check-hosts
(cd android && ./gradlew assembleRelease --console=plain -q)
apk=android/app/build/outputs/apk/release/app-release.apk
apksigner=$(ls "$ANDROID_HOME"/build-tools/*/apksigner | tail -1)
"$apksigner" verify "$apk"
echo "APK : $apk (version $ANDROID_VERSION_NAME, commit $sha)"
(( publish )) || exit 0

cp "$apk" fermpal.apk
trap 'rm -f fermpal.apk' EXIT
tag="v$ANDROID_VERSION_NAME"
gh release create "$tag" fermpal.apk --target "$(git rev-parse HEAD)" --latest \
  --title "FermPal $ANDROID_VERSION_NAME" \
  --notes "APK signé (commit $sha). Installation : voir le README. Clé Gemini et kDrive : facultatifs, à saisir dans Paramètres."
echo "Publié : $tag"
