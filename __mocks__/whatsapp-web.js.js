class FakeEventEmitter {
  constructor() { this.handlers = {}; }
  on(event, fn) {
    this.handlers[event] = this.handlers[event] || [];
    this.handlers[event].push(fn);
  }
  emit(event, ...args) {
    const fns = this.handlers[event] || [];
    for (const fn of fns) fn(...args);
  }
}

class Client extends FakeEventEmitter {
  constructor(opts = {}) { super(); this.opts = opts; this.initialized = false; }
  initialize() { this.initialized = true; this.emit('ready'); }
  async sendMessage(to, content) {
    // capture last message for assertions
    this.lastMessage = { to, content };
    return this.lastMessage;
  }
}

class List {
  constructor(body, buttonText, sections, title) {
    this.type = 'List';
    this.body = body; this.buttonText = buttonText; this.sections = sections; this.title = title;
  }
}

class Buttons {
  constructor(body, buttons, title, footer) {
    this.type = 'Buttons';
    this.body = body; this.buttons = buttons; this.title = title; this.footer = footer;
  }
}

class Location {
  constructor(lat, lng, desc) { this.lat = lat; this.lng = lng; this.desc = desc; }
}

class LocalAuth { constructor() {} }

module.exports = { Client, List, Buttons, Location, LocalAuth };