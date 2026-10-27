import dotenv from 'dotenv';

/**
 * The one place the gateway loads a .env file.
 *
 * dotenv 18 fills any option a caller leaves out from process.env:
 * DOTENV_PATH, DOTENV_OVERRIDE, DOTENV_QUIET, DOTENV_DEBUG, DOTENV_ENCODING
 * and DOTENV_FAST, with the DOTENV_CONFIG_* names as fallbacks. The prod
 * service sources .env through bash and exports every line, so a DOTENV_ line
 * there, or one in the shell that starts a script, would pick the file and
 * decide whether .env values overwrite exported ones. Every option is passed
 * here, so the environment decides neither.
 *
 * configDotenv rather than config: in dotenv 17, config() switches to the
 * encrypted .env.vault path whenever DOTENV_KEY is set. configDotenv is the
 * plain file loader in both 17 and 18 (config() calls it in 18).
 *
 * One thing the options cannot pin on dotenv 17: it ORs DOTENV_CONFIG_DEBUG
 * and DOTENV_CONFIG_QUIET from process.env into debug and quiet, and reads
 * them again after loading, so the same lines inside .env count too. Through
 * this helper that can only print the "injected env (N) from <path>" line
 * (and a failed-to-load path): counts and paths, never key names or values.
 * It does not change which file loads or what is overwritten. dotenv 18
 * takes the explicit options.
 */
export const DOTENV_LOAD_OPTIONS = Object.freeze({
  override: false,
  quiet: true,
  debug: false,
  encoding: 'utf8',
  fast: false,
});

/**
 * Load one .env file into process.env without overwriting anything already
 * set. A missing file is not an error here, the same as dotenv: the result
 * carries it in `error`.
 *
 * @param {string} path absolute path of the file to load
 * @returns {{ parsed?: Record<string, string>, error?: Error }}
 */
export function loadDotenvFile(path) {
  if (typeof path !== 'string' || path === '') {
    throw new TypeError('loadDotenvFile needs an explicit .env path');
  }
  return dotenv.configDotenv({ ...DOTENV_LOAD_OPTIONS, path });
}
