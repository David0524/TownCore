// Links to other sites open in a new tab, so readers keep the paper open (owner, 2026-10-16:
// "Any external links should open in a new tab"). One listener covers every link on the page,
// including article text and source lists. It is inlined in the page so it works from first
// paint, before the app loads; it sets the target as the click happens, so the browser's own
// handling (middle click, keyboard) still works. noopener keeps the new tab from reaching back.
export const externalLinksScript = `(function(){function o(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||!/^https?:$/.test(a.protocol)||a.host===location.host)return;a.target='_blank';if(!/(^|\\s)noopener(\\s|$)/.test(a.rel))a.rel=(a.rel+' noopener').trim();}document.addEventListener('click',o,true);document.addEventListener('auxclick',o,true);})();`;
