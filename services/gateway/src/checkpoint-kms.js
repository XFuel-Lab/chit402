/**
 * Checkpoint KMS send. Only GetPublicKey and Sign are forwarded.
 * A { name, input } object becomes the matching Command before
 * KMSClient.send. Any other name is refused. The command name stays
 * on the instance so an injected double can still tell the calls apart.
 */

import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';

function refused() {
  const err = new Error('checkpoint kms command refused');
  err.code = 'checkpoint_kms_command';
  return err;
}

/**
 * @param {{ send: Function }} client
 * @param {{ name?: string, input?: object }} spec
 * @param {object} [options]
 */
export async function sendCheckpointKms(client, spec, options) {
  if (!client || typeof client.send !== 'function') {
    const err = new Error('checkpoint kms client is missing');
    err.code = 'checkpoint_kms_config';
    throw err;
  }
  const name = spec && spec.name;
  const input = spec && spec.input ? spec.input : {};
  let command;
  if (name === 'GetPublicKey') command = new GetPublicKeyCommand(input);
  else if (name === 'Sign') command = new SignCommand(input);
  else throw refused();
  command.name = name;
  return client.send(command, options);
}
