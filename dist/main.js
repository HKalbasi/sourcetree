let lazyData;

const getLazyData = async () => {
  if (lazyData) {
    return lazyData;
  }
  const filename = location.pathname.split('/').slice(-1)[0];
  const res = await fetch(`./${filename.slice(0, -5)}.ref.json?v=${(new Date).valueOf()}`);
  return res.json();
};

const switchTab = (to) => {
  console.log('tab: ', to);
  [...document.getElementById('side-panel-tabs').children].forEach((e) => {
    e.classList.remove('enabled');
  });
  [...document.getElementById('side-panel').children].forEach((e) => {
    if (e.id === 'side-panel-tabs') return;
    e.hidden = true;
  });
  document.getElementById(`tab-panel-${to}`).classList.add('enabled');
  document.getElementById(`panel-${to}`).hidden = false;
};
const panelButtonOnClick = (ev) => {
  switchTab(ev.target.id.slice(10));
};
[...document.getElementById('side-panel-tabs').children].forEach((e) => {
  e.onclick = panelButtonOnClick;
});
window.searchText = (x) => {
  switchTab('search');
  document.getElementById('search-input').value = x;
  updateSearchResult(x);
};

const buildSearchItem = ({ references, definition }) => {
  const main = document.createElement('div');
  const f = (x, suffix) => {
    const root = document.createElement('a');
    root.href = x.url;
    root.className = 'search-result';
    const nam = document.createElement('div');
    nam.innerText = `${x.filename}${suffix}`;
    root.appendChild(nam);
    const pre = document.createElement('pre');
    pre.innerText = `${x.position.start.line + 1}| ${x.srcLine.trim()}`;
    root.appendChild(pre);
    return root;
  };
  main.appendChild(f(definition, ' - definition'));
  references.map((x) => f(x, '')).forEach((x) => main.appendChild(x));
  return main;
};

const updateSearchResult = async (x) => {
  const SR = document.getElementById('search-result');
  SR.innerText = 'Loading...';
  if (x.startsWith('#lsif')) {
    const { references } = await getLazyData();
    SR.innerText = '';
    SR.appendChild(buildSearchItem(references[`x${x.slice(5)}`]));
  }
}

document.getElementById('search-input').oninput = (e) => {
  alert(e);
};

const buildHovers = async () => {
  const filename = location.pathname.split('/').slice(-1)[0];
  const res = await fetch(`./${filename.slice(0, -5)}.hover.json?v=${(new Date).valueOf()}`);
  const { hovers } = await res.json();
  Object.keys(hovers).map((x) => ({
    id: x.slice(1), value: hovers[x],
  })).forEach(({ id, value }) => {
    const root = document.createElement('div');
    root.className = 'hover-root';
    if (value.content) {
      const text = document.createElement('div');
      text.innerHTML = value.content;
      root.appendChild(text);
    }
    const buttons = document.createElement('div');
    buttons.className = 'button-holder';
    if (value.definition) {
      const b = document.createElement('a');
      b.href = value.definition;
      b.className = 'button';
      b.innerText = 'Go to definition';
      buttons.appendChild(b);
    }
    if (value.references) {
      const b = document.createElement('a');
      b.onclick = () => searchText(`#lsif${id}`);
      b.className = 'button';
      b.innerText = 'Find all references';
      buttons.appendChild(b);
    }
    root.appendChild(buttons);
    tippy('#lsif' + id, {
      content: root,
      allowHTML: true,
      delay: [200, 0],
      interactive: true,
      maxWidth: '80vw',
      appendTo: document.body,
    });
  });
};

buildHovers();
