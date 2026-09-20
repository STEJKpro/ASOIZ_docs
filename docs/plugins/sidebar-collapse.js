/**
 * Sidebar collapse for docsify@5.
 *
 * Replaces the abandoned v4-era docsify-sidebar-collapse plugin (v1.3.5,
 * 2022): on v5 the theme rule `.collapse:is(... li) > :not(a) { display:none }`
 * hides the `li > p > a` link wrapper (v4 expected `li > a`), so collapsing a
 * group made the item disappear entirely.
 *
 * Semantics follow the official docsify docs (configuration.md,
 * collapsibleSidebarGroups / collapseSidebarGroups):
 *  - groups toggle via a dedicated chevron button (click / Enter / Space);
 *    clicking the group's page link still navigates
 *  - manual choices persist for the browser session (sessionStorage);
 *    auto-expanded active-path ancestors stay volatile (never persisted)
 *  - ancestors of the active page are auto-expanded on navigation
 *  - `sidebarDisplayLevel` (number) seeds how many levels start expanded
 *    (0 = all collapsed, 1 = first level expanded, ...)
 *
 * Visuals come from the docsify@5 theme itself: `body.sidebar-chevron-*`
 * paints chevrons on `a.page-link` keyed on the li's `open` / `active`
 * classes, so no caret CSS is needed here. This plugin intentionally never
 * uses the `collapse` class (that is what triggers the v5 theme bug above).
 *
 * KNOWN CORE BUG (patched with one CSS rule in docs/index.html): the v5
 * bundle's own sidebar click handler toggles `collapse` on ANY li containing
 * an `.app-sub-sidebar` when its link is clicked. Because docsify injects the
 * page TOC (app-sub-sidebar) into the ACTIVE sidebar li, the first click on
 * any item of a page with headings hides that very item (theme rule
 * `.collapse:is(... li) > :not(a) { display:none }` hides the `li > p` row).
 * index.html restores the row with `.sidebar-nav li.collapse > p { display:block }`.
 *
 * `collapsibleSidebarGroups` / `collapseSidebarGroups` are documented in the
 * develop-branch docs but NOT implemented in the served docsify@5 dist bundle
 * (verified: 0 occurrences) - hence this plugin instead of native options.
 */
