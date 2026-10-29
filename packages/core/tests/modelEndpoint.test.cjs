const test = require('node:test');
const assert = require('node:assert/strict');
const { validateModelEndpoint } = require('../dist/openAIEndpoint.js');
const { createOpenAICompatibleBackend } = require('../dist/chatClient.js');

test('provider keys cannot travel over external cleartext or credential-bearing URLs', () => {
  for (const endpoint of ['http://provider.example/v1', 'https://user:secret@provider.example/v1',
    'https://provider.example/v1?api_key=secret', 'file:///etc/passwd']) {
    assert.throws(() => createOpenAICompatibleBackend({ endpoint, apiKey: 'synthetic-key', model: 'test' }));
  }
  validateModelEndpoint('https://provider.example/v1', true);
  validateModelEndpoint('http://127.0.0.1:8080/v1', true);
  validateModelEndpoint('http://[::1]:8080/v1', false);
});

test('Codespaces requires an external HTTPS endpoint and user key', () => {
  for (const [endpoint, key] of [['http://provider.example/v1', true],
    ['https://provider.example/v1', false], ['https://localhost/v1', true]]) {
    assert.throws(() => validateModelEndpoint(endpoint, key, true), /Codespaces/);
  }
  validateModelEndpoint('https://provider.example/v1', true, true);
});

test('redirects cannot forward learner context or provider credentials to another endpoint', async () => {
  const http = require('node:http');
  let forwarded = 0;
  const destination = http.createServer((request, response) => { ++forwarded; response.end('{}'); });
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
  const source = http.createServer((request, response) => {
    response.writeHead(307, { Location: `http://127.0.0.1:${destination.address().port}/steal` });
    response.end();
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  try {
    const client = createOpenAICompatibleBackend({ endpoint: `http://127.0.0.1:${source.address().port}/v1`,
      apiKey: 'synthetic-secret', model: 'synthetic' });
    await assert.rejects(client.complete([{ role: 'user', content: 'private synthetic learner context' }]));
    assert.equal(forwarded, 0);
  } finally {
    await Promise.all([source, destination].map(server => new Promise(resolve => server.close(resolve))));
  }
});
