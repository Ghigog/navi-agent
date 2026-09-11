/**
 * The wire protocol (NAV-90). `helper/Sources/NaviHelperCore/Protocol.swift` is the other half —
 * this only tests the TypeScript side's own contract: a request encodes to one JSON line, and a
 * response line that isn't a well-formed `{id, ok}` object never throws, the same "never throw on
 * bad input" stance `agent/loop.ts`'s `parseToolArgs` takes for tool call arguments.
 */

import { describe, expect, it } from 'vitest';
import { encodeRequest, parseResponseLine } from '../src/shared/ui-protocol.js';

describe('encodeRequest', () => {
  it('encodes to exactly one JSON line', () => {
    const line = encodeRequest({ id: 1, op: 'status', params: null });
    expect(line).not.toMatch(/\n/);
    expect(JSON.parse(line)).toEqual({ id: 1, op: 'status', params: null });
  });
});

describe('parseResponseLine', () => {
  it('parses a success response', () => {
    const response = parseResponseLine('{"id":1,"ok":true,"result":{"trusted":true}}');
    expect(response).toEqual({ id: 1, ok: true, result: { trusted: true } });
  });

  it('parses a failure response', () => {
    const response = parseResponseLine('{"id":2,"ok":false,"error":"gone","code":"element_gone"}');
    expect(response).toEqual({ id: 2, ok: false, error: 'gone', code: 'element_gone' });
  });

  it('returns null for an empty or whitespace-only line', () => {
    expect(parseResponseLine('')).toBeNull();
    expect(parseResponseLine('   ')).toBeNull();
  });

  it('returns null rather than throwing for malformed JSON', () => {
    expect(parseResponseLine('not json')).toBeNull();
    expect(parseResponseLine('{"id":1,')).toBeNull();
  });

  it('returns null for well-formed JSON missing the required fields', () => {
    expect(parseResponseLine('{"hello":"world"}')).toBeNull();
    expect(parseResponseLine('[1,2,3]')).toBeNull();
    expect(parseResponseLine('"just a string"')).toBeNull();
  });
});
