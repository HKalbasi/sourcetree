let lazyData;

const getLazyData = async () => {
  if (lazyData) {
    return lazyData;
  }
  const filename = location.pathname.split('/').slice(-1)[0];
  const res = await fetch(`./${filename.slice(0, -5)}.lazy.json?v=${(new Date).valueOf()}`);
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

const buildSearchItem = (refs) => {
  const main = document.createElement('div');
  const f = (x) => {
    const root = document.createElement('a');
    root.href = x.url;
    const pre = document.createElement('pre');
    pre.innerText = `${x.position.start.line + 1}| ${x.srcLine.trim()}`;
    root.appendChild(pre);
    return root;
  };
  refs.map(f).forEach((x) => main.appendChild(x));
  return main;
};

const updateSearchResult = async (x) => {
  const SR = document.getElementById('search-result');
  SR.innerText = 'Loading...';
  if (x.startsWith('#lsif')) {
    const { references } = await getLazyData();
    SR.innerText = '';
    SR.appendChild(buildSearchItem(references[`x${x.slice(5)}`].references));
  }
}

document.getElementById('search-input').oninput = (e) => {
  alert(e);
};
