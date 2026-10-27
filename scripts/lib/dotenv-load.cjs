'use strict'

/**
 * The one place the root package (hardhat.config.cjs,
 * scripts/verify-deployment.cjs) loads .env files. These read
 * DEPLOYER_PRIVATE_KEY / PRIVATE_KEY on a deploy machine.
 *
 * A root-level copy of services/gateway/src/dotenv-load.js (#660): the gateway
 * helper is ESM inside another package, so it cannot be required from here
 * cleanly.
 *
 * dotenv 18 fills any option a caller leaves out from process.env:
 * DOTENV_PATH, DOTENV_OVERRIDE, DOTENV_QUIET, DOTENV_DEBUG, DOTENV_ENCODING
 * and DOTENV_FAST, with the DOTENV_CONFIG_* names as fallbacks. A bare
 * config() would then let the shell pick the file, or let .env overwrite
 * keys already exported in the shell. Every option is passed here, so the
 * environment decides neither.
 *
 * configDotenv rather than config: in dotenv 17, config() switches to the
 * encrypted .env.vault path whenever DOTENV_KEY is set. configDotenv is the
 * plain file loader in both 17 and 18.
 *
 * One thing the options cannot pin on dotenv 17: it ORs DOTENV_CONFIG_DEBUG
 * and DOTENV_CONFIG_QUIET from process.env into debug and quiet, and reads
 * them again after loading, so the same lines inside .env count too. Through
 * this helper that can only print the "injected env (N) from <path>" line
 * ("injecting env" on 17.2.x)
 * (and a failed-to-load path): counts and paths, never key names or values.
 * dotenv 18 takes the explicit options.
 */
const path = require('path')
const dotenv = require('dotenv')

const DOTENV_LOAD_OPTIONS = Object.freeze({
  override: false,
  quiet: true,
  debug: false,
  encoding: 'utf8',
  fast: false,
})

/**
 * Load one .env file into process.env without overwriting anything already
 * set. A missing file is returned in `error`, the same as dotenv.
 */
function loadDotenvFile(file) {
  if (typeof file !== 'string' || file === '') {
    throw new TypeError('loadDotenvFile needs an explicit .env path')
  }
  return dotenv.configDotenv({ ...DOTENV_LOAD_OPTIONS, path: file })
}

/**
 * What hardhat.config.cjs and verify-deployment.cjs loaded before:
 * ./.env.local, then ./.env, from the working directory. Neither overwrites
 * a key that is already set, so the shell wins, then .env.local, then .env.
 */
function loadRootEnv(cwd = process.cwd()) {
  return [
    loadDotenvFile(path.resolve(cwd, '.env.local')),
    loadDotenvFile(path.resolve(cwd, '.env')),
  ]
}

module.exports = { DOTENV_LOAD_OPTIONS, loadDotenvFile, loadRootEnv }