(function () {
  'use strict';

  const STORE_KEY = 'asoiz-sidebar-expanded';

  let expanded = null; // Set<li key> | null until first render
  let volatileKeys = new Set(); // auto-expanded active-path ancestors (never persisted)
  let userKeys = new Set(); // keys the user opened manually (persisted intent)

  function readStore() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeStore(keys) {
    try {
      // Single choke point for persistence: strip volatile (auto-expanded
      // active-path) keys so they can never leak into sessionStorage and
      // survive a same-tab reload as stale open groups.
      const userOwned = [...keys].filter((key) => !volatileKeys.has(key));
      sessionStorage.setItem(STORE_KEY, JSON.stringify(userOwned));
    } catch {
      /* storage unavailable - session-only state */
    }
  }

  const isCollapsible = (li) => Boolean(li.querySelector(':scope > ul:not(.app-sub-sidebar)'));

  const itemKey = (li) => {
    const link = li.querySelector(':scope > a, :scope > p > a');
    return link ? link.getAttribute('href') : 'g:' + (li.textContent || '').trim().slice(0, 40);
  };

  /** collapsible depth: root groups = 1, their nested groups = 2, ... */
  function levelOf(li) {
    let level = 1;
    let ancestor = li.parentElement ? li.parentElement.closest('li') : null;
    while (ancestor) {
      if (isCollapsible(ancestor)) level += 1;
      ancestor = ancestor.parentElement ? ancestor.parentElement.closest('li') : null;
    }
    return level;
  }

  /** keep aria-expanded and the RU action label in sync (open = «Свернуть», closed = «Развернуть») */
  const setAria = (btn, isOpen) => {
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.setAttribute('aria-label', isOpen ? 'Свернуть раздел' : 'Развернуть раздел');
  };

  function ensureToggle(li, isOpen) {
    let btn = li.querySelector(
      ':scope > p > .sidebar-collapse-toggle, :scope > .sidebar-collapse-toggle',
    );
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-collapse-toggle';
      const row = li.querySelector(':scope > p');
      if (row) {
        // v5 loose list item: li > p > a - the button overlays the row
        row.insertBefore(btn, row.firstChild);
      } else {
        // tight list item: li > a - the button becomes a li-child sized to
        // the link's row (re-measured on every docsify re-render)
        const a = li.querySelector(':scope > a');
        li.insertBefore(btn, a ?? li.firstChild);
        btn.style.height = `${Math.round(a?.getBoundingClientRect().height ?? 26)}px`;
      }
    }
    setAria(btn, isOpen);
    return btn;
  }

  function annotate(nav, vm) {
    const collapsibles = [];
    nav.querySelectorAll('li').forEach((li) => {
      if (isCollapsible(li)) collapsibles.push(li);
    });

    // seed once per session (sessionStorage empty -> apply sidebarDisplayLevel)
    if (expanded === null) {
      const stored = readStore();
      const storedKeys = Array.isArray(stored) ? stored : [];
      expanded = new Set(storedKeys);
      // storage holds user-owned keys only (writeStore strips volatile ones),
      // so it reconstructs the persisted user intent after a full reload
      userKeys = new Set(storedKeys);
      if (stored === null) {
        const displayLevel = Number(vm.config.sidebarDisplayLevel ?? 0);
        if (displayLevel > 0) {
          for (const li of collapsibles) {
            if (levelOf(li) <= displayLevel) expanded.add(itemKey(li));
          }
        }
      }
    }

    // auto-expand the active page's own group and all its ancestors -
    // VOLATILE (never persisted): writing them into sessionStorage made the
    // expanded set grow with every visited page ("все подпункты раскрыты").
    // Previously auto-expanded groups are closed again on navigation; only
    // groups the user manually opened (userKeys) are persisted and stay open
    // even when they lie on the active path - a manual choice is never
    // re-marked volatile.
    for (const key of volatileKeys) expanded.delete(key);
    volatileKeys = new Set();
    const activeLi = nav.querySelector('li.active') ?? nav.querySelector('li[aria-current="page"]');
    if (activeLi) {
      let el = activeLi;
      while (el && el !== nav) {
        if (el.tagName === 'LI' && isCollapsible(el)) {
          const key = itemKey(el);
          if (!userKeys.has(key)) {
            expanded.add(key);
            volatileKeys.add(key);
          }
        }
        el = el.parentElement;
      }
    }

    for (const li of collapsibles) {
      const key = itemKey(li);
      const isOpen = expanded.has(key);
      li.classList.add('collapsible');
      li.dataset.key = key ?? '';
      li.classList.toggle('open', isOpen);
      ensureToggle(li, isOpen);
    }
  }

  function install(hook, vm) {
    hook.doneEach(() => {
      const nav = document.querySelector('.sidebar-nav');
      if (nav) annotate(nav, vm);
    });
    hook.mounted(() => {
      const nav = document.querySelector('.sidebar-nav');
      if (!nav) return;
      nav.addEventListener('click', (e) => {
        const btn = e.target.closest('.sidebar-collapse-toggle');
        if (!btn) return; // clicks on the page link keep navigating normally
        e.preventDefault(); // harmless defense: the tight-list fallback button is
        // inserted as an li-child SIBLING of the <a> (never nested inside it)
        const li = btn.closest('li');
        const key = li.dataset.key;
        const isOpen = !li.classList.contains('open');
        if (isOpen) {
          // manual open: the key becomes user-owned (persisted on the next
          // writeStore, never wiped as volatile - even on the active path)
          expanded.add(key);
          userKeys.add(key);
          volatileKeys.delete(key);
        } else {
          // manual collapse: sticks until the next navigation. A key that is
          // currently a volatile active-path ancestor STAYS volatile, so the
          // next navigation re-auto-expands it; off the active path the
          // removal is persisted by dropping it from userKeys.
          expanded.delete(key);
          userKeys.delete(key);
        }
        writeStore(expanded); // persists expanded \ volatileKeys (user choices only)
        li.classList.toggle('open', isOpen);
        setAria(btn, isOpen);
      });
    });
  }

  if (!window.$docsify) window.$docsify = {};
  window.$docsify.plugins = [install, ...(window.$docsify.plugins || [])];
})();
