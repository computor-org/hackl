const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAICompatibleBackend } = require('../dist/chatClient.js');
const { validateImageDataUrls } = require('../dist/imageContext.js');
const { estimateChatTokens } = require('../dist/tokenBudget.js');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a83sAAAAASUVORK5CYII=';

test('a learner-selected inline plot is encoded as a multimodal provider request', async () => {
  let body;
  const backend = createOpenAICompatibleBackend({ endpoint: 'https://provider.example/v1',
    model: 'synthetic-vision-model', apiKey: 'synthetic-user-key', fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer synthetic-user-key');
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Label the horizontal axis.' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  const answer = await backend.complete([{ role: 'user', content: 'Help me interpret this plot', imageDataUrls: [png] }]);
  assert.equal(answer.content, 'Label the horizontal axis.');
  assert.deepEqual(body.messages[0].content, [
    { type: 'text', text: 'Help me interpret this plot' }, { type: 'image_url', image_url: { url: png } },
  ]);
  assert.equal(JSON.stringify(body).includes('synthetic-user-key'), false);
  assert.ok(estimateChatTokens([{ role: 'user', content: '', imageDataUrls: [png] }]) >= 2048);
});

test('remote URLs, active content, malformed data and oversized batches never reach a provider', async () => {
  let calls = 0;
  const backend = createOpenAICompatibleBackend({ endpoint: 'http://localhost:8080/v1', model: 'test',
    fetchImpl: async () => { calls++; throw new Error('must not reach provider'); } });
  for (const images of [['https://169.254.169.254/metadata'], ['data:image/svg+xml;base64,PHN2Zy8+'],
    ['data:image/png;base64,YmFk'], Array(4).fill(png), ['x'.repeat(2800001)]]) {
    assert.throws(() => validateImageDataUrls(images));
    await assert.rejects(backend.complete([{ role: 'user', content: 'review', imageDataUrls: images }]));
  }
  assert.equal(calls, 0);
});
