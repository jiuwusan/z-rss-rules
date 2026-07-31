const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.ownTextContent = '';
  }

  get textContent() {
    return this.ownTextContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this.ownTextContent = String(value);
    this.children = [];
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.ownTextContent = '';
    this.children = [...children];
  }
}

const loadPageScript = () => {
  const app = new FakeElement('main');
  const document = {
    createElement: tagName => new FakeElement(tagName),
    getElementById: id => (id === 'app' ? app : null)
  };
  const htmlPath = path.join(__dirname, '..', 'frontend', 'rules.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const pageScript = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)?.[1];

  assert.ok(pageScript, '页面内联脚本应存在');

  const context = vm.createContext({
    console: { error() {}, log() {} },
    document,
    fetch: () => new Promise(() => {})
  });

  vm.runInContext(`${pageScript}\nthis.__page = { transformRules, renderRules, renderLoadError, queryRules };`, context);

  return { app, context, page: context.__page };
};

test('transformRules 保留规则名并提取 mustContainKeywords', () => {
  const { page } = loadPageScript();
  const rulesArray = page.transformRules({
    'HDSWEB 剧集': {
      mustContain: 'H265.*HDSWEB.*(九门|非份之罪)',
      mustNotContain: '(HDR|60fps|HHWEB)'
    }
  });

  assert.equal(rulesArray[0].name, 'HDSWEB 剧集');
  assert.deepEqual(Array.from(rulesArray[0].mustContainKeywords), ['九门', '非份之罪']);
  assert.deepEqual(Array.from(rulesArray[0].mustNotContainKeywords), ['HHWEB']);
});

test('transformRules 在关键词字段缺失时返回空数组', () => {
  const { page } = loadPageScript();
  const rulesArray = page.transformRules({ Pure基准: {} });

  assert.deepEqual(Array.from(rulesArray[0].mustContainKeywords), []);
  assert.deepEqual(Array.from(rulesArray[0].mustNotContainKeywords), []);
});

test('renderRules 按规则名渲染关键词和无关键词提示', () => {
  const { app, page } = loadPageScript();

  page.renderRules([
    { name: 'HDSWEB 剧集', mustContainKeywords: ['九门', '非份之罪'] },
    { name: 'Pure 基准', mustContainKeywords: [] }
  ]);

  assert.equal(app.children.length, 2);
  assert.equal(app.children[0].children[0].textContent, 'HDSWEB 剧集');
  assert.equal(app.children[0].children[1].children.length, 2);
  assert.equal(app.children[0].children[1].children[0].textContent, '九门');
  assert.equal(app.children[0].children[1].children[1].textContent, '非份之罪');
  assert.equal(app.children[1].children[0].textContent, 'Pure 基准');
  assert.equal(app.children[1].children[1].textContent, '无关键词');
});

test('queryRules 在接口失败时渲染统一错误信息', async () => {
  const { app, context, page } = loadPageScript();
  context.fetch = async () => ({ ok: false, status: 500 });

  await page.queryRules();

  assert.equal(app.textContent, '规则加载失败');
});

test('queryRules 成功时按接口对象键渲染规则', async () => {
  const { app, context, page } = loadPageScript();
  context.fetch = async () => ({
    ok: true,
    json: async () => ({
      HDSWEB规则: {
        mustContain: 'H265.*HDSWEB.*(九门)',
        mustNotContain: '(HDR|HHWEB)'
      }
    })
  });

  await page.queryRules();

  assert.equal(app.children[0].children[0].textContent, 'HDSWEB规则');
  assert.equal(app.children[0].children[1].children[0].textContent, '九门');
});
