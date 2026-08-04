import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './helpers/fake-dom.js';

test('共享 DOM helper 创建 app 容器', () => {
  const { app } = createFakeDocument();
  assert.equal(app.id, 'app');
});
