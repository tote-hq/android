# Changuito en el dApp Store (Seeker)

Webshell de Android que abre [https://sol.changuito.me](https://sol.changuito.me) dentro de una WebView. No es una Trusted Web Activity: no hace falta Digital Asset Links. Los links que salen de `sol.changuito.me` se abren en el navegador del sistema. Las intents `solana-wallet:` e `intent:` las resuelve la shell, que es el camino que Solana Mobile recomienda desde septiembre de 2026 para que Mobile Wallet Adapter siga funcionando cuando el navegador pide permiso de red local.

| | |
|---|---|
| Nombre en el launcher | Changuito |
| Application id | `me.changuito.sol` |
| URL | `https://sol.changuito.me/` |
| `versionCode` / `versionName` | `1` / `1.0.0` |
| minSdk / targetSdk / compileSdk | 28 / 37 / 37 |
| CLI que generó el proyecto | `solana-mobile` 0.6.0, el 21 oct 2026 |
| Alias del keystore de release | `changuito` |
| Ruta del keystore (no está en git) | `android/keystore/changuito-release.keystore` |

La plantilla es la de `solana-mobile` (Apache-2.0). El proyecto salió de:

```bash
npx solana-mobile@0.6.0 webshell init android \
  --manifest store-listing/web-manifest.json \
  --url https://sol.changuito.me/ \
  --app-name Changuito \
  --application-id me.changuito.sol \
  --version-code 1 \
  --version-name 1.0.0 \
  --keystore-path keystore/changuito-release.keystore \
  --keystore-alias changuito
```

Ese `init` crea un keystore si el archivo no existe. El que se generó en la máquina de build se borró a propósito: no es la clave de publicación. La clave de release la crea Simoneth, una sola vez, con los pasos de abajo. No vuelvas a correr `webshell init` encima de este directorio si el keystore de release ya existe: un `init` con la ruta vacía genera otra clave y esa APK no puede actualizar la que ya está en la tienda.

Dos ediciones encima de la plantilla, y por qué:

- El ícono adaptativo lo aplicó el CLI desde `store-listing/icon-foreground.png` (la mascota, fondo girasol `#F4B942`, splash `#FAFAF7`). Los `mipmap-*/*.webp` de la plantilla seguían siendo el robot de Android; se reemplazaron por el ícono de la ficha en cada densidad.
- En `MainActivity.kt`, el único texto que ve la persona si la página no carga pasó de `Unable to load page` / `Retry` a `No se pudo abrir Changuito` / `Reintentar`. El resto de la shell quedó como la genera el CLI, incluido el puente de intents.

## Lo que no entra a git

Keystores, claves, contraseñas, `.env` y APKs están en `.gitignore` (raíz y `android/`). `local.properties` también: apunta al Android SDK de cada máquina.

Antes de cada push, revisá el diff. Si aparece un `.keystore`, un `.jks`, una contraseña o un `BEGIN PRIVATE KEY`, no lo subas.

## Requisitos de la máquina

- JDK 17 o más nuevo (`java -version`). Acá se compiló con OpenJDK 21.
- Android SDK. `npx solana-mobile@latest doctor` dice qué falta. Hace falta un `local.properties` dentro de `android/` con `sdk.dir=/ruta/al/sdk` (Android Studio lo escribe solo).
- Node, solo para invocar el CLI. El APK de debug también se puede armar con `./gradlew` sin el CLI.

## 1. Crear el keystore de release

Una sola vez. Guardá el archivo y las dos contraseñas fuera de la repo: un gestor de contraseñas y una copia offline. Si se pierde, no hay actualización en el dApp Store. Esta clave no sirve para Google Play, y la de Google Play no sirve acá. Cada app lleva la suya.

Desde la raíz de la repo:

```bash
mkdir -p android/keystore
keytool -genkey -v \
  -keystore android/keystore/changuito-release.keystore \
  -alias changuito \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

`keytool` pregunta la contraseña del almacén, la de la clave, y el nombre. Si las dos contraseñas son la misma, más abajo alcanza con una variable de entorno. El alias tiene que ser `changuito`: es el que quedó en `twa-manifest.json`.

Comprobá que git no lo ve:

```bash
git check-ignore -v android/keystore/changuito-release.keystore
```

Tiene que imprimir una regla. Si no imprime nada, no sigas.

## 2. Compilar y firmar el APK de release

En la misma terminal, sin escribir las contraseñas en un archivo de la repo:

```bash
export SOLANA_MOBILE_KEYSTORE_PASSWORD='la contraseña del almacén'
export SOLANA_MOBILE_KEY_PASSWORD='la contraseña de la clave'
npx solana-mobile@latest webshell build android
```

Si la contraseña de la clave es la misma que la del almacén, podés no exportar `SOLANA_MOBILE_KEY_PASSWORD`: el CLI usa la del almacén.

El APK firmado queda en:

```text
android/app/build/outputs/apk/release/app-release.apk
```

El mismo resultado, sin el CLI, desde `android/` y con las dos variables exportadas:

```bash
./gradlew assembleRelease \
  -PSOLANA_MOBILE_KEYSTORE_PATH=keystore/changuito-release.keystore \
  -PSOLANA_MOBILE_KEYSTORE_ALIAS=changuito
```

`assembleRelease` sin esas propiedades y sin las variables genera un APK sin firmar (`app-release-unsigned.apk`). Ese no se puede publicar.

Para probar sin la clave de release:

```bash
cd android
./gradlew assembleDebug
```

Eso deja `app/build/outputs/apk/debug/app-debug.apk`, firmado con el certificado de debug de la máquina. No lo subas al portal.

## 3. Verificar la firma

`apksigner` está en `build-tools` del Android SDK.

```bash
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

Tiene que verificar en verde y mostrar el certificado del keystore de release (el CN que hayas puesto en `keytool`), no `CN=Android Debug`. Anotá el SHA-256: el portal lo publica como fingerprint del release.

## 4. Probar en un dispositivo o emulador

Con el teléfono conectado y la depuración USB habilitada:

```bash
npx solana-mobile@latest device install \
  android/app/build/outputs/apk/release/app-release.apk
```

Qué mirar:

1. El launcher dice Changuito y el ícono es la mascota sobre girasol.
2. Abre `https://sol.changuito.me/` y se puede armar una compra.
3. Un link que no sea de ese host (por ejemplo el súper) se abre en el navegador, no dentro de la app.
4. Mobile Wallet Adapter, recién cuando la web registre `@solana-mobile/wallet-standard-mobile` ≥ 0.5.1 (checklist de abajo). La shell ya manda `solana-wallet:` a la billetera y dispara un `blur` sintético, que es lo que la librería espera. Sin ese paquete en la web, la app sigue entrando por Privy y MWA no aparece. El login de Privy abre popups en el navegador del sistema: hay que confirmar en un dispositivo si la sesión vuelve a la WebView.

En esta repo se compiló el APK de debug y se leyó con `aapt`. No había un Seeker ni un emulador con billetera, así que el flujo de MWA no se ejecutó de punta a punta.

## 5. Publicar en publish.solanamobile.com

Solana Mobile no cobra comisión por la app ni por pagos dentro de la app. Lo que sí hace falta es SOL de mainnet para las transacciones del envío y para ArDrive.

1. Cuenta en [https://publish.solanamobile.com](https://publish.solanamobile.com). Completá el perfil y el KYC o KYB. Sin eso no hay envío.
2. Conectá una billetera de extensión (Phantom, Solflare o Backpack). Esa es la publisher wallet. Tiene que tener unos **0,2 SOL en mainnet** para comisiones y para subir los archivos a Arweave. Hace falta para esta versión y para todas las siguientes. Si se pierde la semilla, no se puede volver a publicar esta app. No uses una billetera personal de uso diario: una dedicada, con el respaldo guardado aparte del keystore de Android.
3. Elegí el almacenamiento. ArDrive es el que recomienda el portal. El estimador de al lado muestra el costo. Si el saldo de almacenamiento quedaría en negativo, hacé Top Up Balance antes de enviar. AWS S3 usa un bucket propio y no tiene ese saldo.
4. Menú inferior izquierdo: Add a dApp → New dApp. Nombre: Changuito. Subí los archivos de [`store-listing/`](../store-listing/ficha.md): ícono 512, banner 1200×600, feature graphic 1200×1200, descripciones, capturas. Guardá. Se puede corregir antes de enviar.
5. En el home de la app, New Version. Subí `app-release.apk`. Al enviar, el portal pide firmar varios mensajes y transacciones con la publisher wallet. Son la subida a Arweave y el mint del release NFT. Aprobá cada una. Si salteás una, el envío puede quedar sin un asset.
6. La revisión tarda de 3 a 5 días hábiles y llega por mail desde `publishersupport@dappstore.solanamobile.com`. Si pasan 5 días hábiles sin respuesta, preguntá en el Discord de Solana Mobile, canal `#dev-answers`, con el rol de Developer.

URLs que el release pide y que hoy no existen en la web (hay que publicarlas antes, en tote-hq/solana): política de privacidad, y conviene tener también licencia y copyright. El spec del release las lleva como `privacy_policy_url`, `license_url` y `copyright_url`.

La política del publisher (21 jul 2026) está en [https://solanamobile.com/publisher-policy-web](https://solanamobile.com/publisher-policy-web). Leé la checklist de abajo antes de apretar Submit: una ficha que prometa USDC de mainnet mientras la app corre en devnet entra en contenido engañoso.

## 6. Actualizaciones

Cada versión nueva necesita un `versionCode` mayor. En `android/gradle.properties`:

```properties
SOLANA_MOBILE_VERSION_CODE=2
SOLANA_MOBILE_VERSION_NAME=1.1.0
```

Volvé a firmar con el mismo keystore y el mismo alias, y subí la versión desde el portal con la misma publisher wallet. Un cambio de la web en `sol.changuito.me` llega a quien ya instaló la app sin un APK nuevo: la shell carga el sitio en vivo. Un APK nuevo hace falta cuando cambia la shell, el `versionCode`, el ícono o los permisos.

Cuando la app y el App NFT ya existen, las versiones siguientes se pueden mandar por CI con `@solana-mobile/dapp-store-cli`. Pide una API key del portal y un keypair de Solana CLI. La primera versión se hace por el portal, no por ese CLI.

## Custodia, en una lista

- Keystore de Android (`changuito-release.keystore`) más las dos contraseñas. Copia offline. No va a git, no va a Slack, no va a un `.env` de Vercel.
- Semilla de la publisher wallet, en otro lugar que el keystore. Unos 0,2 SOL de mainnet adentro, y de sobra para la próxima versión.
- Las dos cosas las necesita la misma persona que publique la actualización. Si una se pierde, esa mitad del proceso no tiene reemplazo.

## Checklist en tote-hq/solana

Este PR no toca ese repo. Nada de esto está hecho en `https://sol.changuito.me` al 21 oct 2026.

- [ ] **Manifest PWA.** `https://sol.changuito.me/manifest.json` y `/manifest.webmanifest` responden 404. El de `www.changuito.me` existe, pero es la landing: `display: browser` e íconos de 32 y 180, no la tienda. Hace falta un manifest de la tienda con `name`, `short_name`, `start_url`, `scope`, `display: standalone`, `background_color` `#FAFAF7`, `theme_color` `#F4B942` e íconos PNG de 192 y 512. La shell ya publicada no lo lee en runtime (la URL está en `gradle.properties`). Sirve para reinstalar la shell y para que el sitio sea instalable.
- [ ] **`@solana-mobile/wallet-standard-mobile` ≥ 0.5.1.** En npm, el 21 oct 2026, la última es 0.7.0. La web no lo depende: el login es Privy (`@privy-io/react-auth`). Hay que llamar `registerMwa` en un componente cliente, con `appIdentity.name` Changuito, `uri` `https://sol.changuito.me` y las chains que correspondan. La 0.5.1 detecta el user agent `Solana Mobile Web Shell` (la shell ya lo agrega) y se saltea el permiso de red local del navegador. Sin este paquete, MWA no arranca.
- [ ] **Borrar la cuenta y los datos desde la app.** La política lo exige. Hoy el logout limpia la cookie `chg_user` y la sesión de Privy, y el navegador puede borrar los chats locales. No hay `DELETE` en `/api/profile`. Ahí están el mail de Día y el DNI, cifrados. El archivo de chats y los checkouts viven en el servidor. Hace falta un control en la app que borre eso, y decir qué se retiene por obligación legal (fraude, comprobantes).
- [ ] **Política de privacidad** publicada, enlazada desde la app, y pegada en el release como `privacy_policy_url`. No hay una en la web ni en la landing. En el mismo release, `license_url` y `copyright_url`.
- [ ] **Terceros** que ven datos (Privy, el modelo, Día, VTEX, el RPC de Solana) cubiertos por esa política.
- [ ] **Datos regulados.** DNI, clave de Día, código postal, pago. La política pide el mínimo, cifrado en tránsito y en reposo, y documentación si el escrow cuenta como servicio financiero regulado. Eso es una decisión legal, no un flag.
- [ ] **Alcohol.** Día puede vender alcohol. La política prohíbe facilitárselo a menores. Falta decidir si hay control de edad.
- [ ] **Probar MWA dentro de la shell** en un Android con una billetera, después del paquete de arriba. El login de Privy con Google se queda en la WebView (hosts de Privy y de Google, user agent sin `; wv` ni `Version/4.0`) para no perder el PKCE de `localStorage`. El resto de los hosts http(s) sigue abriéndose en el navegador del sistema.

## Preguntas abiertas

- **Devnet.** El checkout, los saldos y el faucet de la web usan Solana devnet (`api.devnet.solana.com`, USDC de prueba). En la documentación del dApp Store no hay una regla que diga “no se acepta devnet”. Tampoco hay una que diga que se acepta. Una ficha que hable de USDC real mientras la app está en devnet puede caer como contenido engañoso. La descripción de `store-listing/ficha.md` lo dice en voz alta; hay una variante para cuando haya mainnet.
- **Edad y alcohol**, en la checklist.
- **Escrow y servicios financieros regulados**, en la checklist. No lo resuelve este APK.
- **MWA de punta a punta** no se corrió en este entorno. La shell compilada contiene el esquema `solana-wallet` y la URL. Falta el cambio de la web y un dispositivo.
