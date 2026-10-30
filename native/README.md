# Changuito for Seeker (native)

This folder is a native Android app for the Solana dApp Store. It is built with Expo and React Native, `@solana/kit`, and Mobile Wallet Adapter (`@wallet-ui/react-native-kit`). The first screen asks the phone's wallet to sign in on devnet against https://sol.changuito.me.

The WebShell project in `android/` is a separate app and is not changed by anything in here. Both use the package name `me.changuito.sol`. A signed build of this app can replace the shell that is already listed, because the version code is higher and the signature is the same key.

| | |
|---|---|
| Launcher name | Changuito |
| Package | `me.changuito.sol` |
| Version code | `5` |
| Version name | `2.0.0` |
| Chain the wallet is asked to authorize | Solana devnet |
| Release key alias | `changuito` |

The release keystore is not in git. The person who published the current listing keeps that file and its two passwords. Losing the file means this package can never be updated on the store.

## What you need on a Mac

1. Node.js 22 or newer. In Terminal, `node -v` should print `v22` or higher. Install it from https://nodejs.org if the command is not found.
2. Android Studio. Open it once and let it finish the first-time setup so the Android SDK is downloaded. The SDK usually lands in `~/Library/Android/sdk`.
3. A JDK that comes with Android Studio (17 or newer). You do not need to install Java separately if Android Studio is installed.
4. The existing release keystore file (`changuito-release.keystore`) and the two passwords, from the person who holds the store key. Keep that file **outside** this repository, for example in `~/Changuito-keys/`. Do not drop it into `native/` or `android/`.

Check that git will not see the keystore if you ever put it inside the repo by mistake:

```bash
git check-ignore -v native/keystore/changuito-release.keystore
```

That must print a rule. If it prints nothing, stop.

## 1. Install the project

In Terminal, go to this folder (the path on your machine will differ):

```bash
cd native
npm install
```

`npm install` only downloads libraries. It does not build the APK and it does not need the keystore.

## 2. Build and sign the APK

Pick one of the two ways below. Both produce an APK. The store only accepts the one signed with the existing key.

### Way A — local EAS build (the one Solana Mobile documents)

Still inside `native/`:

```bash
npx eas-cli@latest build --platform android --profile dapp-store --local
```

The `dapp-store` profile in `eas.json` asks for an APK, not an Android App Bundle.

The first time, the command asks how to sign. Choose the **existing keystore**. When it asks:

- Keystore path: the file in `~/Changuito-keys/` (or wherever you stored it).
- Keystore password: the store password.
- Key alias: `changuito`
- Key password: the key password. If you set the same password for both when the key was created, type it again.

Do not let the command generate a new key. A new key cannot update the app that is already on the store.

The signed APK path is printed at the end of the command. Copy that file somewhere outside the repo before you close the terminal.

### Way B — Gradle on your machine

Use this if you would rather not install the EAS command. In the same Terminal window, **do not** write the passwords into a file in the repo. Export them for this window only:

```bash
export CHANGUITO_KEYSTORE_PATH="$HOME/Changuito-keys/changuito-release.keystore"
export CHANGUITO_KEYSTORE_PASSWORD='the store password'
export CHANGUITO_KEY_ALIAS='changuito'
export CHANGUITO_KEY_PASSWORD='the key password'
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

If the key password and the store password are the same, you can skip `CHANGUITO_KEY_PASSWORD`. The build uses the store password.

Then:

```bash
npm run prebuild
cd android
./gradlew assembleRelease
```

`prebuild` writes an `android/` folder on your machine. That folder is gitignored. Run `prebuild` again after changing `app.json`.

The signed APK is:

```text
native/android/app/build/outputs/apk/release/app-release.apk
```

Without those four variables, `assembleRelease` still builds, but the APK is unsigned (`app-release-unsigned.apk`). An unsigned APK cannot be submitted to the store. It also cannot be installed on top of the copy that is already on a phone.

## 3. Check the signature

`apksigner` is inside the Android SDK build-tools folder. From `native/`:

```bash
"$HOME/Library/Android/sdk/build-tools/"*/apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

If you used Way A, point that command at the APK path the EAS command printed.

The check should succeed and the certificate should be the release key (the name you set when the keystore was created), not `CN=Android Debug`. Write down the SHA-256. The store portal shows that fingerprint for the release.

## 4. Install it on a phone or emulator

Turn on USB debugging, plug the phone in, and:

```bash
"$HOME/Library/Android/sdk/platform-tools/adb" install -r path/to/app-release.apk
```

This package name is already the one on the store. Android will only replace that installed app when the signature matches. A debug-signed or unsigned APK will be refused with a message about an inconsistent certificate. Uninstall the store build first only if you mean to test an unsigned build, and know that uninstall removes that copy of the app from the phone.

What to look at:

1. The launcher says Changuito and the icon is the mascot on the sunflower background.
2. The screen offers sign-in in Spanish or English, and follows the phone's light or dark theme. The theme and language buttons on the screen switch both.
3. Sign-in opens the wallet on the phone and asks it to authorize **devnet**, then to sign a short message. After that, the screen shows the shortened address, or a `.skr` name when the wallet label is one, and a sign-out button.
4. Cancelling the wallet sheet leaves you on the sign-in screen with a sentence that says the sign-in was cancelled.

A release build talks to https://sol.changuito.me. There is no phone wallet in this repository's build environment, so the wallet sheet itself has to be tried on a Seeker or an emulator that has a wallet app installed (the Solana Mobile fake wallet is enough for the sheet).

## Develop against a pretend account

Copy the example env file and turn the switch on:

```bash
cp .env.example .env
```

Set `EXPO_PUBLIC_MOCK_WALLET=1` in that `.env`. Then `npx expo start --dev-client`. The switch is ignored in a release build, so a store APK cannot take this path. `.env` is gitignored. Do not put passwords in it.

## What must never be committed

Keystores, `credentials.json`, `.env`, passwords, and APKs. Before every push, look at `git status` and `git diff`. If a keystore file, a password, or a private-key block shows up, do not push.
