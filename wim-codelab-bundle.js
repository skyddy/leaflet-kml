// wim-codelab-bundle.js
(function () {
  class EditorManager {
    constructor(container) {
      this.editors = {};
      this.container = container;
    }

    async init() {
      require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
      await new Promise(resolve => require(["vs/editor/editor.main"], resolve));

      this.editors.js = monaco.editor.create(this.container.querySelector('.wimcl-editor-js'), {
        value: '', language: 'javascript', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }
      });
      this.editors.html = monaco.editor.create(this.container.querySelector('.wimcl-editor-html'), {
        value: '', language: 'html', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }
      });
      this.editors.css = monaco.editor.create(this.container.querySelector('.wimcl-editor-css'), {
        value: '', language: 'css', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }
      });
    }

    setValues(values) {
      for (const [type, value] of Object.entries(values)) {
        this.editors[type].setValue(value);
      }
    }

    getValues() {
      return {
        js: this.editors.js.getValue(),
        html: this.editors.html.getValue(),
        css: this.editors.css.getValue()
      };
    }
  }

  class PreviewManager {
    constructor(tests, container) {
      this.tests = tests;
      this.container = container; // Зберігаємо контейнер
      this.iframe = container.querySelector('.wimcl-preview-frame');
      this.consoleOutput = container.querySelector('.wimcl-console-output');
      this.testStatus = container.querySelector('.wimcl-test-status');

      if (!this.iframe) {
        console.error('WIM CodeLab: Preview iframe not found in container');
      }
    }

    runCode(code, tests) {
      if (!this.iframe) {
        console.error('WIM CodeLab: Cannot run code - iframe is undefined');
        return;
      }

      this.consoleOutput.innerHTML = '';
      this.testStatus.textContent = 'Running...';
      const { js, html, css } = code;

      const expose = tests.map(test => {
        if (test.type === 'function') return `if (typeof ${test.name} !== 'undefined') window["${test.name}"] = ${test.name};`;
        if (test.type === 'expression') {
          const match = test.name.match(/^(typeof\s+)?([a-zA-Z_$][a-zA-Z_$0-9]*)/);
          if (match) return `if (typeof ${match[2]} !== 'undefined') window["${match[2]}"] = ${match[2]};`;
        }
        return '';
      }).filter(Boolean).join('\n');

      const wrappedJS = `(function(){\n${js}\n${expose}\n})();`;
      this.iframe.srcdoc = `
        <!DOCTYPE html>
        <html lang="en">
        <head><style>${css}</style><title>WIM CodeLab</title></head>
        <body>
          ${html}
          <script>
            window.addEventListener('DOMContentLoaded', () => {
              const log = console.log;
              const error = console.error;
              function send(type, args) { parent.postMessage({ type, message: Array.from(args).join(' ') }, '*'); }
              console.log = function() { send('log', arguments); log.apply(console, arguments); };
              console.error = function() { send('error', arguments); error.apply(console, arguments); };
              try { ${wrappedJS} } catch (e) { console.error("Eval error:", e); }
              ${runTests(tests)}
            });
          </script>
        </body>
        </html>
      `;
    }

    handleMessage(event) {
      const { type, message, testResult, name, expected, actual, pass } = event.data;
      if (type && message) {
        const line = document.createElement('div');
        line.textContent = `[${type.toUpperCase()}] ${message}`;
        this.consoleOutput.appendChild(line);
      }
      if (testResult) {
        const el = document.createElement('div');
        el.classList.add('wimcl-test-output');
        el.innerHTML = `<strong class="${pass ? 'wimcl-pass' : 'wimcl-fail'}">${pass ? '✔' : '✘'} ${name}</strong><br/>
          Expected: <code>${expected}</code><br/>
          Actual: <code>${actual}</code>`;
        this.consoleOutput.appendChild(el);
        const passed = this.consoleOutput.querySelectorAll('.wimcl-pass').length;
        this.testStatus.textContent = `Tests: ${passed} / ${this.tests.length}`;
      }
    }
  }

  function runTests(tests) {
    return tests.map(test => {
      if (test.type === 'function') {
        return `
          try {
            const result = window["${test.name}"](${(test.args || []).map(a => JSON.stringify(a)).join(',')});
            const pass = result === ${JSON.stringify(test.expected)};
            parent.postMessage({ testResult: true, name: "${test.name}", expected: ${JSON.stringify(test.expected)}, actual: result, pass }, "*");
          } catch (err) {
            parent.postMessage({ testResult: true, name: "${test.name}", expected: ${JSON.stringify(test.expected)}, actual: "Error: " + err.message, pass: false }, "*");
          }`;
      } else {
        return `
          try {
            const result = (function() { return eval(${JSON.stringify(test.name)}); })();
            const pass = result === ${JSON.stringify(test.expected)};
            parent.postMessage({ testResult: true, name: ${JSON.stringify(test.name)}, expected: ${JSON.stringify(test.expected)}, actual: result, pass }, "*");
          } catch (err) {
            parent.postMessage({ testResult: true, name: ${JSON.stringify(test.name)}, expected: ${JSON.stringify(test.expected)}, actual: "Error: " + err.message, pass: false }, "*");
          }`;
      }
    }).join('\n');
  }

  window.initWimCodeLab = async function (config) {
    const { container, challenge, options = {} } = config;
    const target = typeof container === 'string' ? document.querySelector(container) : container;

    if (!target) throw new Error('WIM CodeLab: Container not found');
    if (!challenge) throw new Error('WIM CodeLab: Challenge data is required');

    target.innerHTML = `
      <div class="wimcl-container">
        <div class="wimcl-left-panel">
          <div class="wimcl-tabs">
            <button class="wimcl-tab wimcl-active" data-tab="js">index.js</button>
            <button class="wimcl-tab" data-tab="html">index.html</button>
            <button class="wimcl-tab" data-tab="css">index.css</button>
          </div>
          <div class="wimcl-editor-js wimcl-editor-container wimcl-active"></div>
          <div class="wimcl-editor-html wimcl-editor-container"></div>
          <div class="wimcl-editor-css wimcl-editor-container"></div>
          <div class="wimcl-footer">
            <div class="wimcl-test-result wimcl-test-status">Tests: waiting...</div>
            <div>
              <button class="wimcl-reset-btn">⟳ Reset</button>
              <button class="wimcl-solution-btn">💡 Solution</button>
              <button class="wimcl-run-btn">▶ Run</button>
            </div>
          </div>
        </div>
        <div class="wimcl-right-panel">
          <div class="wimcl-instructions">
            <h3 class="wimcl-challenge-title">🧪 Task: ${challenge.title}</h3>
            <p class="wimcl-challenge-description">${challenge.description}</p>
          </div>
          <iframe class="wimcl-preview-frame"></iframe>
          <div class="wimcl-console-output"></div>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .wimcl-container { display: flex; height: ${options.height || '100%'}; }
      .wimcl-left-panel { width: 60%; display: flex; flex-direction: column; border-right: 1px solid #333; }
      .wimcl-tabs { display: flex; background: #2c2c2c; border-bottom: 1px solid #444; }
      .wimcl-tab { padding: 10px 15px; cursor: pointer; background: #2c2c2c; color: #fff; border: none; border-right: 1px solid #444; }
      .wimcl-tab.wimcl-active { background: #1e1e1e; }
      .wimcl-editor-container { flex-grow: 1; display: none; }
      .wimcl-editor-container.wimcl-active { display: block; }
      .wimcl-right-panel { width: 40%; display: flex; flex-direction: column; }
      .wimcl-instructions { padding: 15px; border-bottom: 1px solid #333; background: #1e1e1e; color: #fff; }
      .wimcl-preview-frame { flex-grow: 1; border: none; background: white; }
      .wimcl-console-output { height: 120px; overflow-y: auto; padding: 10px; background: #111; font-family: monospace; border-top: 1px solid #333; color: #fff; }
      .wimcl-footer { padding: 10px; border-top: 1px solid #444; display: flex; justify-content: space-between; background: #2c2c2c; }
      .wimcl-footer button { background: #00c896; color: #fff; border: none; padding: 8px 16px; font-size: 14px; cursor: pointer; border-radius: 3px; margin-left: 5px; }
      .wimcl-test-result { font-size: 14px; color: #ccc; }
      .wimcl-test-output { padding: 10px; background: #222; border-top: 1px solid #333; font-size: 13px; }
      .wimcl-pass { color: #4CAF50; }
      .wimcl-fail { color: #F44336; }
    `;
    document.head.appendChild(style);

    const editorManager = new EditorManager(target);
    await editorManager.init();
    editorManager.setValues(challenge.editors);

    const previewManager = new PreviewManager(challenge.tests, target);

    target.querySelectorAll('.wimcl-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        target.querySelectorAll('.wimcl-tab').forEach(t => t.classList.remove('wimcl-active'));
        target.querySelectorAll('.wimcl-editor-container').forEach(e => e.classList.remove('wimcl-active'));
        tab.classList.add('wimcl-active');
        target.querySelector(`.wimcl-editor-${tab.dataset.tab}`).classList.add('wimcl-active');
      });
    });

    target.querySelector('.wimcl-reset-btn').addEventListener('click', () => editorManager.setValues(challenge.editors));
    target.querySelector('.wimcl-solution-btn').addEventListener('click', () => editorManager.setValues(challenge.solution));
    target.querySelector('.wimcl-run-btn').addEventListener('click', () => previewManager.runCode(editorManager.getValues(), challenge.tests));
    window.addEventListener('message', (event) => previewManager.handleMessage(event));
  };
})();
