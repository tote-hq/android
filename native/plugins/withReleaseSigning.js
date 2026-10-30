const { withAppBuildGradle } = require('expo/config-plugins')

const MARKER = 'changuito-dapp-store-signing'

/**
 * Points the release build at the existing dApp Store key when the owner
 * provides it through the environment. Gradle reads the values at build time,
 * so a prebuild without those variables still produces an unsigned APK.
 * Passwords never land in the generated file.
 *
 * @param {import('expo/config').ExpoConfig} config
 */
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARKER)) return cfg
    const groovy = cfg.modResults.language !== 'kt'
    cfg.modResults.contents = groovy
      ? insertGroovy(cfg.modResults.contents)
      : insertKotlin(cfg.modResults.contents)
    return cfg
  })
}

function insertGroovy(source) {
  const helper = `
// ${MARKER}
def changuitoKeystorePath = System.getenv("CHANGUITO_KEYSTORE_PATH")
def changuitoKeystorePassword = System.getenv("CHANGUITO_KEYSTORE_PASSWORD")
def changuitoKeyAlias = System.getenv("CHANGUITO_KEY_ALIAS")
def changuitoKeyPassword = System.getenv("CHANGUITO_KEY_PASSWORD") ?: changuitoKeystorePassword
def changuitoReleaseSigning = changuitoKeystorePath && changuitoKeystorePassword && changuitoKeyAlias
`

  let next = source.replace(/android\s*\{/, (match) => `${helper}\nandroid {`)
  const signing = `
        if (changuitoReleaseSigning) {
            dappStore {
                storeFile file(changuitoKeystorePath)
                storePassword changuitoKeystorePassword
                keyAlias changuitoKeyAlias
                keyPassword changuitoKeyPassword
            }
        }`
  if (/signingConfigs\s*\{/.test(next)) {
    next = next.replace(/signingConfigs\s*\{/, (match) => `${match}${signing}`)
  }
  next = next.replace(/(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/, (_, inner) => {
    return `${inner}if (changuitoReleaseSigning) {
            signingConfig signingConfigs.dappStore
        } else {
            signingConfig signingConfigs.debug
        }`
  })
  return next
}

function insertKotlin(source) {
  const helper = `
// ${MARKER}
val changuitoKeystorePath = System.getenv("CHANGUITO_KEYSTORE_PATH")
val changuitoKeystorePassword = System.getenv("CHANGUITO_KEYSTORE_PASSWORD")
val changuitoKeyAlias = System.getenv("CHANGUITO_KEY_ALIAS")
val changuitoKeyPassword = System.getenv("CHANGUITO_KEY_PASSWORD") ?: changuitoKeystorePassword
val changuitoReleaseSigning =
    !changuitoKeystorePath.isNullOrBlank() &&
        !changuitoKeystorePassword.isNullOrBlank() &&
        !changuitoKeyAlias.isNullOrBlank()
`
  let next = source.replace(/android\s*\{/, (match) => `${helper}\nandroid {`)
  const signing = `
        if (changuitoReleaseSigning) {
            create("dappStore") {
                storeFile = file(changuitoKeystorePath)
                storePassword = changuitoKeystorePassword
                keyAlias = changuitoKeyAlias
                keyPassword = changuitoKeyPassword
            }
        }`
  if (/signingConfigs\s*\{/.test(next)) {
    next = next.replace(/signingConfigs\s*\{/, (match) => `${match}${signing}`)
  }
  next = next.replace(
    /(getByName\("release"\)\s*\{[^}]*?)signingConfig = signingConfigs\.getByName\("debug"\)/,
    (_, inner) => `${inner}if (changuitoReleaseSigning) {
            signingConfig = signingConfigs.getByName("dappStore")
        } else {
            signingConfig = signingConfigs.getByName("debug")
        }`,
  )
  return next
}

module.exports = withReleaseSigning
