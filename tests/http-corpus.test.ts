import assert from 'node:assert/strict';
import { createSampleBotApp } from '../src/app.js';
import { assertHttpCorpusResponse, loadHttpCorpus } from './http-corpus-contract.js';

const app = createSampleBotApp('http-corpus-bearer', false);
try {
  const corpus = loadHttpCorpus();
  assert.equal(corpus.length, 4);
  for (const item of corpus) {
    const response = await app.inject({
      method: 'POST',
      url: '/play',
      headers: { authorization: 'Bearer http-corpus-bearer' },
      payload: item.request,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body: unknown = response.json();
    assertHttpCorpusResponse(item, body);
    assert.throws(
      () =>
        assertHttpCorpusResponse(item, {
          protocolVersion: 2,
          kind: 'action',
          ...response.json<Record<string, unknown>>(),
          actionId: 'not-a-supplied-action',
        }),
      /must belong/
    );
    console.log(
      `PASS — HTTP corpus ${item.family}: ${item.request.validActions.length} candidates`
    );
  }
} finally {
  await app.close();
}
