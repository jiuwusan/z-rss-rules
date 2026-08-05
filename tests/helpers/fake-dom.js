import assert from 'node:assert/strict';

export class FakeElement {
  constructor(tagName, ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.className = '';
    this.id = '';
    this.value = '';
    this.disabled = false;
    this.ownTextContent = '';
    this.eventListeners = {};
    this.attributes = {};
    this.isFocused = false;
  }

  get textContent() {
    return this.ownTextContent + this.children.map(child => child.textContent).join('');
  }

  get isConnected() {
    let currentElement = this;
    while (currentElement) {
      if (currentElement === this.ownerDocument?.body) {
        return true;
      }
      currentElement = currentElement.parentElement;
    }
    return false;
  }

  set textContent(value) {
    this.ownTextContent = String(value);
    this.children = [];
  }

  append(...children) {
    children.forEach(child => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children.forEach(child => {
      child.parentElement = null;
      child.isFocused = false;
    });
    this.ownTextContent = '';
    this.children = [...children];
    this.children.forEach(child => {
      child.parentElement = this;
    });
  }

  insertBefore(child, referenceChild) {
    const referenceIndex = this.children.indexOf(referenceChild);
    const insertIndex = referenceIndex >= 0 ? referenceIndex : this.children.length;
    child.parentElement = this;
    this.children.splice(insertIndex, 0, child);
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  focus() {
    if (this.ownerDocument?.activeElement) {
      this.ownerDocument.activeElement.isFocused = false;
    }
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
    this.isFocused = true;
  }

  dispatch(type, properties = {}) {
    const event = {
      target: this,
      defaultPrevented: false,
      ...properties,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    if (this.disabled && ['click', 'change', 'input'].includes(type)) {
      return event;
    }
    event.listenerResult = this.eventListeners[type]?.(event);
    if (type === 'keydown') {
      let parentElement = this.parentElement;
      while (parentElement) {
        const listenerResult = parentElement.eventListeners[type]?.(event);
        if (listenerResult !== undefined) {
          event.listenerResult = listenerResult;
        }
        parentElement = parentElement.parentElement;
      }
      this.ownerDocument?.dispatchEvent(type, event);
    }
    return event;
  }
}

export const createFakeDocument = () => {
  const documentEventListeners = {};
  const findById = (root, id) => {
    if (root.id === id) {
      return root;
    }

    for (const child of root.children) {
      const match = findById(child, id);
      if (match) {
        return match;
      }
    }

    return null;
  };
  const document = {
    activeElement: null,
    createElement: tagName => new FakeElement(tagName, document),
    getElementById: id => findById(body, id),
    addEventListener(type, listener) {
      documentEventListeners[type] = listener;
    },
    removeEventListener(type, listener) {
      if (documentEventListeners[type] === listener) {
        delete documentEventListeners[type];
      }
    },
    dispatchEvent(type, event) {
      const listenerResult = documentEventListeners[type]?.(event);
      if (listenerResult !== undefined) {
        event.listenerResult = listenerResult;
      }
      return event;
    },
    dispatch(type, properties = {}) {
      const event = {
        defaultPrevented: false,
        ...properties,
        preventDefault() {
          this.defaultPrevented = true;
        }
      };
      return this.dispatchEvent(type, event);
    }
  };
  const body = new FakeElement('body', document);
  const app = new FakeElement('main', document);
  app.id = 'app';
  body.append(app);
  document.body = body;
  return {
    app,
    body,
    document
  };
};

export const findElements = (root, predicate) => {
  const matches = predicate(root) ? [root] : [];
  return root.children.reduce((result, child) => result.concat(findElements(child, predicate)), matches);
};

export const waitForCondition = async predicate => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }

  assert.fail('等待条件未满足');
};
