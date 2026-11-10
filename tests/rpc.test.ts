import { describe, expect, test } from 'bun:test';
import { RPC_ERROR, RpcError, RpcServer, requireString } from '../src/rpc';

function setup() {
  const sent: Array<Record<string, unknown>> = [];
  const server = new RpcServer((line) => sent.push(JSON.parse(line)));
  return { sent, server };
}

describe('RpcServer', () => {
  test('answers a request with the handler result', async () => {
    const { sent, server } = setup();
    server.handle('echo', (params) => ({ got: params }));
    server.receive(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'echo', params: { a: 1 } }));
    await server.drain();
    expect(sent).toEqual([{ jsonrpc: '2.0', id: 7, result: { got: { a: 1 } } }]);
  });

  test('replies with method not found for unknown methods', async () => {
    const { sent, server } = setup();
    server.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nope' }));
    await server.drain();
    expect(sent[0]).toMatchObject({ id: 1, error: { code: RPC_ERROR.methodNotFound } });
  });

  test('maps RpcError codes and hides other errors as internal', async () => {
    const { sent, server } = setup();
    server.handle('bad', () => {
      throw new RpcError(RPC_ERROR.invalidParams, 'nope');
    });
    server.handle('boom', () => {
      throw new Error('kaput');
    });
    server.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bad' }));
    server.receive(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'boom' }));
    await server.drain();
    expect(sent).toContainEqual({ jsonrpc: '2.0', id: 1, error: { code: RPC_ERROR.invalidParams, message: 'nope' } });
    expect(sent).toContainEqual({ jsonrpc: '2.0', id: 2, error: { code: RPC_ERROR.internal, message: 'kaput' } });
  });

  test('does not reply to notifications', async () => {
    const { sent, server } = setup();
    server.handle('ping', () => 'pong');
    server.receive(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));
    await server.drain();
    expect(sent).toEqual([]);
  });

  test('reports malformed JSON with a parse error', async () => {
    const { sent, server } = setup();
    server.receive('{not json');
    await server.drain();
    expect(sent[0]).toMatchObject({ id: null, error: { code: RPC_ERROR.parse } });
  });

  test('runs onShutdown after the shutdown reply is written', async () => {
    const { sent, server } = setup();
    const order: string[] = [];
    server.handle('shutdown', () => null);
    server.onShutdown = () => order.push(`closed after ${sent.length} reply`);
    server.receive(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' }));
    await server.drain();
    expect(order).toEqual(['closed after 1 reply']);
  });

  test('requireString rejects missing values', () => {
    expect(() => requireString({}, 'url')).toThrow('missing string param: url');
  });
});
